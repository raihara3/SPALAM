import * as THREE from "three";
import type {
  CameraPose,
  PreintegrationResult,
  ScaleState,
} from "../types/Pose";

/**
 * Scale Estimator Options
 */
export interface ScaleEstimatorOptions {
  /** Gravity magnitude (m/s²). Default: 9.80665 */
  gravityMagnitude?: number;
  /** Minimum static samples for gravity initialization. Default: 30 */
  minStaticSamples?: number;
  /** Maximum angular velocity to consider static (rad/s). Default: 0.05 */
  staticAngularVelocityThreshold?: number;
  /** Maximum linear acceleration deviation from gravity (m/s²). Default: 0.5 */
  staticAccelerationThreshold?: number;
  /** Scale convergence threshold (relative change). Default: 0.01 */
  convergenceThreshold?: number;
  /** Minimum observations for scale convergence. Default: 10 */
  minConvergenceObservations?: number;
  /** Maximum scale value (sanity check). Default: 100 */
  maxScale?: number;
  /** Minimum scale value (sanity check). Default: 0.01 */
  minScale?: number;
}

/**
 * Scale observation for tracking history
 */
interface ScaleObservation {
  scale: number;
  confidence: number;
  timestamp: number;
}

/**
 * Scale Estimator
 *
 * Estimates the absolute scale factor to convert visual odometry
 * (unit scale) to metric scale using IMU data.
 *
 * Approach:
 * 1. Gravity-based initialization: Use known gravity magnitude (9.8 m/s²)
 *    as reference scale during static initialization
 * 2. Visual-Inertial scale refinement: Compare visual translation with
 *    IMU-integrated displacement to estimate scale
 * 3. Scale monitoring: Track scale stability and detect drift
 */
export class ScaleEstimator {
  private gravityMagnitude: number;
  private minStaticSamples: number;
  private staticAngularVelocityThreshold: number;
  private staticAccelerationThreshold: number;
  private convergenceThreshold: number;
  private minConvergenceObservations: number;
  private maxScale: number;
  private minScale: number;

  private state: ScaleState = "uninitialized";
  private currentScale: number = 1.0;
  private gravityDirection: THREE.Vector3 = new THREE.Vector3(0, -1, 0);

  // Initialization samples
  private staticAccelerationSamples: THREE.Vector3[] = [];
  private staticSampleTimestamps: number[] = [];

  // Scale observations for convergence tracking
  private scaleObservations: ScaleObservation[] = [];
  private readonly maxObservations: number = 50;

  // Scale statistics
  private scaleVariance: number = 1.0;
  private lastScaleUpdateTime: number = 0;

  constructor(options?: ScaleEstimatorOptions) {
    this.gravityMagnitude = options?.gravityMagnitude ?? 9.80665;
    this.minStaticSamples = options?.minStaticSamples ?? 30;
    this.staticAngularVelocityThreshold =
      options?.staticAngularVelocityThreshold ?? 0.05;
    this.staticAccelerationThreshold =
      options?.staticAccelerationThreshold ?? 0.5;
    this.convergenceThreshold = options?.convergenceThreshold ?? 0.01;
    this.minConvergenceObservations = options?.minConvergenceObservations ?? 10;
    this.maxScale = options?.maxScale ?? 100;
    this.minScale = options?.minScale ?? 0.01;
  }

  /**
   * Get current state
   */
  public getState(): ScaleState {
    return this.state;
  }

  /**
   * Get current scale factor
   */
  public getScale(): number {
    return this.currentScale;
  }

  /**
   * Get gravity direction in world frame
   */
  public getGravityDirection(): THREE.Vector3 {
    return this.gravityDirection.clone();
  }

  /**
   * Check if scale is converged
   */
  public isConverged(): boolean {
    return this.state === "converged";
  }

  /**
   * Add static IMU sample for gravity initialization
   *
   * @param acceleration Acceleration including gravity (m/s²)
   * @param angularVelocity Angular velocity (rad/s)
   * @param timestamp Sample timestamp (ms)
   * @returns Whether initialization is complete
   */
  public addStaticSample(
    acceleration: THREE.Vector3,
    angularVelocity: THREE.Vector3,
    timestamp: number
  ): boolean {
    // Check if device is approximately static
    const angularVelocityMagnitude = angularVelocity.length();
    if (angularVelocityMagnitude > this.staticAngularVelocityThreshold) {
      // Device is rotating, reset samples
      this.staticAccelerationSamples = [];
      this.staticSampleTimestamps = [];
      return false;
    }

    // Check acceleration is close to gravity magnitude
    const accelerationMagnitude = acceleration.length();
    const deviationFromGravity = Math.abs(
      accelerationMagnitude - this.gravityMagnitude
    );
    if (deviationFromGravity > this.staticAccelerationThreshold) {
      // Device is accelerating, reset samples
      this.staticAccelerationSamples = [];
      this.staticSampleTimestamps = [];
      return false;
    }

    // Add sample
    this.staticAccelerationSamples.push(acceleration.clone());
    this.staticSampleTimestamps.push(timestamp);

    // Keep only recent samples (within 2 seconds)
    while (
      this.staticSampleTimestamps.length > 0 &&
      timestamp - this.staticSampleTimestamps[0] > 2000
    ) {
      this.staticAccelerationSamples.shift();
      this.staticSampleTimestamps.shift();
    }

    if (this.state === "uninitialized") {
      this.state = "initializing";
    }

    // Check if we have enough samples
    if (this.staticAccelerationSamples.length >= this.minStaticSamples) {
      return this.initializeFromGravity();
    }

    return false;
  }

  /**
   * Initialize scale and gravity direction from static samples
   */
  private initializeFromGravity(): boolean {
    if (this.staticAccelerationSamples.length < this.minStaticSamples) {
      return false;
    }

    // Compute average acceleration (should be gravity)
    const averageAcceleration = new THREE.Vector3();
    for (const sample of this.staticAccelerationSamples) {
      averageAcceleration.add(sample);
    }
    averageAcceleration.divideScalar(this.staticAccelerationSamples.length);

    // Gravity direction is opposite to acceleration (gravity pulls down,
    // but accelerometer measures reaction force)
    this.gravityDirection = averageAcceleration.clone().normalize().negate();

    // Initial scale is 1.0 (will be refined by VIO)
    this.currentScale = 1.0;

    // Compute variance to assess quality
    let variance = 0;
    for (const sample of this.staticAccelerationSamples) {
      const diff = sample.clone().sub(averageAcceleration);
      variance += diff.lengthSq();
    }
    variance /= this.staticAccelerationSamples.length;

    // If variance is too high, don't initialize
    if (Math.sqrt(variance) > this.staticAccelerationThreshold) {
      return false;
    }

    this.state = "converging";
    this.lastScaleUpdateTime = Date.now();

    // Clear samples
    this.staticAccelerationSamples = [];
    this.staticSampleTimestamps = [];

    return true;
  }

  /**
   * Update scale from Visual-Inertial comparison
   *
   * Compares the translation from visual odometry with the displacement
   * computed from IMU preintegration to estimate scale.
   *
   * @param visualTranslation Translation from visual odometry (unit scale)
   * @param imuPreintegration IMU preintegration result
   * @param initialVelocity Velocity at start of interval
   * @param deltaTime Time interval in seconds
   * @param confidence Confidence of visual measurement (0-1)
   */
  public updateScale(
    visualTranslation: THREE.Vector3,
    imuPreintegration: PreintegrationResult,
    initialVelocity: THREE.Vector3,
    deltaTime: number,
    confidence: number = 1.0
  ): void {
    if (this.state === "uninitialized" || this.state === "initializing") {
      return;
    }

    // Visual translation magnitude (unit scale)
    const visualMagnitude = visualTranslation.length();
    if (visualMagnitude < 0.001) {
      // Too small to estimate scale
      return;
    }

    // IMU-predicted displacement
    // p = p0 + v0 * dt + 0.5 * g * dt² + R * Δp
    const gravityContribution = this.gravityDirection
      .clone()
      .multiplyScalar(0.5 * this.gravityMagnitude * deltaTime * deltaTime);

    const velocityContribution = initialVelocity
      .clone()
      .multiplyScalar(deltaTime);

    const imuDisplacement = velocityContribution
      .clone()
      .add(gravityContribution)
      .add(imuPreintegration.deltaPosition);

    const imuMagnitude = imuDisplacement.length();
    if (imuMagnitude < 0.001) {
      // Too small to estimate scale
      return;
    }

    // Scale = IMU magnitude / Visual magnitude
    const observedScale = imuMagnitude / visualMagnitude;

    // Sanity check
    if (observedScale < this.minScale || observedScale > this.maxScale) {
      return;
    }

    // Add observation with confidence weighting
    this.addScaleObservation(observedScale, confidence);

    // Update current scale (exponential moving average)
    const alpha = 0.1 * confidence;
    this.currentScale = (1 - alpha) * this.currentScale + alpha * observedScale;

    // Clamp scale
    this.currentScale = Math.max(
      this.minScale,
      Math.min(this.maxScale, this.currentScale)
    );

    this.lastScaleUpdateTime = Date.now();

    // Check for convergence
    this.checkConvergence();
  }

  /**
   * Add scale observation to history
   */
  private addScaleObservation(scale: number, confidence: number): void {
    this.scaleObservations.push({
      scale,
      confidence,
      timestamp: Date.now(),
    });

    // Limit history size
    while (this.scaleObservations.length > this.maxObservations) {
      this.scaleObservations.shift();
    }

    // Update variance
    if (this.scaleObservations.length >= 3) {
      const scales = this.scaleObservations.map((o) => o.scale);
      const mean = scales.reduce((a, b) => a + b, 0) / scales.length;
      this.scaleVariance =
        scales.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scales.length;
    }
  }

  /**
   * Check if scale has converged
   */
  private checkConvergence(): void {
    if (this.scaleObservations.length < this.minConvergenceObservations) {
      return;
    }

    // Check relative variance
    const relativeVariance = Math.sqrt(this.scaleVariance) / this.currentScale;
    if (relativeVariance < this.convergenceThreshold) {
      this.state = "converged";
    }
  }

  /**
   * Refine scale using optimized poses and IMU data
   *
   * This is called after Visual-Inertial optimization to update
   * the scale with the optimized value.
   *
   * @param optimizedScale Scale from optimization
   * @param gravityDirection Refined gravity direction
   */
  public refineScale(
    optimizedScale: number,
    gravityDirection: THREE.Vector3
  ): void {
    if (optimizedScale < this.minScale || optimizedScale > this.maxScale) {
      return;
    }

    // Update with high confidence
    this.addScaleObservation(optimizedScale, 1.0);

    // Blend with current scale (trust optimization more)
    const alpha = 0.5;
    this.currentScale =
      (1 - alpha) * this.currentScale + alpha * optimizedScale;

    // Update gravity direction
    this.gravityDirection = gravityDirection.clone().normalize();

    this.lastScaleUpdateTime = Date.now();
    this.checkConvergence();
  }

  /**
   * Compute scale from two poses and their preintegration
   *
   * Solves for scale that best aligns visual and inertial displacements.
   *
   * @param pose1 First camera pose
   * @param pose2 Second camera pose
   * @param preintegration IMU preintegration between poses
   * @param velocity1 Velocity at first pose
   * @returns Estimated scale or null if cannot compute
   */
  public computeScaleFromPoses(
    pose1: CameraPose,
    pose2: CameraPose,
    preintegration: PreintegrationResult,
    velocity1: THREE.Vector3
  ): number | null {
    // Visual displacement
    const visualDisplacement = pose2.translation.clone().sub(pose1.translation);
    const visualMagnitude = visualDisplacement.length();

    if (visualMagnitude < 0.001) {
      return null;
    }

    // Time interval
    const deltaTime = preintegration.integrationTime;
    if (deltaTime < 0.01) {
      return null;
    }

    // IMU predicted displacement (with current scale)
    const gravityContribution = this.gravityDirection
      .clone()
      .multiplyScalar(0.5 * this.gravityMagnitude * deltaTime * deltaTime);

    const velocityContribution = velocity1.clone().multiplyScalar(deltaTime);

    // Transform preintegration to world frame
    const rotation1 = new THREE.Matrix4().makeRotationFromQuaternion(
      pose1.quaternion
    );
    const rotation3 = new THREE.Matrix3().setFromMatrix4(rotation1);
    const deltaPositionWorld = preintegration.deltaPosition
      .clone()
      .applyMatrix3(rotation3);

    const imuDisplacement = velocityContribution
      .add(gravityContribution)
      .add(deltaPositionWorld);

    const imuMagnitude = imuDisplacement.length();

    if (imuMagnitude < 0.001) {
      return null;
    }

    // Scale estimate
    const scale = imuMagnitude / visualMagnitude;

    if (scale < this.minScale || scale > this.maxScale) {
      return null;
    }

    return scale;
  }

  /**
   * Get scale variance (uncertainty)
   */
  public getScaleVariance(): number {
    return this.scaleVariance;
  }

  /**
   * Get scale confidence (inverse of relative variance)
   */
  public getScaleConfidence(): number {
    if (this.currentScale < 1e-6) {
      return 0;
    }
    const relativeStdDev = Math.sqrt(this.scaleVariance) / this.currentScale;
    return Math.max(0, 1 - relativeStdDev);
  }

  /**
   * Get number of scale observations
   */
  public getObservationCount(): number {
    return this.scaleObservations.length;
  }

  /**
   * Apply scale to a translation vector
   */
  public applyScale(translation: THREE.Vector3): THREE.Vector3 {
    return translation.clone().multiplyScalar(this.currentScale);
  }

  /**
   * Apply scale to a pose (modifies translation only)
   */
  public applyScaleToPose(pose: CameraPose): CameraPose {
    return {
      ...pose,
      translation: pose.translation.clone().multiplyScalar(this.currentScale),
      quaternion: pose.quaternion.clone(),
      rotation: pose.rotation.clone(),
    };
  }

  /**
   * Mark scale as lost (needs re-initialization)
   */
  public markAsLost(): void {
    this.state = "lost";
  }

  /**
   * Check if scale needs recalibration
   */
  public needsRecalibration(): boolean {
    // Check if no updates for a long time
    const timeSinceUpdate = Date.now() - this.lastScaleUpdateTime;
    if (timeSinceUpdate > 5000 && this.state !== "converged") {
      return true;
    }

    // Check if variance is too high
    if (this.scaleVariance > this.currentScale * 0.5) {
      return true;
    }

    return false;
  }

  /**
   * Update options
   */
  public updateOptions(options: Partial<ScaleEstimatorOptions>): void {
    if (options.gravityMagnitude !== undefined) {
      this.gravityMagnitude = options.gravityMagnitude;
    }
    if (options.minStaticSamples !== undefined) {
      this.minStaticSamples = options.minStaticSamples;
    }
    if (options.staticAngularVelocityThreshold !== undefined) {
      this.staticAngularVelocityThreshold =
        options.staticAngularVelocityThreshold;
    }
    if (options.staticAccelerationThreshold !== undefined) {
      this.staticAccelerationThreshold = options.staticAccelerationThreshold;
    }
    if (options.convergenceThreshold !== undefined) {
      this.convergenceThreshold = options.convergenceThreshold;
    }
    if (options.minConvergenceObservations !== undefined) {
      this.minConvergenceObservations = options.minConvergenceObservations;
    }
    if (options.maxScale !== undefined) {
      this.maxScale = options.maxScale;
    }
    if (options.minScale !== undefined) {
      this.minScale = options.minScale;
    }
  }

  /**
   * Reset to uninitialized state
   */
  public reset(): void {
    this.state = "uninitialized";
    this.currentScale = 1.0;
    this.gravityDirection.set(0, -1, 0);
    this.staticAccelerationSamples = [];
    this.staticSampleTimestamps = [];
    this.scaleObservations = [];
    this.scaleVariance = 1.0;
    this.lastScaleUpdateTime = 0;
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.reset();
  }
}

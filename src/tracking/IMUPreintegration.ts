import * as THREE from "three";
import type {
  IMUBiases,
  IMUMeasurement,
  IMUNoiseParameters,
  PreintegrationResult,
} from "../types/Pose";

/**
 * IMU Preintegration Options
 */
export interface IMUPreintegrationOptions {
  /** Accelerometer noise density (m/s²/√Hz). Default: 0.01 */
  accelerometerNoiseDensity?: number;
  /** Gyroscope noise density (rad/s/√Hz). Default: 0.001 */
  gyroscopeNoiseDensity?: number;
  /** Accelerometer random walk (m/s³/√Hz). Default: 0.0001 */
  accelerometerRandomWalk?: number;
  /** Gyroscope random walk (rad/s²/√Hz). Default: 0.00001 */
  gyroscopeRandomWalk?: number;
  /** Gravity magnitude (m/s²). Default: 9.80665 */
  gravityMagnitude?: number;
}

/**
 * IMU Preintegration
 *
 * Integrates IMU measurements between two keyframes without knowing
 * the absolute pose. This allows efficient re-linearization when
 * biases are updated.
 *
 * Based on the preintegration theory from:
 * "On-Manifold Preintegration for Real-Time Visual-Inertial Odometry"
 * by Forster et al.
 *
 * The preintegration computes:
 * - Δp: Position change in body frame
 * - Δv: Velocity change in body frame
 * - Δq: Rotation change as quaternion
 * - Covariance propagation for uncertainty estimation
 */
export class IMUPreintegration {
  private noiseParams: IMUNoiseParameters;
  private gravityMagnitude: number;

  // Preintegrated measurements
  private deltaPosition: THREE.Vector3 = new THREE.Vector3();
  private deltaVelocity: THREE.Vector3 = new THREE.Vector3();
  private deltaRotation: THREE.Quaternion = new THREE.Quaternion();

  // Covariance matrix (9x9: position, velocity, rotation)
  private covariance: number[] = new Array(81).fill(0);

  // Jacobians for bias correction
  private jacobianPositionBiasAccel: THREE.Matrix3 = new THREE.Matrix3();
  private jacobianPositionBiasGyro: THREE.Matrix3 = new THREE.Matrix3();
  private jacobianVelocityBiasAccel: THREE.Matrix3 = new THREE.Matrix3();
  private jacobianVelocityBiasGyro: THREE.Matrix3 = new THREE.Matrix3();
  private jacobianRotationBiasGyro: THREE.Matrix3 = new THREE.Matrix3();

  // Current biases
  private biases: IMUBiases;

  // Integration state
  private integrationTime: number = 0;
  private measurementCount: number = 0;
  private lastTimestamp: number = 0;

  constructor(
    initialBiases?: IMUBiases,
    options?: IMUPreintegrationOptions
  ) {
    this.noiseParams = {
      accelerometerNoiseDensity: options?.accelerometerNoiseDensity ?? 0.01,
      gyroscopeNoiseDensity: options?.gyroscopeNoiseDensity ?? 0.001,
      accelerometerRandomWalk: options?.accelerometerRandomWalk ?? 0.0001,
      gyroscopeRandomWalk: options?.gyroscopeRandomWalk ?? 0.00001,
    };

    this.gravityMagnitude = options?.gravityMagnitude ?? 9.80665;

    this.biases = initialBiases ?? {
      accelerometerBias: new THREE.Vector3(),
      gyroscopeBias: new THREE.Vector3(),
    };

    this.initializeJacobians();
  }

  /**
   * Initialize Jacobian matrices to identity/zero
   */
  private initializeJacobians(): void {
    this.jacobianPositionBiasAccel.identity().multiplyScalar(0);
    this.jacobianPositionBiasGyro.identity().multiplyScalar(0);
    this.jacobianVelocityBiasAccel.identity().multiplyScalar(0);
    this.jacobianVelocityBiasGyro.identity().multiplyScalar(0);
    this.jacobianRotationBiasGyro.identity().multiplyScalar(0);
  }

  /**
   * Integrate a single IMU measurement
   *
   * @param measurement IMU measurement data
   */
  public integrate(measurement: IMUMeasurement): void {
    if (this.measurementCount === 0) {
      this.lastTimestamp = measurement.timestamp;
      this.measurementCount = 1;
      return;
    }

    // Calculate delta time in seconds
    const deltaTime = (measurement.timestamp - this.lastTimestamp) / 1000;
    if (deltaTime <= 0 || deltaTime > 0.5) {
      // Skip invalid or too large time gaps
      this.lastTimestamp = measurement.timestamp;
      return;
    }

    // Remove biases from measurements
    const acceleration = measurement.acceleration
      .clone()
      .sub(this.biases.accelerometerBias);
    const angularVelocity = measurement.angularVelocity
      .clone()
      .sub(this.biases.gyroscopeBias);

    // Integrate rotation (using mid-point integration)
    const halfDeltaTheta = angularVelocity.clone().multiplyScalar(deltaTime / 2);
    const deltaQuat = this.expMap(halfDeltaTheta);

    // Update rotation
    const previousRotation = this.deltaRotation.clone();
    this.deltaRotation.multiply(deltaQuat);
    this.deltaRotation.multiply(deltaQuat);
    this.deltaRotation.normalize();

    // Rotate acceleration to body frame at start of interval
    const rotatedAccel = acceleration.clone().applyQuaternion(previousRotation);

    // Update velocity (using mid-point)
    const previousVelocity = this.deltaVelocity.clone();
    this.deltaVelocity.add(rotatedAccel.clone().multiplyScalar(deltaTime));

    // Update position
    this.deltaPosition.add(previousVelocity.clone().multiplyScalar(deltaTime));
    this.deltaPosition.add(
      rotatedAccel.clone().multiplyScalar(0.5 * deltaTime * deltaTime)
    );

    // Update Jacobians for bias correction
    this.updateJacobians(deltaTime, rotatedAccel, angularVelocity);

    // Propagate covariance
    this.propagateCovariance(deltaTime, rotatedAccel, angularVelocity);

    this.integrationTime += deltaTime;
    this.measurementCount++;
    this.lastTimestamp = measurement.timestamp;
  }

  /**
   * Exponential map: converts rotation vector to quaternion
   */
  private expMap(rotationVector: THREE.Vector3): THREE.Quaternion {
    const angle = rotationVector.length();
    if (angle < 1e-10) {
      return new THREE.Quaternion(
        rotationVector.x / 2,
        rotationVector.y / 2,
        rotationVector.z / 2,
        1
      ).normalize();
    }

    const axis = rotationVector.clone().normalize();
    const halfAngle = angle / 2;
    const sinHalfAngle = Math.sin(halfAngle);

    return new THREE.Quaternion(
      axis.x * sinHalfAngle,
      axis.y * sinHalfAngle,
      axis.z * sinHalfAngle,
      Math.cos(halfAngle)
    );
  }

  /**
   * Update Jacobians for bias correction
   */
  private updateJacobians(
    deltaTime: number,
    _rotatedAccel: THREE.Vector3,
    _angularVelocity: THREE.Vector3
  ): void {
    // Simplified Jacobian updates
    // In full implementation, these would involve the rotation matrix derivatives

    const dt2 = deltaTime * deltaTime / 2;

    // Position w.r.t. accelerometer bias: -R * dt²/2
    // Simplified: accumulate diagonal terms
    const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(
      this.deltaRotation
    );
    const rot3 = new THREE.Matrix3().setFromMatrix4(rotMatrix);

    // Accumulate Jacobians (simplified version)
    for (let i = 0; i < 3; i++) {
      const idx = i * 3 + i;
      this.jacobianPositionBiasAccel.elements[idx] -= dt2;
      this.jacobianVelocityBiasAccel.elements[idx] -= deltaTime;
    }

    // Rotation w.r.t. gyroscope bias
    for (let i = 0; i < 9; i++) {
      this.jacobianRotationBiasGyro.elements[i] -= rot3.elements[i] * deltaTime;
    }
  }

  /**
   * Propagate covariance matrix
   */
  private propagateCovariance(
    deltaTime: number,
    _rotatedAccel: THREE.Vector3,
    _angularVelocity: THREE.Vector3
  ): void {
    // Simplified covariance propagation
    // Full implementation would use state transition matrix

    const accelNoise =
      this.noiseParams.accelerometerNoiseDensity *
      this.noiseParams.accelerometerNoiseDensity *
      deltaTime;
    const gyroNoise =
      this.noiseParams.gyroscopeNoiseDensity *
      this.noiseParams.gyroscopeNoiseDensity *
      deltaTime;

    // Add noise to diagonal elements
    // Position covariance (indices 0-2)
    for (let i = 0; i < 3; i++) {
      const idx = i * 9 + i;
      this.covariance[idx] += accelNoise * deltaTime * deltaTime;
    }

    // Velocity covariance (indices 3-5)
    for (let i = 0; i < 3; i++) {
      const idx = (i + 3) * 9 + (i + 3);
      this.covariance[idx] += accelNoise;
    }

    // Rotation covariance (indices 6-8)
    for (let i = 0; i < 3; i++) {
      const idx = (i + 6) * 9 + (i + 6);
      this.covariance[idx] += gyroNoise;
    }
  }

  /**
   * Get the preintegration result
   */
  public getPreintegration(): PreintegrationResult {
    return {
      deltaPosition: this.deltaPosition.clone(),
      deltaVelocity: this.deltaVelocity.clone(),
      deltaRotation: this.deltaRotation.clone(),
      covariance: [...this.covariance],
      integrationTime: this.integrationTime,
      measurementCount: this.measurementCount,
    };
  }

  /**
   * Correct preintegration for updated biases
   *
   * Uses first-order approximation to avoid re-integration
   */
  public correctByBias(newBiases: IMUBiases): PreintegrationResult {
    const deltaBiasAccel = newBiases.accelerometerBias
      .clone()
      .sub(this.biases.accelerometerBias);
    const deltaBiasGyro = newBiases.gyroscopeBias
      .clone()
      .sub(this.biases.gyroscopeBias);

    // Correct position
    const correctedPosition = this.deltaPosition.clone();
    correctedPosition.add(
      this.applyMatrix3ToVector(
        this.jacobianPositionBiasAccel,
        deltaBiasAccel
      )
    );
    correctedPosition.add(
      this.applyMatrix3ToVector(
        this.jacobianPositionBiasGyro,
        deltaBiasGyro
      )
    );

    // Correct velocity
    const correctedVelocity = this.deltaVelocity.clone();
    correctedVelocity.add(
      this.applyMatrix3ToVector(
        this.jacobianVelocityBiasAccel,
        deltaBiasAccel
      )
    );
    correctedVelocity.add(
      this.applyMatrix3ToVector(
        this.jacobianVelocityBiasGyro,
        deltaBiasGyro
      )
    );

    // Correct rotation (first-order approximation)
    const deltaTheta = this.applyMatrix3ToVector(
      this.jacobianRotationBiasGyro,
      deltaBiasGyro
    );
    const correctedRotation = this.deltaRotation.clone();
    const correctionQuat = this.expMap(deltaTheta);
    correctedRotation.multiply(correctionQuat);
    correctedRotation.normalize();

    return {
      deltaPosition: correctedPosition,
      deltaVelocity: correctedVelocity,
      deltaRotation: correctedRotation,
      covariance: [...this.covariance],
      integrationTime: this.integrationTime,
      measurementCount: this.measurementCount,
    };
  }

  /**
   * Apply Matrix3 to Vector3
   */
  private applyMatrix3ToVector(
    matrix: THREE.Matrix3,
    vector: THREE.Vector3
  ): THREE.Vector3 {
    const e = matrix.elements;
    return new THREE.Vector3(
      e[0] * vector.x + e[3] * vector.y + e[6] * vector.z,
      e[1] * vector.x + e[4] * vector.y + e[7] * vector.z,
      e[2] * vector.x + e[5] * vector.y + e[8] * vector.z
    );
  }

  /**
   * Update biases
   */
  public updateBiases(newBiases: IMUBiases): void {
    this.biases = {
      accelerometerBias: newBiases.accelerometerBias.clone(),
      gyroscopeBias: newBiases.gyroscopeBias.clone(),
    };
  }

  /**
   * Get current biases
   */
  public getBiases(): IMUBiases {
    return {
      accelerometerBias: this.biases.accelerometerBias.clone(),
      gyroscopeBias: this.biases.gyroscopeBias.clone(),
    };
  }

  /**
   * Get gravity magnitude
   */
  public getGravityMagnitude(): number {
    return this.gravityMagnitude;
  }

  /**
   * Get noise parameters
   */
  public getNoiseParameters(): IMUNoiseParameters {
    return { ...this.noiseParams };
  }

  /**
   * Get integration time
   */
  public getIntegrationTime(): number {
    return this.integrationTime;
  }

  /**
   * Get measurement count
   */
  public getMeasurementCount(): number {
    return this.measurementCount;
  }

  /**
   * Check if preintegration has enough data
   */
  public hasEnoughData(minMeasurements: number = 5): boolean {
    return this.measurementCount >= minMeasurements;
  }

  /**
   * Get the covariance matrix diagonal (uncertainty in each dimension)
   */
  public getCovarianceDiagonal(): {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    rotation: THREE.Vector3;
  } {
    return {
      position: new THREE.Vector3(
        Math.sqrt(Math.max(0, this.covariance[0])),
        Math.sqrt(Math.max(0, this.covariance[10])),
        Math.sqrt(Math.max(0, this.covariance[20]))
      ),
      velocity: new THREE.Vector3(
        Math.sqrt(Math.max(0, this.covariance[30])),
        Math.sqrt(Math.max(0, this.covariance[40])),
        Math.sqrt(Math.max(0, this.covariance[50]))
      ),
      rotation: new THREE.Vector3(
        Math.sqrt(Math.max(0, this.covariance[60])),
        Math.sqrt(Math.max(0, this.covariance[70])),
        Math.sqrt(Math.max(0, this.covariance[80]))
      ),
    };
  }

  /**
   * Reset preintegration
   */
  public reset(newBiases?: IMUBiases): void {
    this.deltaPosition.set(0, 0, 0);
    this.deltaVelocity.set(0, 0, 0);
    this.deltaRotation.set(0, 0, 0, 1);
    this.covariance.fill(0);
    this.integrationTime = 0;
    this.measurementCount = 0;
    this.lastTimestamp = 0;

    this.initializeJacobians();

    if (newBiases) {
      this.biases = {
        accelerometerBias: newBiases.accelerometerBias.clone(),
        gyroscopeBias: newBiases.gyroscopeBias.clone(),
      };
    }
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.reset();
  }
}

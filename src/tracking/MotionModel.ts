import * as THREE from "three";
import type { CameraPose, MotionPrediction, CameraIntrinsics } from "../types/Pose";
import type { Feature } from "../types/Feature";

/**
 * Motion Model Options
 */
export interface MotionModelOptions {
  /** Velocity decay factor (0-1). Default: 0.95 */
  velocityDecay?: number;
  /** Maximum velocity magnitude (pixels/frame). Default: 50 */
  maxVelocity?: number;
  /** Search region scale factor. Default: 2.0 */
  searchRegionScale?: number;
  /** Minimum velocity magnitude to consider motion. Default: 0.1 */
  minVelocityThreshold?: number;
  /** Maximum prediction time horizon (ms). Default: 100 */
  maxPredictionTimeMs?: number;
}

/**
 * Motion Model
 *
 * Implements constant velocity motion model for camera pose prediction.
 * Used to predict feature positions in the next frame for guided matching.
 *
 * The model tracks:
 * - Linear velocity (translation rate)
 * - Angular velocity (rotation rate)
 *
 * Predictions decay over time to handle motion changes.
 */
export class MotionModel {
  private velocityDecay: number;
  private maxVelocity: number;
  private searchRegionScale: number;
  private minVelocityThreshold: number;
  private maxPredictionTimeMs: number;

  private previousPose: CameraPose | null = null;
  private linearVelocity: THREE.Vector3 = new THREE.Vector3();
  private angularVelocity: THREE.Quaternion = new THREE.Quaternion();
  private lastUpdateTimestamp: number = 0;
  private velocityInitialized: boolean = false;

  constructor(options?: MotionModelOptions) {
    this.velocityDecay = options?.velocityDecay ?? 0.95;
    this.maxVelocity = options?.maxVelocity ?? 50;
    this.searchRegionScale = options?.searchRegionScale ?? 2.0;
    this.minVelocityThreshold = options?.minVelocityThreshold ?? 0.1;
    this.maxPredictionTimeMs = options?.maxPredictionTimeMs ?? 100;
  }

  /**
   * Update motion model with new camera pose
   *
   * @param currentPose Current camera pose
   */
  public update(currentPose: CameraPose): void {
    if (this.previousPose && currentPose.timestamp > this.previousPose.timestamp) {
      const deltaTime = currentPose.timestamp - this.previousPose.timestamp;

      if (deltaTime > 0) {
        // Compute linear velocity
        const newLinearVelocity = new THREE.Vector3()
          .subVectors(currentPose.translation, this.previousPose.translation)
          .divideScalar(deltaTime);

        // Clamp velocity magnitude
        const velocityMagnitude = newLinearVelocity.length();
        if (velocityMagnitude > this.maxVelocity) {
          newLinearVelocity.normalize().multiplyScalar(this.maxVelocity);
        }

        // Smooth velocity update with decay
        if (this.velocityInitialized) {
          this.linearVelocity.lerp(newLinearVelocity, 1 - this.velocityDecay);
        } else {
          this.linearVelocity.copy(newLinearVelocity);
          this.velocityInitialized = true;
        }

        // Compute angular velocity as quaternion difference
        const previousInverse = this.previousPose.quaternion.clone().invert();
        const deltaRotation = currentPose.quaternion.clone().multiply(previousInverse);

        // Smooth angular velocity
        if (this.velocityInitialized) {
          this.angularVelocity.slerp(deltaRotation, 1 - this.velocityDecay);
        } else {
          this.angularVelocity.copy(deltaRotation);
        }
      }
    }

    this.previousPose = {
      rotation: currentPose.rotation.clone(),
      translation: currentPose.translation.clone(),
      quaternion: currentPose.quaternion.clone(),
      timestamp: currentPose.timestamp,
      confidence: currentPose.confidence,
    };
    this.lastUpdateTimestamp = currentPose.timestamp;
  }

  /**
   * Predict camera pose at a future timestamp
   *
   * @param timestamp Target timestamp for prediction
   * @returns Predicted pose
   */
  public predictPose(timestamp: number): CameraPose | null {
    if (!this.previousPose || !this.velocityInitialized) {
      return this.previousPose;
    }

    const deltaTime = Math.min(
      timestamp - this.lastUpdateTimestamp,
      this.maxPredictionTimeMs
    );

    if (deltaTime <= 0) {
      return this.previousPose;
    }

    // Apply velocity decay for longer predictions
    const decayFactor = Math.pow(this.velocityDecay, deltaTime / 16.67); // Assuming 60fps base

    // Predict translation
    const predictedTranslation = this.previousPose.translation
      .clone()
      .add(this.linearVelocity.clone().multiplyScalar(deltaTime * decayFactor));

    // Predict rotation using SLERP from identity to angular velocity
    const predictedQuaternion = this.previousPose.quaternion.clone();
    const scaledAngularVelocity = new THREE.Quaternion().slerpQuaternions(
      new THREE.Quaternion(),
      this.angularVelocity,
      deltaTime * decayFactor
    );
    predictedQuaternion.multiply(scaledAngularVelocity);

    // Convert quaternion to rotation matrix
    const predictedRotation = new THREE.Matrix3();
    const rotationMatrix4 = new THREE.Matrix4().makeRotationFromQuaternion(
      predictedQuaternion
    );
    predictedRotation.setFromMatrix4(rotationMatrix4);

    return {
      rotation: predictedRotation,
      translation: predictedTranslation,
      quaternion: predictedQuaternion,
      timestamp,
      confidence: this.previousPose.confidence * decayFactor,
    };
  }

  /**
   * Predict feature position in next frame
   *
   * @param feature Feature to predict position for
   * @param intrinsics Camera intrinsic parameters
   * @param deltaTimeMs Time delta for prediction (ms)
   * @returns Motion prediction with search region
   */
  public predictFeaturePosition(
    feature: Feature,
    intrinsics: CameraIntrinsics,
    deltaTimeMs: number = 16.67
  ): MotionPrediction {
    // Default prediction: same position with standard search region
    const defaultSearchRadius = 20 * this.searchRegionScale;
    const defaultPrediction: MotionPrediction = {
      predictedPosition: { x: feature.x, y: feature.y },
      searchRegion: {
        minX: Math.max(0, feature.x - defaultSearchRadius),
        minY: Math.max(0, feature.y - defaultSearchRadius),
        maxX: feature.x + defaultSearchRadius,
        maxY: feature.y + defaultSearchRadius,
      },
      confidence: 0.5,
    };

    if (!this.velocityInitialized || !this.previousPose) {
      return defaultPrediction;
    }

    // Apply velocity decay
    const decayFactor = Math.pow(this.velocityDecay, deltaTimeMs / 16.67);
    const scaledVelocity = this.linearVelocity.clone().multiplyScalar(decayFactor);

    // Skip if velocity is too small
    if (scaledVelocity.length() < this.minVelocityThreshold) {
      return defaultPrediction;
    }

    // Convert image point to normalized coordinates
    const normalizedX = (feature.x - intrinsics.cx) / intrinsics.fx;
    const normalizedY = (feature.y - intrinsics.cy) / intrinsics.fy;

    // Create 3D ray direction (assuming point is at unit depth)
    const rayDirection = new THREE.Vector3(normalizedX, normalizedY, 1).normalize();

    // Apply predicted rotation
    const scaledAngularVelocity = new THREE.Quaternion().slerpQuaternions(
      new THREE.Quaternion(),
      this.angularVelocity,
      deltaTimeMs * decayFactor
    );
    const rotatedDirection = rayDirection.clone().applyQuaternion(scaledAngularVelocity);

    // Project back to image coordinates
    const predictedX = rotatedDirection.x / rotatedDirection.z * intrinsics.fx + intrinsics.cx;
    const predictedY = rotatedDirection.y / rotatedDirection.z * intrinsics.fy + intrinsics.cy;

    // Add translation effect (approximation for nearby points)
    const translationEffect = scaledVelocity.clone().multiplyScalar(deltaTimeMs);
    const finalX = predictedX + translationEffect.x;
    const finalY = predictedY + translationEffect.y;

    // Compute search region based on velocity magnitude
    const velocityMagnitude = scaledVelocity.length();
    const searchRadius = Math.max(10, velocityMagnitude * deltaTimeMs) * this.searchRegionScale;

    // Clamp to image bounds if known
    const clampedMinX = intrinsics.width
      ? Math.max(0, Math.min(intrinsics.width, finalX - searchRadius))
      : finalX - searchRadius;
    const clampedMinY = intrinsics.height
      ? Math.max(0, Math.min(intrinsics.height, finalY - searchRadius))
      : finalY - searchRadius;
    const clampedMaxX = intrinsics.width
      ? Math.max(0, Math.min(intrinsics.width, finalX + searchRadius))
      : finalX + searchRadius;
    const clampedMaxY = intrinsics.height
      ? Math.max(0, Math.min(intrinsics.height, finalY + searchRadius))
      : finalY + searchRadius;

    // Confidence based on velocity stability and time horizon
    const timeConfidence = Math.exp(-deltaTimeMs / this.maxPredictionTimeMs);
    const velocityConfidence = Math.min(1, velocityMagnitude / this.maxVelocity);

    return {
      predictedPosition: { x: finalX, y: finalY },
      searchRegion: {
        minX: clampedMinX,
        minY: clampedMinY,
        maxX: clampedMaxX,
        maxY: clampedMaxY,
      },
      confidence: timeConfidence * (0.5 + 0.5 * velocityConfidence),
    };
  }

  /**
   * Get predicted search regions for multiple features
   *
   * @param features Features to predict
   * @param intrinsics Camera intrinsic parameters
   * @param deltaTimeMs Time delta for prediction
   * @returns Map of feature ID to motion prediction
   */
  public getPredictedSearchRegions(
    features: Feature[],
    intrinsics: CameraIntrinsics,
    deltaTimeMs: number = 16.67
  ): Map<string, MotionPrediction> {
    const predictions = new Map<string, MotionPrediction>();

    for (const feature of features) {
      if (feature.id) {
        const prediction = this.predictFeaturePosition(feature, intrinsics, deltaTimeMs);
        predictions.set(feature.id, prediction);
      }
    }

    return predictions;
  }

  /**
   * Get current linear velocity
   */
  public getLinearVelocity(): THREE.Vector3 {
    return this.linearVelocity.clone();
  }

  /**
   * Get current angular velocity (as quaternion)
   */
  public getAngularVelocity(): THREE.Quaternion {
    return this.angularVelocity.clone();
  }

  /**
   * Get velocity magnitude
   */
  public getVelocityMagnitude(): number {
    return this.linearVelocity.length();
  }

  /**
   * Check if motion model is initialized with velocity data
   */
  public isInitialized(): boolean {
    return this.velocityInitialized;
  }

  /**
   * Check if camera is moving based on velocity threshold
   */
  public isMoving(): boolean {
    return this.linearVelocity.length() > this.minVelocityThreshold;
  }

  /**
   * Update options
   */
  public updateOptions(options: Partial<MotionModelOptions>): void {
    if (options.velocityDecay !== undefined) {
      this.velocityDecay = options.velocityDecay;
    }
    if (options.maxVelocity !== undefined) {
      this.maxVelocity = options.maxVelocity;
    }
    if (options.searchRegionScale !== undefined) {
      this.searchRegionScale = options.searchRegionScale;
    }
    if (options.minVelocityThreshold !== undefined) {
      this.minVelocityThreshold = options.minVelocityThreshold;
    }
    if (options.maxPredictionTimeMs !== undefined) {
      this.maxPredictionTimeMs = options.maxPredictionTimeMs;
    }
  }

  /**
   * Reset motion model state
   */
  public reset(): void {
    this.previousPose = null;
    this.linearVelocity.set(0, 0, 0);
    this.angularVelocity.identity();
    this.lastUpdateTimestamp = 0;
    this.velocityInitialized = false;
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.reset();
  }
}

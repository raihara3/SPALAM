import { Feature } from "../types/Feature";
import { DeviceMotionTracker } from "./DeviceMotionTracker";

/**
 * Feature pair for distance tracking
 */
interface FeaturePair {
  id1: string;
  id2: string;
  initialDistance: number;
  currentDistance: number;
  trackedFrames: number;
}

/**
 * Distance Tracker Options
 */
export interface DistanceTrackerOptions {
  /** Minimum tracked frames for a pair to be considered stable. Default: 10 */
  minTrackedFrames?: number;
  /** Maximum number of feature pairs to track. Default: 20 */
  maxPairs?: number;
  /** Minimum pixel distance for a valid pair. Default: 50 */
  minPairDistance?: number;
  /** DeviceMotionTracker for stationary detection. Optional. */
  deviceMotionTracker?: DeviceMotionTracker;
  /** Linear acceleration threshold for stationary detection (m/s²). Default: 0.3 */
  stationaryAccelerationThreshold?: number;
  /** Angular velocity threshold for stationary detection (deg/s). Default: 5.0 */
  stationaryAngularVelocityThreshold?: number;
}

/**
 * Distance Tracker
 *
 * Tracks the distance between feature point pairs to estimate
 * relative camera movement (approaching or receding from the plane).
 *
 * When the camera moves closer:
 * - Feature points appear to spread apart (larger distances)
 * - Scale factor > 1.0
 *
 * When the camera moves farther:
 * - Feature points appear to converge (smaller distances)
 * - Scale factor < 1.0
 */
export class DistanceTracker {
  private featurePairs: Map<string, FeaturePair> = new Map();
  private currentScale: number = 1.0;
  private initialDepth: number = 1.0;
  private currentDepth: number = 1.0;

  private minTrackedFrames: number;
  private maxPairs: number;
  private minPairDistance: number;

  private deviceMotionTracker: DeviceMotionTracker | null;
  private stationaryAccelerationThreshold: number;
  private stationaryAngularVelocityThreshold: number;

  constructor(options?: DistanceTrackerOptions) {
    this.minTrackedFrames = options?.minTrackedFrames ?? 10;
    this.maxPairs = options?.maxPairs ?? 20;
    this.minPairDistance = options?.minPairDistance ?? 50;
    this.deviceMotionTracker = options?.deviceMotionTracker ?? null;
    this.stationaryAccelerationThreshold =
      options?.stationaryAccelerationThreshold ?? 0.3;
    this.stationaryAngularVelocityThreshold =
      options?.stationaryAngularVelocityThreshold ?? 5.0;
  }

  /**
   * Set the initial depth reference
   */
  public setInitialDepth(depth: number): void {
    this.initialDepth = depth;
    this.currentDepth = depth;
  }

  /**
   * Update tracking with current frame features
   *
   * @param features Current frame features
   * @returns Updated scale factor
   */
  public update(features: Feature[]): number {
    if (features.length < 2) {
      return this.currentScale;
    }

    // Build feature map for quick lookup
    const featureMap = new Map<string, Feature>();
    for (const feature of features) {
      featureMap.set(feature.id, feature);
    }

    // Update existing pairs
    const validPairs: FeaturePair[] = [];
    for (const [, pair] of this.featurePairs) {
      const feature1 = featureMap.get(pair.id1);
      const feature2 = featureMap.get(pair.id2);

      if (feature1 && feature2) {
        // Both features still visible
        const currentDistance = this.calculateDistance(feature1, feature2);

        if (currentDistance >= this.minPairDistance) {
          pair.currentDistance = currentDistance;
          pair.trackedFrames++;
          validPairs.push(pair);
        }
      }
    }

    // Remove invalid pairs
    this.featurePairs.clear();
    for (const pair of validPairs) {
      const pairId = this.createPairId(pair.id1, pair.id2);
      this.featurePairs.set(pairId, pair);
    }

    // Add new pairs if needed
    this.addNewPairs(features);

    // Calculate scale from stable pairs
    const rawScale = this.calculateScale();
    if (rawScale !== null) {
      // Check if scale update should be skipped (stationary or rotating)
      if (this.shouldSkipScaleUpdate()) {
        // Keep current scale, ignore feature-based changes
        return this.currentScale;
      }

      // Apply raw scale directly (no smoothing)
      this.currentScale = rawScale;

      // Update depth estimate
      this.currentDepth = this.initialDepth / this.currentScale;
    }

    return this.currentScale;
  }

  /**
   * Calculate distance between two features
   */
  private calculateDistance(feature1: Feature, feature2: Feature): number {
    const dx = feature1.x - feature2.x;
    const dy = feature1.y - feature2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Check if scale update should be skipped using IMU data.
   *
   * Scale updates should be skipped when:
   * - Device is stationary (no movement, no rotation) - changes are noise
   * - Device is rotating (even without translation) - perspective changes cause false scale detection
   *
   * Scale updates should only occur when device is translating forward/backward without significant rotation.
   */
  private shouldSkipScaleUpdate(): boolean {
    if (!this.deviceMotionTracker || !this.deviceMotionTracker.isTracking()) {
      return false;
    }

    const linearAcceleration = this.deviceMotionTracker.getLinearAcceleration();
    const angularVelocity = this.deviceMotionTracker.getAngularVelocity();

    if (!linearAcceleration || !angularVelocity) {
      return false;
    }

    const accelerationMagnitude = linearAcceleration.length();
    const angularMagnitude = angularVelocity.length();

    // Skip if stationary (both acceleration and rotation are small)
    const isStationary =
      accelerationMagnitude < this.stationaryAccelerationThreshold &&
      angularMagnitude < this.stationaryAngularVelocityThreshold;

    // Skip if rotating (rotation causes perspective changes, not real scale changes)
    const isRotating =
      angularMagnitude >= this.stationaryAngularVelocityThreshold;

    return isStationary || isRotating;
  }

  /**
   * Create a unique pair ID
   */
  private createPairId(id1: string, id2: string): string {
    return id1 < id2 ? `${id1}:${id2}` : `${id2}:${id1}`;
  }

  /**
   * Add new feature pairs
   */
  private addNewPairs(features: Feature[]): void {
    if (this.featurePairs.size >= this.maxPairs) {
      return;
    }

    // Filter stable features (high tracking count - stricter threshold)
    const stableFeatures = features
      .filter((f) => f.trackingCount >= 15)
      .sort((a, b) => b.trackingCount - a.trackingCount)
      .slice(0, 10);

    // Create pairs from stable features
    for (
      let i = 0;
      i < stableFeatures.length && this.featurePairs.size < this.maxPairs;
      i++
    ) {
      for (
        let j = i + 1;
        j < stableFeatures.length && this.featurePairs.size < this.maxPairs;
        j++
      ) {
        const feature1 = stableFeatures[i];
        const feature2 = stableFeatures[j];
        const pairId = this.createPairId(feature1.id, feature2.id);

        if (!this.featurePairs.has(pairId)) {
          const distance = this.calculateDistance(feature1, feature2);

          if (distance >= this.minPairDistance) {
            // Normalize initialDistance by current scale to prevent drift
            // This ensures all pairs use scale=1.0 as their reference
            const normalizedInitialDistance = distance / this.currentScale;

            this.featurePairs.set(pairId, {
              id1: feature1.id,
              id2: feature2.id,
              initialDistance: normalizedInitialDistance,
              currentDistance: distance,
              trackedFrames: 1,
            });
          }
        }
      }
    }
  }

  /**
   * Calculate scale factor from tracked pairs
   */
  private calculateScale(): number | null {
    const stablePairs = Array.from(this.featurePairs.values()).filter(
      (pair) => pair.trackedFrames >= this.minTrackedFrames
    );

    if (stablePairs.length === 0) {
      return null;
    }

    // Calculate weighted average scale
    let totalWeight = 0;
    let weightedScaleSum = 0;

    for (const pair of stablePairs) {
      const scale = pair.currentDistance / pair.initialDistance;
      const weight = pair.trackedFrames;

      weightedScaleSum += scale * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedScaleSum / totalWeight : null;
  }

  /**
   * Get the current scale factor
   *
   * - > 1.0: Camera is closer to the plane
   * - < 1.0: Camera is farther from the plane
   * - = 1.0: Same distance as initial detection
   */
  public getScale(): number {
    return this.currentScale;
  }

  /**
   * Get the estimated current depth
   */
  public getDepth(): number {
    return this.currentDepth;
  }

  /**
   * Get the depth change ratio (current / initial)
   */
  public getDepthRatio(): number {
    return this.initialDepth > 0 ? this.currentDepth / this.initialDepth : 1.0;
  }

  /**
   * Get the number of tracked pairs
   */
  public getTrackedPairCount(): number {
    return this.featurePairs.size;
  }

  /**
   * Get the number of stable pairs
   */
  public getStablePairCount(): number {
    return Array.from(this.featurePairs.values()).filter(
      (pair) => pair.trackedFrames >= this.minTrackedFrames
    ).length;
  }

  /**
   * Get statistics
   */
  public getStatistics(): {
    scale: number;
    depth: number;
    depthRatio: number;
    trackedPairs: number;
    stablePairs: number;
  } {
    return {
      scale: this.currentScale,
      depth: this.currentDepth,
      depthRatio: this.getDepthRatio(),
      trackedPairs: this.getTrackedPairCount(),
      stablePairs: this.getStablePairCount(),
    };
  }

  /**
   * Reset the tracker
   */
  public reset(): void {
    this.featurePairs.clear();
    this.currentScale = 1.0;
    this.currentDepth = this.initialDepth;
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.featurePairs.clear();
  }
}

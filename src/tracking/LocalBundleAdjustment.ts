/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import type {
  Keyframe,
  MapPoint,
  CameraPose,
  CameraIntrinsics,
  BundleAdjustmentResult,
} from "../types/Pose";
import type { Feature } from "../types/Feature";

/**
 * Local Bundle Adjustment Options
 */
export interface LocalBundleAdjustmentOptions {
  /** Sliding window size (number of keyframes). Default: 7 */
  windowSize?: number;
  /** Maximum optimization iterations. Default: 10 */
  maxIterations?: number;
  /** Convergence threshold for cost reduction. Default: 1e-6 */
  convergenceThreshold?: number;
  /** Minimum frames between keyframes. Default: 10 */
  keyframeInterval?: number;
  /** Minimum parallax for new keyframe (radians). Default: 0.03 */
  minParallax?: number;
  /** Minimum tracked features for new keyframe. Default: 50 */
  minTrackedFeatures?: number;
  /** Huber loss threshold for robust optimization. Default: 5.99 */
  huberThreshold?: number;
}

/**
 * Observation for bundle adjustment
 */
interface Observation {
  keyframeId: number;
  featureIndex: number;
  point2D: { x: number; y: number };
}

/**
 * Local Bundle Adjustment
 *
 * Implements sliding window bundle adjustment for local map optimization.
 * Optimizes camera poses and 3D point positions within a local window
 * to minimize reprojection error.
 *
 * Features:
 * - Sliding window to limit computation
 * - Keyframe selection based on parallax and feature count
 * - Huber loss for robust optimization
 * - Gauss-Newton optimization with damping
 */
export class LocalBundleAdjustment {
  private intrinsics: CameraIntrinsics;
  private windowSize: number;
  private maxIterations: number;
  private convergenceThreshold: number;
  private keyframeInterval: number;
  private minParallax: number;
  private minTrackedFeatures: number;
  private huberThreshold: number;

  private keyframes: Map<number, Keyframe> = new Map();
  private mapPoints: Map<string, MapPoint> = new Map();
  private nextKeyframeId: number = 0;
  private framesSinceLastKeyframe: number = 0;

  constructor(intrinsics: CameraIntrinsics, options?: LocalBundleAdjustmentOptions) {
    this.intrinsics = intrinsics;
    this.windowSize = options?.windowSize ?? 7;
    this.maxIterations = options?.maxIterations ?? 10;
    this.convergenceThreshold = options?.convergenceThreshold ?? 1e-6;
    this.keyframeInterval = options?.keyframeInterval ?? 10;
    this.minParallax = options?.minParallax ?? 0.03;
    this.minTrackedFeatures = options?.minTrackedFeatures ?? 50;
    this.huberThreshold = options?.huberThreshold ?? 5.99;
  }

  /**
   * Add a new keyframe
   */
  public addKeyframe(keyframe: Keyframe): number {
    const id = this.nextKeyframeId++;
    const keyframeWithId: Keyframe = {
      ...keyframe,
      id,
    };

    this.keyframes.set(id, keyframeWithId);
    this.framesSinceLastKeyframe = 0;

    // Maintain sliding window
    this.pruneOldKeyframes();

    return id;
  }

  /**
   * Add or update a map point
   */
  public addMapPoint(point: MapPoint): void {
    this.mapPoints.set(point.id, point);
  }

  /**
   * Add observation linking keyframe to map point
   */
  public addObservation(
    mapPointId: string,
    keyframeId: number,
    featureIndex: number
  ): void {
    const mapPoint = this.mapPoints.get(mapPointId);
    if (mapPoint) {
      mapPoint.observations.set(keyframeId, featureIndex);
      mapPoint.observationCount = mapPoint.observations.size;
    }
  }

  /**
   * Check if a new keyframe should be added
   */
  public shouldAddKeyframe(
    currentPose: CameraPose,
    trackedFeatures: Feature[]
  ): boolean {
    this.framesSinceLastKeyframe++;

    // Minimum interval between keyframes
    if (this.framesSinceLastKeyframe < this.keyframeInterval) {
      return false;
    }

    // Need enough tracked features
    if (trackedFeatures.length < this.minTrackedFeatures) {
      return true; // Force keyframe if tracking is failing
    }

    // Check parallax with last keyframe
    const lastKeyframe = this.getLastKeyframe();
    if (!lastKeyframe) {
      return true; // First keyframe
    }

    const parallax = this.calculateParallax(lastKeyframe.pose, currentPose);
    return parallax >= this.minParallax;
  }

  /**
   * Calculate parallax angle between two poses
   */
  private calculateParallax(pose1: CameraPose, pose2: CameraPose): number {
    const direction1 = new THREE.Vector3(0, 0, 1).applyQuaternion(pose1.quaternion);
    const direction2 = new THREE.Vector3(0, 0, 1).applyQuaternion(pose2.quaternion);

    const dot = direction1.dot(direction2);
    return Math.acos(Math.max(-1, Math.min(1, dot)));
  }

  /**
   * Get the most recent keyframe
   */
  public getLastKeyframe(): Keyframe | null {
    let lastKeyframe: Keyframe | null = null;
    let maxId = -1;

    for (const [id, keyframe] of this.keyframes) {
      if (id > maxId) {
        maxId = id;
        lastKeyframe = keyframe;
      }
    }

    return lastKeyframe;
  }

  /**
   * Run bundle adjustment optimization
   */
  public optimize(): BundleAdjustmentResult {
    const keyframeArray = Array.from(this.keyframes.values());
    const mapPointArray = Array.from(this.mapPoints.values()).filter(
      (p) => p.isValid && p.observationCount >= 2
    );

    if (keyframeArray.length < 2 || mapPointArray.length < 3) {
      return {
        optimizedPoses: new Map(),
        optimizedPoints: new Map(),
        finalCost: 0,
        initialCost: 0,
        iterations: 0,
        converged: true,
      };
    }

    // Index keyframes once; the optimization inner loops perform many
    // lookups and linear scans would dominate the cost
    const keyframeById = new Map<number, Keyframe>();
    for (const keyframe of keyframeArray) {
      keyframeById.set(keyframe.id, keyframe);
    }

    // Calculate initial cost
    const initialCost = this.calculateTotalCost(keyframeById, mapPointArray);

    // Run Gauss-Newton optimization
    let currentCost = initialCost;
    let iterations = 0;
    let converged = false;

    for (let iter = 0; iter < this.maxIterations; iter++) {
      iterations++;

      // Optimize map points (holding poses fixed)
      this.optimizeMapPoints(keyframeById, mapPointArray);

      // Optimize poses (holding points fixed) - skip first keyframe (fixed)
      if (keyframeArray.length > 1) {
        this.optimizePoses(keyframeArray.slice(1), mapPointArray);
      }

      // Calculate new cost
      const newCost = this.calculateTotalCost(keyframeById, mapPointArray);

      // Check convergence (guard against zero/non-finite costs, which
      // would make the reduction NaN and disable early termination)
      const costReduction =
        currentCost > 0 && Number.isFinite(currentCost)
          ? (currentCost - newCost) / currentCost
          : 0;
      if (Math.abs(costReduction) < this.convergenceThreshold) {
        converged = true;
        currentCost = newCost;
        break;
      }

      currentCost = newCost;
    }

    // Build result
    const optimizedPoses = new Map<number, CameraPose>();
    for (const keyframe of keyframeArray) {
      optimizedPoses.set(keyframe.id, keyframe.pose);
    }

    const optimizedPoints = new Map<string, THREE.Vector3>();
    for (const point of mapPointArray) {
      optimizedPoints.set(point.id, point.position.clone());
    }

    return {
      optimizedPoses,
      optimizedPoints,
      finalCost: currentCost,
      initialCost,
      iterations,
      converged,
    };
  }

  /**
   * Calculate total reprojection cost
   */
  private calculateTotalCost(
    keyframeById: Map<number, Keyframe>,
    mapPoints: MapPoint[]
  ): number {
    let totalCost = 0;

    for (const point of mapPoints) {
      for (const [keyframeId, featureIndex] of point.observations) {
        const keyframe = keyframeById.get(keyframeId);
        if (!keyframe || featureIndex >= keyframe.features.length) {
          continue;
        }

        const feature = keyframe.features[featureIndex];
        const projected = this.projectPoint(point.position, keyframe.pose);
        const error = Math.sqrt(
          Math.pow(projected.x - feature.x, 2) +
            Math.pow(projected.y - feature.y, 2)
        );

        // Points behind the camera project to Infinity; skip them instead
        // of poisoning the cost
        if (!Number.isFinite(error)) {
          continue;
        }

        // Huber loss
        if (error <= this.huberThreshold) {
          totalCost += 0.5 * error * error;
        } else {
          totalCost +=
            this.huberThreshold * (error - 0.5 * this.huberThreshold);
        }
      }
    }

    return totalCost;
  }

  /**
   * Optimize map point positions using Gauss-Newton
   */
  private optimizeMapPoints(
    keyframeById: Map<number, Keyframe>,
    mapPoints: MapPoint[]
  ): void {
    for (const point of mapPoints) {
      const observations = this.getValidObservations(point, keyframeById);
      if (observations.length < 2) {
        continue;
      }

      // Simple gradient descent step for each point
      const gradient = new THREE.Vector3();
      let hessianDiag = 0;

      for (const obs of observations) {
        const keyframe = keyframeById.get(obs.keyframeId)!;
        const feature = keyframe.features[obs.featureIndex];

        const projected = this.projectPoint(point.position, keyframe.pose);
        const errorX = projected.x - feature.x;
        const errorY = projected.y - feature.y;

        // Skip observations behind the camera: Infinity errors would turn
        // the numeric Jacobian into NaN and corrupt the point position
        if (!Number.isFinite(errorX) || !Number.isFinite(errorY)) {
          continue;
        }

        // Compute Jacobian numerically
        const delta = 0.001;
        const jacobian = this.computePointJacobian(
          point.position,
          keyframe.pose,
          delta
        );
        if (!jacobian.every(Number.isFinite)) {
          continue;
        }

        // Accumulate gradient and Hessian approximation
        gradient.x += jacobian[0] * errorX + jacobian[1] * errorY;
        gradient.y += jacobian[2] * errorX + jacobian[3] * errorY;
        gradient.z += jacobian[4] * errorX + jacobian[5] * errorY;

        hessianDiag +=
          jacobian[0] * jacobian[0] +
          jacobian[1] * jacobian[1] +
          jacobian[2] * jacobian[2] +
          jacobian[3] * jacobian[3] +
          jacobian[4] * jacobian[4] +
          jacobian[5] * jacobian[5];
      }

      if (hessianDiag > 1e-10 && Number.isFinite(hessianDiag)) {
        const stepSize = 1.0 / (hessianDiag + 1e-6);
        gradient.multiplyScalar(stepSize);
        if (
          Number.isFinite(gradient.x) &&
          Number.isFinite(gradient.y) &&
          Number.isFinite(gradient.z)
        ) {
          point.position.sub(gradient);
        }
      }
    }
  }

  /**
   * Optimize camera poses using Gauss-Newton
   */
  private optimizePoses(keyframes: Keyframe[], mapPoints: MapPoint[]): void {
    for (const keyframe of keyframes) {
      // Collect observations for this keyframe
      const observations: Array<{
        point: MapPoint;
        featureIndex: number;
      }> = [];

      for (const point of mapPoints) {
        const featureIndex = point.observations.get(keyframe.id);
        if (featureIndex !== undefined && featureIndex < keyframe.features.length) {
          observations.push({ point, featureIndex });
        }
      }

      if (observations.length < 3) {
        continue;
      }

      // Simple translation update (simplified optimization)
      const translationGradient = new THREE.Vector3();

      for (const obs of observations) {
        const feature = keyframe.features[obs.featureIndex];
        const projected = this.projectPoint(obs.point.position, keyframe.pose);

        const errorX = projected.x - feature.x;
        const errorY = projected.y - feature.y;
        if (!Number.isFinite(errorX) || !Number.isFinite(errorY)) {
          continue;
        }

        // Approximate Jacobian for translation
        const depth = this.calculateDepth(obs.point.position, keyframe.pose);
        if (depth > 0.1) {
          translationGradient.x -= errorX * this.intrinsics.fx / depth;
          translationGradient.y -= errorY * this.intrinsics.fy / depth;
          translationGradient.z -=
            (errorX * (obs.point.position.x - keyframe.pose.translation.x) +
              errorY * (obs.point.position.y - keyframe.pose.translation.y)) /
            (depth * depth);
        }
      }

      // Apply damped update
      const stepSize = 0.01;
      keyframe.pose.translation.add(
        translationGradient.multiplyScalar(stepSize / observations.length)
      );
    }
  }

  /**
   * Compute numerical Jacobian for point projection
   */
  private computePointJacobian(
    point: THREE.Vector3,
    pose: CameraPose,
    delta: number
  ): number[] {
    const jacobian: number[] = [];

    for (let i = 0; i < 3; i++) {
      const pointPlus = point.clone();
      const pointMinus = point.clone();

      if (i === 0) {
        pointPlus.x += delta;
        pointMinus.x -= delta;
      } else if (i === 1) {
        pointPlus.y += delta;
        pointMinus.y -= delta;
      } else {
        pointPlus.z += delta;
        pointMinus.z -= delta;
      }

      const projPlus = this.projectPoint(pointPlus, pose);
      const projMinus = this.projectPoint(pointMinus, pose);

      jacobian.push((projPlus.x - projMinus.x) / (2 * delta));
      jacobian.push((projPlus.y - projMinus.y) / (2 * delta));
    }

    return jacobian;
  }

  /**
   * Get valid observations for a map point
   */
  private getValidObservations(
    point: MapPoint,
    keyframeById: Map<number, Keyframe>
  ): Observation[] {
    const observations: Observation[] = [];

    for (const [keyframeId, featureIndex] of point.observations) {
      const keyframe = keyframeById.get(keyframeId);
      if (keyframe && featureIndex < keyframe.features.length) {
        observations.push({
          keyframeId,
          featureIndex,
          point2D: {
            x: keyframe.features[featureIndex].x,
            y: keyframe.features[featureIndex].y,
          },
        });
      }
    }

    return observations;
  }

  /**
   * Project 3D point to image coordinates
   */
  private projectPoint(
    point3D: THREE.Vector3,
    pose: CameraPose
  ): { x: number; y: number } {
    const R = pose.rotation;
    const t = pose.translation;

    // Transform to camera frame
    const relativePoint = point3D.clone().sub(t);
    const Rinv = R.clone().transpose();

    const x =
      Rinv.elements[0] * relativePoint.x +
      Rinv.elements[3] * relativePoint.y +
      Rinv.elements[6] * relativePoint.z;
    const y =
      Rinv.elements[1] * relativePoint.x +
      Rinv.elements[4] * relativePoint.y +
      Rinv.elements[7] * relativePoint.z;
    const z =
      Rinv.elements[2] * relativePoint.x +
      Rinv.elements[5] * relativePoint.y +
      Rinv.elements[8] * relativePoint.z;

    if (z <= 0) {
      return { x: Infinity, y: Infinity };
    }

    return {
      x: this.intrinsics.fx * (x / z) + this.intrinsics.cx,
      y: this.intrinsics.fy * (y / z) + this.intrinsics.cy,
    };
  }

  /**
   * Calculate depth of point in camera frame
   */
  private calculateDepth(point3D: THREE.Vector3, pose: CameraPose): number {
    const R = pose.rotation;
    const t = pose.translation;

    const relativePoint = point3D.clone().sub(t);
    const Rinv = R.clone().transpose();

    return (
      Rinv.elements[2] * relativePoint.x +
      Rinv.elements[5] * relativePoint.y +
      Rinv.elements[8] * relativePoint.z
    );
  }

  /**
   * Remove keyframes outside the sliding window
   */
  private pruneOldKeyframes(): void {
    if (this.keyframes.size <= this.windowSize) {
      return;
    }

    // Sort keyframes by ID and remove oldest
    const sortedIds = Array.from(this.keyframes.keys()).sort((a, b) => a - b);
    const toRemove = sortedIds.slice(0, this.keyframes.size - this.windowSize);

    for (const id of toRemove) {
      const keyframe = this.keyframes.get(id);
      if (keyframe?.descriptors) {
        // Caller is responsible for descriptor cleanup
      }
      this.keyframes.delete(id);

      // Remove observations from map points
      for (const point of this.mapPoints.values()) {
        point.observations.delete(id);
        point.observationCount = point.observations.size;
      }
    }

    // Remove map points with too few observations
    const pointsToRemove: string[] = [];
    for (const [id, point] of this.mapPoints) {
      if (point.observationCount < 2) {
        pointsToRemove.push(id);
      }
    }

    for (const id of pointsToRemove) {
      this.mapPoints.delete(id);
    }
  }

  /**
   * Get all keyframes
   */
  public getKeyframes(): Keyframe[] {
    return Array.from(this.keyframes.values());
  }

  /**
   * Get all map points
   */
  public getMapPoints(): MapPoint[] {
    return Array.from(this.mapPoints.values());
  }

  /**
   * Get keyframe by ID
   */
  public getKeyframe(id: number): Keyframe | undefined {
    return this.keyframes.get(id);
  }

  /**
   * Get map point by ID
   */
  public getMapPoint(id: string): MapPoint | undefined {
    return this.mapPoints.get(id);
  }

  /**
   * Get keyframe count
   */
  public getKeyframeCount(): number {
    return this.keyframes.size;
  }

  /**
   * Get map point count
   */
  public getMapPointCount(): number {
    return this.mapPoints.size;
  }

  /**
   * Mark map point as outlier
   */
  public markAsOutlier(mapPointId: string): void {
    const point = this.mapPoints.get(mapPointId);
    if (point) {
      point.isValid = false;
    }
  }

  /**
   * Update camera intrinsics
   */
  public updateIntrinsics(intrinsics: CameraIntrinsics): void {
    this.intrinsics = intrinsics;
  }

  /**
   * Update options
   */
  public updateOptions(options: Partial<LocalBundleAdjustmentOptions>): void {
    if (options.windowSize !== undefined) {
      this.windowSize = options.windowSize;
    }
    if (options.maxIterations !== undefined) {
      this.maxIterations = options.maxIterations;
    }
    if (options.convergenceThreshold !== undefined) {
      this.convergenceThreshold = options.convergenceThreshold;
    }
    if (options.keyframeInterval !== undefined) {
      this.keyframeInterval = options.keyframeInterval;
    }
    if (options.minParallax !== undefined) {
      this.minParallax = options.minParallax;
    }
    if (options.minTrackedFeatures !== undefined) {
      this.minTrackedFeatures = options.minTrackedFeatures;
    }
    if (options.huberThreshold !== undefined) {
      this.huberThreshold = options.huberThreshold;
    }
  }

  /**
   * Reset all state
   */
  public reset(): void {
    this.keyframes.clear();
    this.mapPoints.clear();
    this.nextKeyframeId = 0;
    this.framesSinceLastKeyframe = 0;
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.reset();
  }
}

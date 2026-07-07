/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import type { Feature } from "../types/Feature";
import type { CameraIntrinsics, CameraPose } from "../types/Pose";
import type { PoseEstimator } from "./PoseEstimator";
import type { Triangulator } from "./Triangulator";
import { extrinsicsToCameraPose } from "../helpers/cameraPoseConversion";
import {
  resolveMetricScale,
  MetricScaleResult,
} from "../helpers/resolveMetricScale";

/**
 * Reason a map initialization attempt was rejected
 */
export type InitializationFailureReason =
  | "no-reference"
  | "insufficient-correspondences"
  | "insufficient-displacement"
  | "essential-matrix-failed"
  | "pose-recovery-failed"
  | "insufficient-parallax"
  | "triangulation-failed"
  | "insufficient-depth-priors";

/**
 * Successful initialization output
 */
export interface InitializationResult {
  /** Reference camera pose (identity at the world origin) */
  referencePose: CameraPose;
  /** Current camera pose in world coordinates, metric-scaled */
  currentPose: CameraPose;
  /** Triangulated landmarks, metric-scaled */
  landmarks: Array<{ id: string; position: THREE.Vector3 }>;
  /** Metric scale applied to the reconstruction */
  scale: MetricScaleResult;
  /** Essential matrix inlier ratio */
  inlierRatio: number;
  /** Median parallax angle of triangulated points (degrees) */
  medianParallaxDegrees: number;
}

/**
 * Outcome of a single initialization attempt
 */
export interface InitializationAttempt {
  /** Whether initialization succeeded */
  success: boolean;
  /** Failure reason when success is false */
  failureReason?: InitializationFailureReason;
  /** Initialization output when success is true */
  result?: InitializationResult;
  /** Number of feature correspondences with the reference frame */
  correspondenceCount: number;
}

/**
 * Map Initializer Options
 */
export interface MapInitializerOptions {
  /** Minimum feature correspondences with the reference frame. Default: 50 */
  minCorrespondences?: number;
  /** Minimum median pixel displacement before attempting. Default: 30 */
  minMedianDisplacementPixels?: number;
  /** Minimum essential-matrix inlier ratio. Default: 0.5 */
  minInlierRatio?: number;
  /** Minimum ratio of points passing the cheirality check. Default: 0.7 */
  minCheiralityRatio?: number;
  /** Minimum valid triangulated points. Default: 30 */
  minTriangulatedPoints?: number;
  /** Minimum median parallax of triangulated points (degrees). Default: 1.0 */
  minMedianParallaxDegrees?: number;
}

/**
 * Map Initializer
 *
 * Bootstraps the monocular map from two views with explicit gating. The
 * essential-matrix decomposition degenerates under pure rotation, planar
 * dominance, and short baselines, so an attempt only succeeds when:
 *
 * 1. enough feature correspondences exist with the reference frame
 * 2. the median pixel displacement indicates actual image motion
 * 3. the essential matrix has sufficient inlier support
 * 4. pose recovery passes the cheirality check
 * 5. triangulated points have sufficient count AND median parallax
 *    (pure rotation produces large displacement but near-zero parallax,
 *    so it is rejected here)
 *
 * The metric scale is fixed at initialization from depth priors so that
 * the map scale and anchor depths stay consistent afterwards.
 */
export class MapInitializer {
  private readonly poseEstimator: Pick<
    PoseEstimator,
    "findEssentialMatrix" | "recoverPose"
  >;
  private readonly triangulator: Pick<Triangulator, "triangulate">;
  private readonly intrinsics: CameraIntrinsics;

  private readonly minCorrespondences: number;
  private readonly minMedianDisplacementPixels: number;
  private readonly minInlierRatio: number;
  private readonly minCheiralityRatio: number;
  private readonly minTriangulatedPoints: number;
  private readonly minMedianParallaxDegrees: number;

  private referenceFeatures: Map<string, { x: number; y: number }> | null =
    null;
  private referenceTimestamp: number = 0;

  constructor(
    dependencies: {
      poseEstimator: Pick<
        PoseEstimator,
        "findEssentialMatrix" | "recoverPose"
      >;
      triangulator: Pick<Triangulator, "triangulate">;
      intrinsics: CameraIntrinsics;
    },
    options?: MapInitializerOptions
  ) {
    this.poseEstimator = dependencies.poseEstimator;
    this.triangulator = dependencies.triangulator;
    this.intrinsics = dependencies.intrinsics;

    this.minCorrespondences = options?.minCorrespondences ?? 50;
    this.minMedianDisplacementPixels =
      options?.minMedianDisplacementPixels ?? 30;
    this.minInlierRatio = options?.minInlierRatio ?? 0.5;
    this.minCheiralityRatio = options?.minCheiralityRatio ?? 0.7;
    this.minTriangulatedPoints = options?.minTriangulatedPoints ?? 30;
    this.minMedianParallaxDegrees = options?.minMedianParallaxDegrees ?? 1.0;
  }

  /**
   * Set the reference frame for two-view initialization
   */
  public setReferenceFrame(features: Feature[], timestamp: number): void {
    this.referenceFeatures = new Map();
    for (const feature of features) {
      this.referenceFeatures.set(feature.id, { x: feature.x, y: feature.y });
    }
    this.referenceTimestamp = timestamp;
  }

  /**
   * Whether a reference frame is set
   */
  public hasReferenceFrame(): boolean {
    return this.referenceFeatures !== null;
  }

  /**
   * Attempt two-view initialization against the reference frame
   *
   * @param features Current frame features (IDs shared with the reference
   *                 via optical flow continuity)
   * @param timestamp Current frame timestamp in milliseconds
   * @param depthPriorByFeatureId Optional metric depth priors keyed by
   *                              feature ID (e.g. sampled from the depth
   *                              network in the reference frame)
   */
  public attemptInitialization(
    features: Feature[],
    timestamp: number,
    depthPriorByFeatureId?: Map<string, number>
  ): InitializationAttempt {
    if (!this.referenceFeatures) {
      return {
        success: false,
        failureReason: "no-reference",
        correspondenceCount: 0,
      };
    }

    // 1) Collect correspondences by feature ID
    const referencePoints: Array<{ x: number; y: number }> = [];
    const currentPoints: Array<{ x: number; y: number }> = [];
    const ids: string[] = [];
    for (const feature of features) {
      const referencePoint = this.referenceFeatures.get(feature.id);
      if (referencePoint) {
        referencePoints.push(referencePoint);
        currentPoints.push({ x: feature.x, y: feature.y });
        ids.push(feature.id);
      }
    }
    const correspondenceCount = ids.length;

    if (correspondenceCount < this.minCorrespondences) {
      return {
        success: false,
        failureReason: "insufficient-correspondences",
        correspondenceCount,
      };
    }

    // 2) Cheap displacement pre-gate (rotation or translation)
    const displacements = referencePoints.map((referencePoint, i) =>
      Math.hypot(
        currentPoints[i].x - referencePoint.x,
        currentPoints[i].y - referencePoint.y
      )
    );
    if (this.median(displacements) < this.minMedianDisplacementPixels) {
      return {
        success: false,
        failureReason: "insufficient-displacement",
        correspondenceCount,
      };
    }

    // 3) Essential matrix with inlier-support gate
    const essentialResult = this.poseEstimator.findEssentialMatrix(
      referencePoints,
      currentPoints
    );
    if (
      !essentialResult ||
      !essentialResult.isValid ||
      essentialResult.inlierCount / correspondenceCount < this.minInlierRatio
    ) {
      return {
        success: false,
        failureReason: "essential-matrix-failed",
        correspondenceCount,
      };
    }

    // 4) Pose recovery with cheirality gate
    const recovery = this.poseEstimator.recoverPose(
      essentialResult.essentialMatrix,
      referencePoints,
      currentPoints,
      essentialResult.inlierMask
    );
    if (
      !recovery ||
      !recovery.isValid ||
      recovery.inFrontCount / essentialResult.inlierCount <
        this.minCheiralityRatio
    ) {
      return {
        success: false,
        failureReason: "pose-recovery-failed",
        correspondenceCount,
      };
    }

    const inlierRatio = essentialResult.inlierCount / correspondenceCount;
    const referencePose: CameraPose = {
      rotation: new THREE.Matrix3().identity(),
      translation: new THREE.Vector3(0, 0, 0),
      quaternion: new THREE.Quaternion(),
      timestamp: this.referenceTimestamp,
      confidence: 1.0,
    };
    const currentPose = extrinsicsToCameraPose(
      recovery.rotation,
      recovery.translation,
      timestamp,
      inlierRatio
    );

    // 5) Triangulate inlier correspondences
    const inlierReferencePoints: Array<{ x: number; y: number }> = [];
    const inlierCurrentPoints: Array<{ x: number; y: number }> = [];
    const inlierIds: string[] = [];
    for (let i = 0; i < correspondenceCount; i++) {
      if (essentialResult.inlierMask[i]) {
        inlierReferencePoints.push(referencePoints[i]);
        inlierCurrentPoints.push(currentPoints[i]);
        inlierIds.push(ids[i]);
      }
    }

    const triangulationResults = this.triangulator.triangulate(
      inlierReferencePoints,
      inlierCurrentPoints,
      referencePose,
      currentPose,
      inlierIds
    );
    const validResults = triangulationResults.filter(
      (result) => result.isValid
    );

    if (validResults.length < this.minTriangulatedPoints) {
      return {
        success: false,
        failureReason: "triangulation-failed",
        correspondenceCount,
      };
    }

    // 6) Parallax gate: pure rotation yields near-zero parallax angles
    const medianParallaxDegrees = THREE.MathUtils.radToDeg(
      this.median(validResults.map((result) => result.parallaxAngle))
    );
    if (medianParallaxDegrees < this.minMedianParallaxDegrees) {
      return {
        success: false,
        failureReason: "insufficient-parallax",
        correspondenceCount,
      };
    }

    // 7) Fix the metric scale from depth priors (reference camera is at the
    //    origin, so the prior-comparable depth is the point's z coordinate)
    let scale: MetricScaleResult = {
      scale: 1,
      sampleCount: 0,
      isReliable: false,
    };
    if (depthPriorByFeatureId && depthPriorByFeatureId.size > 0) {
      const triangulatedDepths: number[] = [];
      const priorDepths: number[] = [];
      for (const result of validResults) {
        const prior = result.id
          ? depthPriorByFeatureId.get(result.id)
          : undefined;
        if (prior !== undefined) {
          triangulatedDepths.push(result.point3D.z);
          priorDepths.push(prior);
        }
      }
      scale = resolveMetricScale({ triangulatedDepths, priorDepths });
    }

    // Apply the scale only when reliable; an unreliable median would warp
    // the whole map, so unit scale (with isReliable=false reported) is safer
    const appliedScale = scale.isReliable ? scale.scale : 1;
    const landmarks = validResults.map((result) => ({
      id: result.id!,
      position: result.point3D.clone().multiplyScalar(appliedScale),
    }));
    currentPose.translation.multiplyScalar(appliedScale);

    return {
      success: true,
      correspondenceCount,
      result: {
        referencePose,
        currentPose,
        landmarks,
        scale,
        inlierRatio,
        medianParallaxDegrees,
      },
    };
  }

  /**
   * Clear the reference frame
   */
  public reset(): void {
    this.referenceFeatures = null;
    this.referenceTimestamp = 0;
  }

  /**
   * Get current camera intrinsics
   */
  public getIntrinsics(): CameraIntrinsics {
    return { ...this.intrinsics };
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.reset();
  }

  private median(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  }
}

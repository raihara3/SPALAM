/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Feature } from "../types/Feature";
import type { CameraPose } from "../types/Pose";
import type { PnPSolver } from "./PnPSolver";
import type { Triangulator } from "./Triangulator";
import type {
  MapInitializer,
  InitializationFailureReason,
} from "./MapInitializer";
import type { LandmarkMap } from "./LandmarkMap";
import { pnpResultToCameraPose } from "../helpers/cameraPoseConversion";

/**
 * Lightweight keyframe used for landmark replenishment
 */
interface ReplenishmentKeyframe {
  /** Camera pose at this keyframe (world coordinates, OpenCV basis) */
  pose: CameraPose;
  /** Feature positions at this keyframe keyed by feature ID */
  featurePositions: Map<string, { x: number; y: number }>;
}

/**
 * Camera tracker status
 */
export type CameraTrackerStatus = "initializing" | "tracking" | "lost";

/**
 * Per-frame camera tracking result
 */
export interface CameraTrackerResult {
  /** Current tracker status */
  status: CameraTrackerStatus;
  /** Camera pose in world coordinates (OpenCV basis), null unless tracking */
  pose: CameraPose | null;
  /** Number of 2D-3D correspondences available this frame */
  correspondenceCount: number;
  /** Number of PnP inliers (0 unless tracking) */
  inlierCount: number;
  /** Landmarks added by replenishment this frame */
  newLandmarkCount: number;
  /** Failure reason of the initialization attempt, when initializing */
  initializationFailureReason?: InitializationFailureReason;
}

/**
 * Camera Tracker Options
 */
export interface CameraTrackerOptions {
  /** Minimum features required to set an initialization reference. Default: 50 */
  minReferenceFeatures?: number;
  /** Below this correspondence count the tracker reports lost. Default: 15 */
  minTrackedCorrespondences?: number;
  /** Reprojection error recorded for PnP outliers (px). Drives culling. Default: 16 */
  outlierPenaltyError?: number;
  /**
   * Consecutive lost frames before the tracker resets and reinitializes.
   * Landmarks are keyed by optical-flow feature IDs, which never reappear
   * once lost, so without this reset a lost tracker could never recover.
   * Default: 30 (about one second at 30fps)
   */
  maxLostFramesBeforeReset?: number;
  /** Minimum frames between replenishment keyframes. Default: 10 */
  keyframeInterval?: number;
  /**
   * Minimum median pixel displacement relative to the last keyframe before
   * a new keyframe is created. Guards against zero-baseline triangulation.
   * Default: 20
   */
  minKeyframeDisplacementPixels?: number;
}

/**
 * Camera Tracker
 *
 * Orchestrates metric 6DoF camera tracking: bootstraps the landmark map via
 * the gated two-view MapInitializer, then localizes every frame by solving
 * RANSAC PnP against the LandmarkMap. Observation statistics feed back into
 * the map so unreliable landmarks are culled instead of corrupting poses.
 *
 * The world frame is the reference camera frame of the initialization
 * (OpenCV basis: x-right / y-down / z-forward). Use cameraPoseToThreeJs()
 * before applying poses to a Three.js camera.
 */
export class CameraTracker {
  private readonly mapInitializer: MapInitializer;
  private readonly landmarkMap: LandmarkMap;
  private readonly pnpSolver: Pick<PnPSolver, "solvePnP">;
  private readonly triangulator: Pick<Triangulator, "triangulate"> | null;

  private readonly minReferenceFeatures: number;
  private readonly minTrackedCorrespondences: number;
  private readonly outlierPenaltyError: number;
  private readonly maxLostFramesBeforeReset: number;
  private readonly keyframeInterval: number;
  private readonly minKeyframeDisplacementPixels: number;

  private initialized: boolean = false;
  private lastPose: CameraPose | null = null;
  private consecutiveLostFrames: number = 0;
  private lastKeyframe: ReplenishmentKeyframe | null = null;
  private framesSinceKeyframe: number = 0;

  constructor(
    dependencies: {
      mapInitializer: MapInitializer;
      landmarkMap: LandmarkMap;
      pnpSolver: Pick<PnPSolver, "solvePnP">;
      /** Optional; landmark replenishment is disabled without it */
      triangulator?: Pick<Triangulator, "triangulate">;
    },
    options?: CameraTrackerOptions
  ) {
    this.mapInitializer = dependencies.mapInitializer;
    this.landmarkMap = dependencies.landmarkMap;
    this.pnpSolver = dependencies.pnpSolver;
    this.triangulator = dependencies.triangulator ?? null;

    this.minReferenceFeatures = options?.minReferenceFeatures ?? 50;
    this.minTrackedCorrespondences = options?.minTrackedCorrespondences ?? 15;
    this.outlierPenaltyError = options?.outlierPenaltyError ?? 16;
    this.maxLostFramesBeforeReset = options?.maxLostFramesBeforeReset ?? 30;
    this.keyframeInterval = options?.keyframeInterval ?? 10;
    this.minKeyframeDisplacementPixels =
      options?.minKeyframeDisplacementPixels ?? 20;
  }

  /**
   * Process one frame of tracked features
   *
   * @param features Tracked features in full-resolution image coordinates
   * @param timestamp Frame timestamp in milliseconds
   * @param depthPriorByFeatureId Optional metric depth priors for scale
   *                              resolution during initialization
   */
  public update(
    features: Feature[],
    timestamp: number,
    depthPriorByFeatureId?: Map<string, number>
  ): CameraTrackerResult {
    this.landmarkMap.beginFrame();

    if (!this.initialized) {
      return this.updateInitialization(
        features,
        timestamp,
        depthPriorByFeatureId
      );
    }
    return this.updateTracking(features, timestamp);
  }

  /**
   * Whether the landmark map has been initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the most recent successfully estimated pose
   */
  public getLastPose(): CameraPose | null {
    return this.lastPose;
  }

  /**
   * Get the landmark map (read access for statistics/rendering)
   */
  public getLandmarkMap(): LandmarkMap {
    return this.landmarkMap;
  }

  /**
   * Reset to the uninitialized state (clears the map and reference frame)
   */
  public reset(): void {
    this.initialized = false;
    this.lastPose = null;
    this.consecutiveLostFrames = 0;
    this.lastKeyframe = null;
    this.framesSinceKeyframe = 0;
    this.landmarkMap.clear();
    this.mapInitializer.reset();
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.reset();
  }

  private updateInitialization(
    features: Feature[],
    timestamp: number,
    depthPriorByFeatureId?: Map<string, number>
  ): CameraTrackerResult {
    if (!this.mapInitializer.hasReferenceFrame()) {
      if (features.length >= this.minReferenceFeatures) {
        this.mapInitializer.setReferenceFrame(features, timestamp);
      }
      return {
        status: "initializing",
        pose: null,
        correspondenceCount: 0,
        inlierCount: 0,
        newLandmarkCount: 0,
      };
    }

    const attempt = this.mapInitializer.attemptInitialization(
      features,
      timestamp,
      depthPriorByFeatureId
    );

    if (attempt.success && attempt.result) {
      for (const landmark of attempt.result.landmarks) {
        this.landmarkMap.addLandmark(landmark.id, landmark.position);
      }
      this.initialized = true;
      this.lastPose = attempt.result.currentPose;
      this.setKeyframe(attempt.result.currentPose, features);
      return {
        status: "tracking",
        pose: attempt.result.currentPose,
        correspondenceCount: attempt.correspondenceCount,
        inlierCount: attempt.result.landmarks.length,
        newLandmarkCount: attempt.result.landmarks.length,
      };
    }

    // The reference features died out (optical flow lost them); restart
    // from the current frame instead of waiting forever.
    if (
      attempt.failureReason === "insufficient-correspondences" &&
      features.length >= this.minReferenceFeatures
    ) {
      this.mapInitializer.setReferenceFrame(features, timestamp);
    }

    return {
      status: "initializing",
      pose: null,
      correspondenceCount: attempt.correspondenceCount,
      inlierCount: 0,
      newLandmarkCount: 0,
      initializationFailureReason: attempt.failureReason,
    };
  }

  private updateTracking(
    features: Feature[],
    timestamp: number
  ): CameraTrackerResult {
    const correspondences = this.landmarkMap.getCorrespondences(features);

    if (correspondences.length < this.minTrackedCorrespondences) {
      return this.reportLost(correspondences.length);
    }

    const pnpResult = this.pnpSolver.solvePnP(correspondences);
    if (!pnpResult || !pnpResult.isValid) {
      return this.reportLost(correspondences.length);
    }

    this.consecutiveLostFrames = 0;

    const inlierSet = new Set(pnpResult.inliers);
    correspondences.forEach((correspondence, index) => {
      this.landmarkMap.recordObservation(
        correspondence.id,
        inlierSet.has(index)
          ? pnpResult.reprojectionError
          : this.outlierPenaltyError
      );
    });
    this.landmarkMap.cull();

    const confidence = pnpResult.inliers.length / correspondences.length;
    const pose = pnpResultToCameraPose(pnpResult, timestamp, confidence);
    this.lastPose = pose;

    const newLandmarkCount = this.maybeReplenishLandmarks(features, pose);

    return {
      status: "tracking",
      pose,
      correspondenceCount: correspondences.length,
      inlierCount: pnpResult.inliers.length,
      newLandmarkCount,
    };
  }

  private reportLost(correspondenceCount: number): CameraTrackerResult {
    this.consecutiveLostFrames++;
    if (this.consecutiveLostFrames >= this.maxLostFramesBeforeReset) {
      this.reset();
    }
    return {
      status: "lost",
      pose: null,
      correspondenceCount,
      inlierCount: 0,
      newLandmarkCount: 0,
    };
  }

  /**
   * Replenish the landmark map by triangulating new features against the
   * last keyframe when a new keyframe is due.
   *
   * Without replenishment the map only shrinks after initialization
   * (culling removes landmarks, tracked features die), which bounds the
   * total tracking lifetime. New keyframes are gated on frame interval and
   * median pixel displacement so triangulation always has real baseline.
   *
   * @returns Number of landmarks added
   */
  private maybeReplenishLandmarks(
    features: Feature[],
    currentPose: CameraPose
  ): number {
    if (!this.triangulator || !this.lastKeyframe) {
      return 0;
    }

    this.framesSinceKeyframe++;
    if (this.framesSinceKeyframe < this.keyframeInterval) {
      return 0;
    }

    // Candidates: features observed in the last keyframe but absent from
    // the map (the map join is by feature ID)
    const keyframePoints: Array<{ x: number; y: number }> = [];
    const currentPoints: Array<{ x: number; y: number }> = [];
    const ids: string[] = [];
    const displacements: number[] = [];
    for (const feature of features) {
      const keyframePoint = this.lastKeyframe.featurePositions.get(feature.id);
      if (!keyframePoint) {
        continue;
      }
      displacements.push(
        Math.hypot(feature.x - keyframePoint.x, feature.y - keyframePoint.y)
      );
      if (this.landmarkMap.getLandmark(feature.id)) {
        continue;
      }
      keyframePoints.push(keyframePoint);
      currentPoints.push({ x: feature.x, y: feature.y });
      ids.push(feature.id);
    }

    if (displacements.length === 0) {
      // No overlap with the keyframe at all; rebase it on the current frame
      this.setKeyframe(currentPose, features);
      return 0;
    }

    displacements.sort((a, b) => a - b);
    const medianDisplacement =
      displacements[Math.floor(displacements.length / 2)];
    if (medianDisplacement < this.minKeyframeDisplacementPixels) {
      return 0;
    }

    let added = 0;
    if (ids.length > 0) {
      const results = this.triangulator.triangulate(
        keyframePoints,
        currentPoints,
        this.lastKeyframe.pose,
        currentPose,
        ids
      );
      for (const result of results) {
        if (result.isValid && result.id) {
          if (this.landmarkMap.addLandmark(result.id, result.point3D)) {
            added++;
          }
        }
      }
    }

    this.setKeyframe(currentPose, features);
    return added;
  }

  private setKeyframe(pose: CameraPose, features: Feature[]): void {
    const featurePositions = new Map<string, { x: number; y: number }>();
    for (const feature of features) {
      featurePositions.set(feature.id, { x: feature.x, y: feature.y });
    }
    this.lastKeyframe = { pose, featurePositions };
    this.framesSinceKeyframe = 0;
  }
}

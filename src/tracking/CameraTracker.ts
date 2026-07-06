/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Feature } from "../types/Feature";
import type { CameraPose } from "../types/Pose";
import type { PnPSolver } from "./PnPSolver";
import type {
  MapInitializer,
  InitializationFailureReason,
} from "./MapInitializer";
import type { LandmarkMap } from "./LandmarkMap";
import { pnpResultToCameraPose } from "../helpers/cameraPoseConversion";

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

  private readonly minReferenceFeatures: number;
  private readonly minTrackedCorrespondences: number;
  private readonly outlierPenaltyError: number;

  private initialized: boolean = false;
  private lastPose: CameraPose | null = null;

  constructor(
    dependencies: {
      mapInitializer: MapInitializer;
      landmarkMap: LandmarkMap;
      pnpSolver: Pick<PnPSolver, "solvePnP">;
    },
    options?: CameraTrackerOptions
  ) {
    this.mapInitializer = dependencies.mapInitializer;
    this.landmarkMap = dependencies.landmarkMap;
    this.pnpSolver = dependencies.pnpSolver;

    this.minReferenceFeatures = options?.minReferenceFeatures ?? 50;
    this.minTrackedCorrespondences = options?.minTrackedCorrespondences ?? 15;
    this.outlierPenaltyError = options?.outlierPenaltyError ?? 16;
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
      return {
        status: "tracking",
        pose: attempt.result.currentPose,
        correspondenceCount: attempt.correspondenceCount,
        inlierCount: attempt.result.landmarks.length,
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
      initializationFailureReason: attempt.failureReason,
    };
  }

  private updateTracking(
    features: Feature[],
    timestamp: number
  ): CameraTrackerResult {
    const correspondences = this.landmarkMap.getCorrespondences(features);

    if (correspondences.length < this.minTrackedCorrespondences) {
      return {
        status: "lost",
        pose: null,
        correspondenceCount: correspondences.length,
        inlierCount: 0,
      };
    }

    const pnpResult = this.pnpSolver.solvePnP(correspondences);
    if (!pnpResult || !pnpResult.isValid) {
      return {
        status: "lost",
        pose: null,
        correspondenceCount: correspondences.length,
        inlierCount: 0,
      };
    }

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

    return {
      status: "tracking",
      pose,
      correspondenceCount: correspondences.length,
      inlierCount: pnpResult.inliers.length,
    };
  }
}

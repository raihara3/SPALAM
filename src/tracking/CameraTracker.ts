/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Feature } from "../types/Feature";
import type { CameraPose } from "../types/Pose";
import type { PnPSolver } from "./PnPSolver";
import type { Triangulator } from "./Triangulator";
import type { LocalBundleAdjustment } from "./LocalBundleAdjustment";
import type { MotionModel } from "./MotionModel";
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
 *
 * "degraded" means visual tracking failed this frame but the pose is
 * bridged by constant-velocity extrapolation (short gaps only).
 */
export type CameraTrackerStatus =
  | "initializing"
  | "tracking"
  | "degraded"
  | "lost";

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
  /** Keyframes between bundle adjustment runs. Default: 2 */
  bundleAdjustmentInterval?: number;
  /**
   * Reprojection error (px) at which pose confidence reaches zero.
   * Confidence = inlierRatio * (1 - error / normalization); the inlier
   * ratio alone is not a sufficient confidence signal. Default: 8
   */
  reprojectionErrorNormalization?: number;
  /**
   * Maximum landmark position correction applied per bundle adjustment
   * run (world units). Bounded corrections keep the map visually stable;
   * an anchor that visibly jumps reads as worse tracking than a slightly
   * inaccurate one. Default: 0.1
   */
  maxLandmarkCorrection?: number;
}

/**
 * Subset of LocalBundleAdjustment used by the tracker
 */
export type BundleAdjustmentBackend = Pick<
  LocalBundleAdjustment,
  | "addKeyframe"
  | "addMapPoint"
  | "addObservation"
  | "getMapPoint"
  | "getMapPoints"
  | "markAsOutlier"
  | "optimize"
  | "reset"
>;

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
  private readonly bundleAdjustment: BundleAdjustmentBackend | null;
  private readonly motionModel: Pick<
    MotionModel,
    "update" | "predictPose" | "reset"
  > | null;

  private readonly minReferenceFeatures: number;
  private readonly minTrackedCorrespondences: number;
  private readonly outlierPenaltyError: number;
  private readonly maxLostFramesBeforeReset: number;
  private readonly keyframeInterval: number;
  private readonly minKeyframeDisplacementPixels: number;
  private readonly bundleAdjustmentInterval: number;
  private readonly maxLandmarkCorrection: number;
  private readonly reprojectionErrorNormalization: number;
  private keyframesSinceOptimization: number = 0;

  private initialized: boolean = false;
  private lastPose: CameraPose | null = null;
  private consecutiveLostFrames: number = 0;
  private lastKeyframe: ReplenishmentKeyframe | null = null;
  private framesSinceKeyframe: number = 0;
  /** Depth priors captured when the reference frame was set */
  private referenceDepthPriors: Map<string, number> | null = null;

  constructor(
    dependencies: {
      mapInitializer: MapInitializer;
      landmarkMap: LandmarkMap;
      pnpSolver: Pick<PnPSolver, "solvePnP">;
      /** Optional; landmark replenishment is disabled without it */
      triangulator?: Pick<Triangulator, "triangulate">;
      /** Optional; keyframe/landmark refinement is disabled without it */
      bundleAdjustment?: BundleAdjustmentBackend;
      /** Optional; short-gap pose bridging is disabled without it */
      motionModel?: Pick<MotionModel, "update" | "predictPose" | "reset">;
    },
    options?: CameraTrackerOptions
  ) {
    this.mapInitializer = dependencies.mapInitializer;
    this.landmarkMap = dependencies.landmarkMap;
    this.pnpSolver = dependencies.pnpSolver;
    this.triangulator = dependencies.triangulator ?? null;
    this.bundleAdjustment = dependencies.bundleAdjustment ?? null;
    this.motionModel = dependencies.motionModel ?? null;

    this.minReferenceFeatures = options?.minReferenceFeatures ?? 50;
    this.minTrackedCorrespondences = options?.minTrackedCorrespondences ?? 15;
    this.outlierPenaltyError = options?.outlierPenaltyError ?? 16;
    this.maxLostFramesBeforeReset = options?.maxLostFramesBeforeReset ?? 30;
    this.keyframeInterval = options?.keyframeInterval ?? 10;
    this.minKeyframeDisplacementPixels =
      options?.minKeyframeDisplacementPixels ?? 20;
    this.bundleAdjustmentInterval = options?.bundleAdjustmentInterval ?? 2;
    this.maxLandmarkCorrection = options?.maxLandmarkCorrection ?? 0.1;
    this.reprojectionErrorNormalization =
      options?.reprojectionErrorNormalization ?? 8;
  }

  /**
   * Process one frame of tracked features
   *
   * @param features Tracked features in full-resolution image coordinates
   * @param timestamp Frame timestamp in milliseconds
   * @param depthPriorSupplier Optional supplier of metric depth priors for
   *                           scale resolution. Invoked only when a
   *                           reference frame is (re)set, so callers can
   *                           defer the sampling cost.
   */
  public update(
    features: Feature[],
    timestamp: number,
    depthPriorSupplier?: () => Map<string, number> | undefined
  ): CameraTrackerResult {
    this.landmarkMap.beginFrame();

    if (!this.initialized) {
      return this.updateInitialization(
        features,
        timestamp,
        depthPriorSupplier
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
    this.referenceDepthPriors = null;
    this.keyframesSinceOptimization = 0;
    this.landmarkMap.clear();
    this.mapInitializer.reset();
    this.bundleAdjustment?.reset();
    this.motionModel?.reset();
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
    depthPriorSupplier?: () => Map<string, number> | undefined
  ): CameraTrackerResult {
    if (!this.mapInitializer.hasReferenceFrame()) {
      if (features.length >= this.minReferenceFeatures) {
        this.setReferenceFrame(features, timestamp, depthPriorSupplier?.());
      }
      return {
        status: "initializing",
        pose: null,
        correspondenceCount: 0,
        inlierCount: 0,
        newLandmarkCount: 0,
      };
    }

    // Use the priors captured at reference time: the triangulated depths
    // they are compared against live in the reference camera frame
    const attempt = this.mapInitializer.attemptInitialization(
      features,
      timestamp,
      this.referenceDepthPriors ?? undefined
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
      this.setReferenceFrame(features, timestamp, depthPriorSupplier?.());
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
      return this.reportLost(correspondences.length, timestamp);
    }

    const pnpResult = this.pnpSolver.solvePnP(correspondences);
    if (!pnpResult || !pnpResult.isValid) {
      return this.reportLost(correspondences.length, timestamp);
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

    const inlierRatio = pnpResult.inliers.length / correspondences.length;
    const errorFactor = Math.max(
      0,
      1 - pnpResult.reprojectionError / this.reprojectionErrorNormalization
    );
    const confidence = inlierRatio * errorFactor;
    const pose = pnpResultToCameraPose(pnpResult, timestamp, confidence);
    this.lastPose = pose;
    this.motionModel?.update(pose);

    const newLandmarkCount = this.maybeReplenishLandmarks(features, pose);

    return {
      status: "tracking",
      pose,
      correspondenceCount: correspondences.length,
      inlierCount: pnpResult.inliers.length,
      newLandmarkCount,
    };
  }

  private reportLost(
    correspondenceCount: number,
    timestamp: number
  ): CameraTrackerResult {
    this.consecutiveLostFrames++;
    if (this.consecutiveLostFrames >= this.maxLostFramesBeforeReset) {
      this.reset();
      return {
        status: "lost",
        pose: null,
        correspondenceCount,
        inlierCount: 0,
        newLandmarkCount: 0,
      };
    }

    // Bridge short gaps with constant-velocity extrapolation. The
    // prediction horizon is clamped inside the motion model, and the
    // confidence decays with consecutive lost frames so downstream fusion
    // hands over to the IMU progressively.
    const predicted = this.motionModel?.predictPose(timestamp) ?? null;
    if (predicted) {
      const remainingRatio =
        1 - this.consecutiveLostFrames / this.maxLostFramesBeforeReset;
      const bridgedPose: CameraPose = {
        ...predicted,
        confidence: Math.max(0, predicted.confidence * remainingRatio),
      };
      return {
        status: "degraded",
        pose: bridgedPose,
        correspondenceCount,
        inlierCount: 0,
        newLandmarkCount: 0,
      };
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
   * median pixel displacement; the displacement gate only confirms image
   * motion (it cannot distinguish rotation from translation), so the
   * actual parallax/depth validation is left to the Triangulator gates.
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

    // Cheap displacement gate first; candidate arrays are only built once
    // it passes (this path runs every frame while the camera is static)
    const displacements: number[] = [];
    for (const feature of features) {
      const keyframePoint = this.lastKeyframe.featurePositions.get(feature.id);
      if (keyframePoint) {
        displacements.push(
          Math.hypot(feature.x - keyframePoint.x, feature.y - keyframePoint.y)
        );
      }
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

    // Candidates: features observed in the last keyframe but absent from
    // the map (the map join is by feature ID)
    const keyframePoints: Array<{ x: number; y: number }> = [];
    const currentPoints: Array<{ x: number; y: number }> = [];
    const ids: string[] = [];
    for (const feature of features) {
      const keyframePoint = this.lastKeyframe.featurePositions.get(feature.id);
      if (!keyframePoint || this.landmarkMap.getLandmark(feature.id)) {
        continue;
      }
      keyframePoints.push(keyframePoint);
      currentPoints.push({ x: feature.x, y: feature.y });
      ids.push(feature.id);
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

  private setReferenceFrame(
    features: Feature[],
    timestamp: number,
    depthPriorByFeatureId?: Map<string, number>
  ): void {
    this.mapInitializer.setReferenceFrame(features, timestamp);
    this.referenceDepthPriors = depthPriorByFeatureId
      ? new Map(depthPriorByFeatureId)
      : null;
  }

  private setKeyframe(pose: CameraPose, features: Feature[]): void {
    const featurePositions = new Map<string, { x: number; y: number }>();
    for (const feature of features) {
      featurePositions.set(feature.id, { x: feature.x, y: feature.y });
    }
    this.lastKeyframe = { pose, featurePositions };
    this.framesSinceKeyframe = 0;

    this.registerKeyframeWithBundleAdjustment(pose, features);
  }

  /**
   * Feed the new keyframe into the bundle adjustment backend and run a
   * throttled optimization pass.
   *
   * The backend keeps its own sliding window and mutates only its own
   * copies; optimized landmark positions are applied back to the live map
   * with a bounded correction so refinement never causes visible jumps.
   * Optimization runs only every bundleAdjustmentInterval keyframes (i.e.
   * a small multiple of the keyframe interval in frames), keeping its cost
   * off the per-frame budget.
   */
  private registerKeyframeWithBundleAdjustment(
    pose: CameraPose,
    features: Feature[]
  ): void {
    if (!this.bundleAdjustment) {
      return;
    }

    const keyframeId = this.bundleAdjustment.addKeyframe({
      id: 0, // assigned by the backend
      pose: {
        rotation: pose.rotation.clone(),
        translation: pose.translation.clone(),
        quaternion: pose.quaternion.clone(),
        timestamp: pose.timestamp,
        confidence: pose.confidence,
      },
      features,
      descriptors: null,
      timestamp: pose.timestamp,
    });

    features.forEach((feature, featureIndex) => {
      const landmark = this.landmarkMap.getLandmark(feature.id);
      if (!landmark) {
        return;
      }
      if (!this.bundleAdjustment!.getMapPoint(feature.id)) {
        this.bundleAdjustment!.addMapPoint({
          id: feature.id,
          position: landmark.position.clone(),
          observations: new Map(),
          observationCount: 0,
          isValid: true,
        });
      }
      this.bundleAdjustment!.addObservation(feature.id, keyframeId, featureIndex);
    });

    this.keyframesSinceOptimization++;
    if (this.keyframesSinceOptimization >= this.bundleAdjustmentInterval) {
      this.keyframesSinceOptimization = 0;
      this.runBundleAdjustment();
    }
  }

  private runBundleAdjustment(): void {
    if (!this.bundleAdjustment) {
      return;
    }

    // Re-seed the backend's map point copies from the live map before
    // optimizing. Without this, culled-and-retriangulated landmarks would
    // be pulled back toward stale positions on every run, and the two
    // states would drift apart into an oscillation loop.
    for (const backendPoint of this.bundleAdjustment.getMapPoints()) {
      const landmark = this.landmarkMap.getLandmark(backendPoint.id);
      if (!landmark) {
        this.bundleAdjustment.markAsOutlier(backendPoint.id);
        continue;
      }
      backendPoint.position.copy(landmark.position);
      backendPoint.isValid = true;
    }

    const result = this.bundleAdjustment.optimize();
    result.optimizedPoints.forEach((position, id) => {
      const landmark = this.landmarkMap.getLandmark(id);
      if (!landmark) {
        return;
      }
      // Numeric optimization can produce non-finite positions (e.g. from
      // observations behind a camera); never let them into the live map
      if (
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        !Number.isFinite(position.z)
      ) {
        return;
      }
      const correction = position.clone().sub(landmark.position);
      const distance = correction.length();
      if (distance === 0 || !Number.isFinite(distance)) {
        return;
      }
      if (distance > this.maxLandmarkCorrection) {
        correction.multiplyScalar(this.maxLandmarkCorrection / distance);
      }
      this.landmarkMap.updatePosition(
        id,
        landmark.position.clone().add(correction)
      );
    });
  }
}

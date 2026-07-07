/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { CameraTracker } from "./CameraTracker";
import { LandmarkMap } from "./LandmarkMap";
import type { MapInitializer, InitializationAttempt } from "./MapInitializer";
import type { Feature } from "../types/Feature";
import type { CameraPose, PnPResult } from "../types/Pose";

describe("CameraTracker", () => {
  const createFeatures = (count: number): Feature[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `feature_${i}`,
      x: 100 + i,
      y: 100 + i,
      trackingCount: 20,
    }));

  const identityPose: CameraPose = {
    rotation: new THREE.Matrix3().identity(),
    translation: new THREE.Vector3(0, 0, 0),
    quaternion: new THREE.Quaternion(),
    timestamp: 0,
    confidence: 1,
  };

  const createSuccessfulAttempt = (
    landmarkCount: number
  ): InitializationAttempt => ({
    success: true,
    correspondenceCount: landmarkCount,
    result: {
      referencePose: identityPose,
      currentPose: { ...identityPose, timestamp: 100 },
      landmarks: Array.from({ length: landmarkCount }, (_, i) => ({
        id: `feature_${i}`,
        position: new THREE.Vector3(i * 0.1, 0, 2),
      })),
      scale: { scale: 1, sampleCount: 0, isReliable: false },
      inlierRatio: 0.9,
      medianParallaxDegrees: 2,
    },
  });

  const createMockInitializer = (attempts: InitializationAttempt[]) => {
    let hasReference = false;
    let attemptIndex = 0;
    return {
      hasReferenceFrame: vi.fn(() => hasReference),
      setReferenceFrame: vi.fn(() => {
        hasReference = true;
      }),
      attemptInitialization: vi.fn(() => {
        const attempt = attempts[Math.min(attemptIndex, attempts.length - 1)];
        attemptIndex++;
        return attempt;
      }),
      reset: vi.fn(() => {
        hasReference = false;
      }),
    } as unknown as MapInitializer;
  };

  const createValidPnPResult = (inlierCount: number): PnPResult => ({
    rotationVector: new THREE.Vector3(),
    rotationMatrix: new THREE.Matrix3().identity(),
    translation: new THREE.Vector3(0, 0, 1),
    inliers: Array.from({ length: inlierCount }, (_, i) => i),
    reprojectionError: 1.2,
    isValid: true,
  });

  const createTracker = (params: {
    attempts?: InitializationAttempt[];
    pnpResult?: PnPResult | null;
  }) => {
    const landmarkMap = new LandmarkMap();
    const mapInitializer = createMockInitializer(
      params.attempts ?? [createSuccessfulAttempt(60)]
    );
    const pnpSolver = {
      solvePnP: vi.fn(() =>
        params.pnpResult !== undefined
          ? params.pnpResult
          : createValidPnPResult(50)
      ),
    };
    const tracker = new CameraTracker({
      mapInitializer,
      landmarkMap,
      pnpSolver,
    });
    return { tracker, landmarkMap, mapInitializer, pnpSolver };
  };

  describe("initialization", () => {
    it("should set a reference frame when enough features arrive", () => {
      const { tracker, mapInitializer } = createTracker({});

      const result = tracker.update(createFeatures(60), 0);

      expect(result.status).toBe("initializing");
      expect(mapInitializer.setReferenceFrame).toHaveBeenCalledOnce();
      expect(mapInitializer.attemptInitialization).not.toHaveBeenCalled();
    });

    it("should not set a reference with too few features", () => {
      const { tracker, mapInitializer } = createTracker({});

      tracker.update(createFeatures(10), 0);

      expect(mapInitializer.setReferenceFrame).not.toHaveBeenCalled();
    });

    it("should populate the map and report tracking on success", () => {
      const { tracker, landmarkMap } = createTracker({});

      tracker.update(createFeatures(60), 0); // sets reference
      const result = tracker.update(createFeatures(60), 100);

      expect(result.status).toBe("tracking");
      expect(result.pose).not.toBeNull();
      expect(tracker.isInitialized()).toBe(true);
      expect(landmarkMap.size()).toBe(60);
    });

    it("should surface the failure reason while initializing", () => {
      const { tracker } = createTracker({
        attempts: [
          {
            success: false,
            failureReason: "insufficient-parallax",
            correspondenceCount: 55,
          },
        ],
      });

      tracker.update(createFeatures(60), 0);
      const result = tracker.update(createFeatures(60), 100);

      expect(result.status).toBe("initializing");
      expect(result.initializationFailureReason).toBe("insufficient-parallax");
    });

    it("should pass reference-time depth priors to initialization attempts", () => {
      const { tracker, mapInitializer } = createTracker({
        attempts: [
          {
            success: false,
            failureReason: "insufficient-displacement",
            correspondenceCount: 60,
          },
        ],
      });

      const referencePriors = new Map([["feature_0", 2.5]]);
      tracker.update(createFeatures(60), 0, () => referencePriors); // sets reference
      const laterPriors = new Map([["feature_0", 9.9]]);
      tracker.update(createFeatures(60), 100, () => laterPriors);

      // The attempt must receive the priors captured with the reference
      // frame, not the ones sampled later
      expect(mapInitializer.attemptInitialization).toHaveBeenCalledWith(
        expect.anything(),
        100,
        new Map([["feature_0", 2.5]])
      );
    });

    it("should restart the reference when correspondences die out", () => {
      const { tracker, mapInitializer } = createTracker({
        attempts: [
          {
            success: false,
            failureReason: "insufficient-correspondences",
            correspondenceCount: 3,
          },
        ],
      });

      tracker.update(createFeatures(60), 0);
      tracker.update(createFeatures(60), 100);

      expect(mapInitializer.setReferenceFrame).toHaveBeenCalledTimes(2);
    });
  });

  describe("tracking", () => {
    const initializeTracker = (params: {
      pnpResult?: PnPResult | null;
    }) => {
      const context = createTracker(params);
      context.tracker.update(createFeatures(60), 0);
      context.tracker.update(createFeatures(60), 100);
      return context;
    };

    it("should solve PnP against map correspondences and report the pose", () => {
      const { tracker, pnpSolver } = initializeTracker({});

      const result = tracker.update(createFeatures(60), 200);

      expect(result.status).toBe("tracking");
      expect(pnpSolver.solvePnP).toHaveBeenCalledOnce();
      expect(result.correspondenceCount).toBe(60);
      expect(result.inlierCount).toBe(50);
      // Extrinsic t=(0,0,1) -> camera center (0,0,-1)
      expect(result.pose!.translation.z).toBeCloseTo(-1, 10);
      expect(tracker.getLastPose()).toBe(result.pose);
      // Confidence = inlierRatio * errorFactor
      //            = (50/60) * (1 - 1.2/8)
      expect(result.pose!.confidence).toBeCloseTo((50 / 60) * (1 - 1.2 / 8), 10);
    });

    it("should report lost with too few correspondences", () => {
      const { tracker, pnpSolver } = initializeTracker({});

      const result = tracker.update(createFeatures(5), 200);

      expect(result.status).toBe("lost");
      expect(result.pose).toBeNull();
      expect(pnpSolver.solvePnP).not.toHaveBeenCalled();
    });

    it("should report lost when PnP fails", () => {
      const { tracker } = initializeTracker({ pnpResult: null });

      const result = tracker.update(createFeatures(60), 200);

      expect(result.status).toBe("lost");
      expect(result.pose).toBeNull();
    });

    it("should record observations and cull repeated outliers", () => {
      const { tracker, landmarkMap } = initializeTracker({
        pnpResult: createValidPnPResult(30),
      });

      tracker.update(createFeatures(60), 200);

      // Inlier landmark: EMA rises from 0 (default alpha 0.3)
      expect(
        landmarkMap.getLandmark("feature_0")!.averageReprojectionError
      ).toBeCloseTo(0.36, 5);
      // Outlier landmark (index >= 30): one outlier verdict elevates the
      // EMA (16 * 0.3 = 4.8) but does not kill a young landmark
      expect(
        landmarkMap.getLandmark("feature_59")!.averageReprojectionError
      ).toBeCloseTo(4.8, 5);

      // A second consecutive outlier verdict pushes the EMA past the
      // culling threshold (4.8 * 0.7 + 16 * 0.3 = 8.16 > 8)
      tracker.update(createFeatures(60), 233);
      expect(landmarkMap.getLandmark("feature_59")).toBeNull();
      expect(landmarkMap.getLandmark("feature_0")).not.toBeNull();
    });

    it("should reset and reinitialize after prolonged loss", () => {
      const landmarkMap = new LandmarkMap();
      const mapInitializer = createMockInitializer([
        createSuccessfulAttempt(60),
      ]);
      const pnpSolver = { solvePnP: vi.fn(() => createValidPnPResult(50)) };
      const tracker = new CameraTracker(
        { mapInitializer, landmarkMap, pnpSolver },
        { maxLostFramesBeforeReset: 2 }
      );

      tracker.update(createFeatures(60), 0); // sets reference
      tracker.update(createFeatures(60), 100); // initializes
      expect(tracker.isInitialized()).toBe(true);

      tracker.update(createFeatures(5), 200); // lost 1
      expect(tracker.isInitialized()).toBe(true);
      tracker.update(createFeatures(5), 300); // lost 2 -> reset
      expect(tracker.isInitialized()).toBe(false);
      expect(landmarkMap.size()).toBe(0);

      // The next frame with enough features restarts initialization
      const result = tracker.update(createFeatures(60), 400);
      expect(result.status).toBe("initializing");
      expect(mapInitializer.setReferenceFrame).toHaveBeenCalledTimes(2);
    });
  });

  describe("landmark replenishment", () => {
    const createTrackerWithTriangulator = () => {
      const landmarkMap = new LandmarkMap();
      // Initialization populates the map with the first 30 features only,
      // leaving the rest as replenishment candidates
      const mapInitializer = createMockInitializer([
        createSuccessfulAttempt(30),
      ]);
      const pnpSolver = { solvePnP: vi.fn(() => createValidPnPResult(30)) };
      const triangulator = {
        triangulate: vi.fn(
          (
            _points1: Array<{ x: number; y: number }>,
            _points2: Array<{ x: number; y: number }>,
            _pose1: unknown,
            _pose2: unknown,
            ids?: string[]
          ) =>
            (ids ?? []).map((id) => ({
              point3D: new THREE.Vector3(0, 0, 2),
              reprojectionError: 0.5,
              parallaxAngle: 0.05,
              isValid: true,
              id,
            }))
        ),
      };
      const tracker = new CameraTracker(
        { mapInitializer, landmarkMap, pnpSolver, triangulator },
        { keyframeInterval: 3, minKeyframeDisplacementPixels: 5 }
      );
      tracker.update(createFeatures(60), 0); // sets reference
      tracker.update(createFeatures(60), 100); // initializes (30 landmarks)
      return { tracker, landmarkMap, triangulator };
    };

    const createDisplacedFeatures = (
      count: number,
      offsetX: number
    ): Feature[] =>
      createFeatures(count).map((feature) => ({
        ...feature,
        x: feature.x + offsetX,
      }));

    it("should not replenish before the keyframe interval", () => {
      const { tracker, triangulator } = createTrackerWithTriangulator();

      const result = tracker.update(createDisplacedFeatures(60, 50), 200);

      expect(result.newLandmarkCount).toBe(0);
      expect(triangulator.triangulate).not.toHaveBeenCalled();
    });

    it("should triangulate unmapped features once interval and displacement are met", () => {
      const { tracker, landmarkMap, triangulator } =
        createTrackerWithTriangulator();

      tracker.update(createDisplacedFeatures(60, 50), 200);
      tracker.update(createDisplacedFeatures(60, 50), 233);
      const result = tracker.update(createDisplacedFeatures(60, 50), 266);

      expect(triangulator.triangulate).toHaveBeenCalledOnce();
      // Features 30-59 were not in the map and get triangulated
      expect(result.newLandmarkCount).toBe(30);
      expect(landmarkMap.size()).toBe(60);
    });

    it("should not create a keyframe without enough displacement", () => {
      const { tracker, triangulator } = createTrackerWithTriangulator();

      for (let i = 0; i < 5; i++) {
        const result = tracker.update(createDisplacedFeatures(60, 1), 200 + i);
        expect(result.newLandmarkCount).toBe(0);
      }
      expect(triangulator.triangulate).not.toHaveBeenCalled();
    });
  });

  describe("depth bootstrap (no two-view initializer)", () => {
    const intrinsics = { fx: 500, fy: 500, cx: 320, cy: 240 };

    const createDepthTracker = () => {
      const landmarkMap = new LandmarkMap();
      const pnpSolver = { solvePnP: vi.fn(() => createValidPnPResult(50)) };
      const tracker = new CameraTracker({
        intrinsics,
        landmarkMap,
        pnpSolver,
      });
      return { tracker, landmarkMap, pnpSolver };
    };

    it("should wait while depth priors are unavailable", () => {
      const { tracker } = createDepthTracker();

      const result = tracker.update(createFeatures(60), 0, () => undefined);

      expect(result.status).toBe("initializing");
      expect(result.initializationFailureReason).toBe(
        "insufficient-depth-priors"
      );
      expect(tracker.isInitialized()).toBe(false);
    });

    it("should bootstrap instantly by back-projecting depth priors", () => {
      const { tracker, landmarkMap } = createDepthTracker();
      const features = createFeatures(60);
      const priors = new Map(features.map((feature) => [feature.id, 2.0]));

      const result = tracker.update(features, 100, () => priors);

      expect(result.status).toBe("tracking");
      expect(result.newLandmarkCount).toBe(60);
      expect(tracker.isInitialized()).toBe(true);
      // Reference pose is the identity at the world origin
      expect(result.pose!.translation.length()).toBe(0);

      // Back-projection: x = (u - cx) * z / fx, y = (v - cy) * z / fy, z
      const feature = features[0];
      const landmark = landmarkMap.getLandmark(feature.id)!;
      expect(landmark.position.x).toBeCloseTo(
        ((feature.x - intrinsics.cx) * 2.0) / intrinsics.fx,
        10
      );
      expect(landmark.position.y).toBeCloseTo(
        ((feature.y - intrinsics.cy) * 2.0) / intrinsics.fy,
        10
      );
      expect(landmark.position.z).toBe(2.0);
    });

    it("should skip features with invalid depths and enforce the minimum", () => {
      const { tracker } = createDepthTracker();
      const features = createFeatures(60);
      // Only 30 valid priors: below minReferenceFeatures (50)
      const priors = new Map(
        features
          .slice(0, 30)
          .map((feature) => [feature.id, 2.0] as [string, number])
      );

      const result = tracker.update(features, 100, () => priors);

      expect(result.status).toBe("initializing");
      expect(result.initializationFailureReason).toBe(
        "insufficient-depth-priors"
      );
    });

    it("should track with PnP after the depth bootstrap", () => {
      const { tracker, pnpSolver } = createDepthTracker();
      const features = createFeatures(60);
      const priors = new Map(features.map((feature) => [feature.id, 2.0]));
      tracker.update(features, 100, () => priors);

      const result = tracker.update(features, 133);

      expect(result.status).toBe("tracking");
      expect(pnpSolver.solvePnP).toHaveBeenCalledOnce();
    });
  });

  describe("short-gap bridging", () => {
    const createTrackerWithMotionModel = () => {
      const landmarkMap = new LandmarkMap();
      const mapInitializer = createMockInitializer([
        createSuccessfulAttempt(60),
      ]);
      const pnpSolver = { solvePnP: vi.fn(() => createValidPnPResult(50)) };
      const motionModel = {
        update: vi.fn(),
        predictPose: vi.fn((timestamp: number) => ({
          ...identityPose,
          timestamp,
          confidence: 0.8,
        })),
        reset: vi.fn(),
      };
      const tracker = new CameraTracker(
        { mapInitializer, landmarkMap, pnpSolver, motionModel },
        { maxLostFramesBeforeReset: 4 }
      );
      tracker.update(createFeatures(60), 0); // reference
      tracker.update(createFeatures(60), 100); // initializes
      return { tracker, motionModel };
    };

    it("should feed tracked poses into the motion model", () => {
      const { tracker, motionModel } = createTrackerWithMotionModel();

      tracker.update(createFeatures(60), 200);

      expect(motionModel.update).toHaveBeenCalledOnce();
    });

    it("should bridge short losses with a decayed extrapolated pose", () => {
      const { tracker, motionModel } = createTrackerWithMotionModel();

      const result = tracker.update(createFeatures(5), 200);

      expect(result.status).toBe("degraded");
      expect(motionModel.predictPose).toHaveBeenCalledWith(200);
      // Prediction confidence 0.8 decayed by (1 - 1/4) after one lost frame
      expect(result.pose!.confidence).toBeCloseTo(0.8 * 0.75, 10);
      expect(tracker.isInitialized()).toBe(true);
    });

    it("should decay confidence further with consecutive lost frames", () => {
      const { tracker } = createTrackerWithMotionModel();

      tracker.update(createFeatures(5), 200);
      const second = tracker.update(createFeatures(5), 233);

      expect(second.status).toBe("degraded");
      expect(second.pose!.confidence).toBeCloseTo(0.8 * 0.5, 10);
    });

    it("should still reset after prolonged loss", () => {
      const { tracker, motionModel } = createTrackerWithMotionModel();

      tracker.update(createFeatures(5), 200); // degraded 1
      tracker.update(createFeatures(5), 233); // degraded 2
      tracker.update(createFeatures(5), 266); // degraded 3
      const fourth = tracker.update(createFeatures(5), 300); // reset

      expect(fourth.status).toBe("lost");
      expect(fourth.pose).toBeNull();
      expect(tracker.isInitialized()).toBe(false);
      expect(motionModel.reset).toHaveBeenCalled();
    });
  });

  describe("bundle adjustment integration", () => {
    const createBackend = (
      optimizedPoints: Map<string, THREE.Vector3> = new Map()
    ) => {
      const mapPoints = new Set<string>();
      return {
        addKeyframe: vi.fn(() => 1),
        addMapPoint: vi.fn((point: { id: string }) => {
          mapPoints.add(point.id);
        }),
        addObservation: vi.fn(),
        getMapPoint: vi.fn((id: string) =>
          mapPoints.has(id) ? { id } : undefined
        ),
        getMapPoints: vi.fn(() => []),
        markAsOutlier: vi.fn(),
        optimize: vi.fn(() => ({
          optimizedPoses: new Map(),
          optimizedPoints,
          finalCost: 1,
          initialCost: 2,
          iterations: 3,
          converged: true,
        })),
        reset: vi.fn(),
      };
    };

    it("should register keyframes and observations for mapped features", () => {
      const backend = createBackend();
      const landmarkMap = new LandmarkMap();
      const mapInitializer = createMockInitializer([
        createSuccessfulAttempt(60),
      ]);
      const pnpSolver = { solvePnP: vi.fn(() => createValidPnPResult(50)) };
      const tracker = new CameraTracker(
        {
          mapInitializer,
          landmarkMap,
          pnpSolver,
          bundleAdjustment: backend as never,
        },
        { bundleAdjustmentInterval: 1 }
      );

      tracker.update(createFeatures(60), 0); // reference
      tracker.update(createFeatures(60), 100); // initializes -> keyframe

      expect(backend.addKeyframe).toHaveBeenCalledOnce();
      expect(backend.addMapPoint).toHaveBeenCalledTimes(60);
      expect(backend.addObservation).toHaveBeenCalledTimes(60);
      expect(backend.optimize).toHaveBeenCalledOnce();
    });

    it("should apply bounded landmark corrections from optimization", () => {
      // Optimization moves feature_0 far away; the applied correction
      // must be capped at maxLandmarkCorrection
      const optimizedPoints = new Map([
        ["feature_0", new THREE.Vector3(10, 0, 2)],
      ]);
      const backend = createBackend(optimizedPoints);
      const landmarkMap = new LandmarkMap();
      const mapInitializer = createMockInitializer([
        createSuccessfulAttempt(60),
      ]);
      const pnpSolver = { solvePnP: vi.fn(() => createValidPnPResult(50)) };
      const tracker = new CameraTracker(
        {
          mapInitializer,
          landmarkMap,
          pnpSolver,
          bundleAdjustment: backend as never,
        },
        { bundleAdjustmentInterval: 1, maxLandmarkCorrection: 0.1 }
      );

      tracker.update(createFeatures(60), 0);
      tracker.update(createFeatures(60), 100);

      // feature_0 starts at (0, 0, 2); the correction toward (10, 0, 2)
      // is clamped to length 0.1
      const position = landmarkMap.getLandmark("feature_0")!.position;
      expect(position.x).toBeCloseTo(0.1, 10);
      expect(position.z).toBeCloseTo(2, 10);
    });

    it("should throttle optimization by keyframe interval", () => {
      const backend = createBackend();
      const landmarkMap = new LandmarkMap();
      const mapInitializer = createMockInitializer([
        createSuccessfulAttempt(60),
      ]);
      const pnpSolver = { solvePnP: vi.fn(() => createValidPnPResult(50)) };
      const tracker = new CameraTracker(
        {
          mapInitializer,
          landmarkMap,
          pnpSolver,
          bundleAdjustment: backend as never,
        },
        { bundleAdjustmentInterval: 2 }
      );

      tracker.update(createFeatures(60), 0);
      tracker.update(createFeatures(60), 100); // first keyframe

      expect(backend.addKeyframe).toHaveBeenCalledOnce();
      expect(backend.optimize).not.toHaveBeenCalled();
    });
  });

  describe("relocalization", () => {
    const createTrackerWithRelocalization = () => {
      const landmarkMap = new LandmarkMap();
      const mapInitializer = createMockInitializer([
        createSuccessfulAttempt(60),
      ]);
      const pnpSolver = { solvePnP: vi.fn(() => createValidPnPResult(50)) };
      const storedPoints3D = Array.from(
        { length: 20 },
        (_, i) => new THREE.Vector3(i * 0.1, 0, 3)
      );
      const relocalizationDatabase = {
        addKeyframe: vi.fn(() => true),
        wouldAcceptPose: vi.fn(() => true),
        clear: vi.fn(),
        size: vi.fn(() => 1),
        relocalize: vi.fn(() => ({
          pose: { ...identityPose, timestamp: 900, confidence: 0.9 },
          keyframe: { points3D: storedPoints3D } as never,
          inlierMatches: Array.from({ length: 20 }, (_, i) => ({
            queryIndex: i,
            trainIndex: i,
            distance: 10,
          })),
        })),
      };
      const descriptorProvider = vi.fn((features: Feature[]) => ({
        descriptors: { rows: features.length, delete: vi.fn() } as never,
        ids: features.map((feature) => feature.id),
      }));
      const tracker = new CameraTracker(
        {
          mapInitializer,
          landmarkMap,
          pnpSolver,
          relocalizationDatabase: relocalizationDatabase as never,
          descriptorProvider,
        },
        { maxLostFramesBeforeReset: 2, relocalizationInterval: 5 }
      );
      return {
        tracker,
        landmarkMap,
        relocalizationDatabase,
        descriptorProvider,
      };
    };

    it("should store anchor keyframes when keyframes are set", () => {
      const { tracker, relocalizationDatabase } =
        createTrackerWithRelocalization();

      tracker.update(createFeatures(60), 0); // reference
      tracker.update(createFeatures(60), 100); // initializes -> keyframe

      expect(relocalizationDatabase.addKeyframe).toHaveBeenCalledOnce();
    });

    it("should skip descriptor extraction when the pose would be rejected", () => {
      const { tracker, relocalizationDatabase, descriptorProvider } =
        createTrackerWithRelocalization();
      relocalizationDatabase.wouldAcceptPose.mockReturnValue(false);

      tracker.update(createFeatures(60), 0);
      tracker.update(createFeatures(60), 100);

      expect(descriptorProvider).not.toHaveBeenCalled();
      expect(relocalizationDatabase.addKeyframe).not.toHaveBeenCalled();
    });

    it("should clear stale anchors when a fresh world is initialized", () => {
      const { tracker, relocalizationDatabase } =
        createTrackerWithRelocalization();

      tracker.update(createFeatures(60), 0);
      tracker.update(createFeatures(60), 100); // fresh initialization

      // Entries from a previous world epoch are incompatible with the new
      // origin/scale and must not survive into it
      expect(relocalizationDatabase.clear).toHaveBeenCalledOnce();
    });

    it("should recover the original world after a reset", () => {
      const { tracker, landmarkMap, relocalizationDatabase } =
        createTrackerWithRelocalization();

      tracker.update(createFeatures(60), 0);
      tracker.update(createFeatures(60), 100);
      // Two lost frames trigger a reset (maxLostFramesBeforeReset: 2)
      tracker.update(createFeatures(5), 200);
      tracker.update(createFeatures(5), 300);
      expect(tracker.isInitialized()).toBe(false);

      // reset() schedules an immediate relocalization attempt
      const result = tracker.update(createFeatures(60), 400);

      expect(relocalizationDatabase.relocalize).toHaveBeenCalledOnce();
      expect(result.status).toBe("tracking");
      expect(result.worldRestored).toBe(true);
      expect(tracker.isInitialized()).toBe(true);
      // Map re-seeded from the stored landmark positions
      expect(result.newLandmarkCount).toBe(20);
      expect(landmarkMap.getLandmark("feature_0")!.position.z).toBe(3);
    });

    it("should throttle relocalization attempts", () => {
      const { tracker, relocalizationDatabase } =
        createTrackerWithRelocalization();
      relocalizationDatabase.relocalize.mockReturnValue(null as never);

      tracker.update(createFeatures(60), 0);
      tracker.update(createFeatures(60), 100);
      tracker.update(createFeatures(5), 200);
      tracker.update(createFeatures(5), 300); // reset -> immediate attempt scheduled

      tracker.update(createFeatures(60), 400); // attempt 1 (immediate)
      tracker.update(createFeatures(60), 433); // within interval: no attempt
      tracker.update(createFeatures(60), 466);

      expect(relocalizationDatabase.relocalize).toHaveBeenCalledOnce();
    });
  });

  describe("reset", () => {
    it("should clear the map and reference frame", () => {
      const { tracker, landmarkMap, mapInitializer } = createTracker({});
      tracker.update(createFeatures(60), 0);
      tracker.update(createFeatures(60), 100);

      tracker.reset();

      expect(tracker.isInitialized()).toBe(false);
      expect(tracker.getLastPose()).toBeNull();
      expect(landmarkMap.size()).toBe(0);
      expect(mapInitializer.reset).toHaveBeenCalled();
    });
  });
});

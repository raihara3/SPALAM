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

    it("should record observations and cull penalized outliers", () => {
      const { tracker, landmarkMap } = initializeTracker({
        pnpResult: createValidPnPResult(30),
      });

      tracker.update(createFeatures(60), 200);

      // Inlier landmark: EMA seeded with the PnP reprojection error
      expect(
        landmarkMap.getLandmark("feature_0")!.averageReprojectionError
      ).toBeCloseTo(1.2, 5);
      // Outlier landmark (index >= 30): the penalty error exceeds the
      // culling threshold, so it is removed from the map immediately
      expect(landmarkMap.getLandmark("feature_59")).toBeNull();
      expect(landmarkMap.size()).toBe(30);
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

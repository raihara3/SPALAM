import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { LocalBundleAdjustment } from "./LocalBundleAdjustment";
import type { CameraIntrinsics, CameraPose, Keyframe, MapPoint } from "../types/Pose";
import type { Feature } from "../types/Feature";

describe("LocalBundleAdjustment", () => {
  let bundleAdjustment: LocalBundleAdjustment;

  const defaultIntrinsics: CameraIntrinsics = {
    fx: 500,
    fy: 500,
    cx: 320,
    cy: 240,
    width: 640,
    height: 480,
  };

  // Create identity pose
  const createIdentityPose = (timestamp: number = 0): CameraPose => {
    return {
      rotation: new THREE.Matrix3().identity(),
      translation: new THREE.Vector3(0, 0, 0),
      quaternion: new THREE.Quaternion(),
      timestamp,
      confidence: 1.0,
    };
  };

  // Create translated pose
  const createTranslatedPose = (
    tx: number,
    ty: number,
    tz: number,
    timestamp: number = 0
  ): CameraPose => {
    return {
      rotation: new THREE.Matrix3().identity(),
      translation: new THREE.Vector3(tx, ty, tz),
      quaternion: new THREE.Quaternion(),
      timestamp,
      confidence: 1.0,
    };
  };

  // Create rotated pose
  const createRotatedPose = (
    angleY: number,
    timestamp: number = 0
  ): CameraPose => {
    const quaternion = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      angleY
    );
    const rotationMatrix = new THREE.Matrix3().setFromMatrix4(
      new THREE.Matrix4().makeRotationFromQuaternion(quaternion)
    );

    return {
      rotation: rotationMatrix,
      translation: new THREE.Vector3(0, 0, 0),
      quaternion,
      timestamp,
      confidence: 1.0,
    };
  };

  // Create feature
  const createFeature = (
    x: number,
    y: number,
    id: string
  ): Feature => {
    return {
      x,
      y,
      id,
      trackingCount: 1,
    };
  };

  // Create keyframe
  const createKeyframe = (
    pose: CameraPose,
    features: Feature[],
    timestamp: number = 0
  ): Keyframe => {
    return {
      id: 0, // Will be set by addKeyframe
      pose,
      features,
      descriptors: null,
      timestamp,
    };
  };

  // Create map point
  const createMapPoint = (
    id: string,
    position: THREE.Vector3,
    observations?: Map<number, number>
  ): MapPoint => {
    return {
      id,
      position: position.clone(),
      observations: observations ?? new Map(),
      observationCount: observations?.size ?? 0,
      isValid: true,
    };
  };

  beforeEach(() => {
    bundleAdjustment = new LocalBundleAdjustment(defaultIntrinsics);
  });

  describe("constructor", () => {
    it("should create with default options", () => {
      expect(bundleAdjustment).toBeDefined();
    });

    it("should create with custom options", () => {
      const customBA = new LocalBundleAdjustment(defaultIntrinsics, {
        windowSize: 5,
        maxIterations: 20,
        convergenceThreshold: 1e-8,
        keyframeInterval: 5,
        minParallax: 0.05,
        minTrackedFeatures: 30,
        huberThreshold: 4.0,
      });

      expect(customBA).toBeDefined();
    });
  });

  describe("addKeyframe", () => {
    it("should add keyframe and return ID", () => {
      const pose = createIdentityPose();
      const features = [
        createFeature(100, 100, "f0"),
        createFeature(200, 200, "f1"),
      ];
      const keyframe = createKeyframe(pose, features);

      const id = bundleAdjustment.addKeyframe(keyframe);

      expect(id).toBe(0);
      expect(bundleAdjustment.getKeyframeCount()).toBe(1);
    });

    it("should assign incrementing IDs", () => {
      const id1 = bundleAdjustment.addKeyframe(
        createKeyframe(createIdentityPose(), [], 0)
      );
      const id2 = bundleAdjustment.addKeyframe(
        createKeyframe(createIdentityPose(), [], 100)
      );
      const id3 = bundleAdjustment.addKeyframe(
        createKeyframe(createIdentityPose(), [], 200)
      );

      expect(id1).toBe(0);
      expect(id2).toBe(1);
      expect(id3).toBe(2);
    });

    it("should maintain sliding window", () => {
      const ba = new LocalBundleAdjustment(defaultIntrinsics, {
        windowSize: 3,
      });

      for (let i = 0; i < 5; i++) {
        ba.addKeyframe(createKeyframe(createIdentityPose(), [], i * 100));
      }

      expect(ba.getKeyframeCount()).toBe(3);
    });
  });

  describe("addMapPoint", () => {
    it("should add map point", () => {
      const point = createMapPoint("p0", new THREE.Vector3(0, 0, 5));

      bundleAdjustment.addMapPoint(point);

      expect(bundleAdjustment.getMapPointCount()).toBe(1);
      expect(bundleAdjustment.getMapPoint("p0")).toBeDefined();
    });

    it("should update existing map point", () => {
      const point1 = createMapPoint("p0", new THREE.Vector3(0, 0, 5));
      const point2 = createMapPoint("p0", new THREE.Vector3(1, 1, 6));

      bundleAdjustment.addMapPoint(point1);
      bundleAdjustment.addMapPoint(point2);

      expect(bundleAdjustment.getMapPointCount()).toBe(1);
      const retrieved = bundleAdjustment.getMapPoint("p0");
      expect(retrieved?.position.x).toBe(1);
    });
  });

  describe("addObservation", () => {
    it("should add observation to map point", () => {
      const point = createMapPoint("p0", new THREE.Vector3(0, 0, 5));
      bundleAdjustment.addMapPoint(point);
      bundleAdjustment.addKeyframe(
        createKeyframe(createIdentityPose(), [createFeature(320, 240, "f0")])
      );

      bundleAdjustment.addObservation("p0", 0, 0);

      const retrieved = bundleAdjustment.getMapPoint("p0");
      expect(retrieved?.observationCount).toBe(1);
      expect(retrieved?.observations.get(0)).toBe(0);
    });

    it("should handle non-existent map point", () => {
      expect(() => {
        bundleAdjustment.addObservation("nonexistent", 0, 0);
      }).not.toThrow();
    });
  });

  describe("shouldAddKeyframe", () => {
    it("should return true for first keyframe", () => {
      const pose = createIdentityPose();
      const features = Array.from({ length: 60 }, (_, i) =>
        createFeature(100 + i * 5, 100 + i * 3, `f${i}`)
      );

      // Simulate enough frames since last keyframe
      for (let i = 0; i < 10; i++) {
        bundleAdjustment.shouldAddKeyframe(pose, features);
      }

      const result = bundleAdjustment.shouldAddKeyframe(pose, features);

      expect(result).toBe(true);
    });

    it("should return false before keyframe interval", () => {
      bundleAdjustment.addKeyframe(
        createKeyframe(createIdentityPose(), [], 0)
      );

      const pose = createIdentityPose(100);
      const features = Array.from({ length: 60 }, (_, i) =>
        createFeature(100 + i * 5, 100 + i * 3, `f${i}`)
      );

      // Only 5 frames since last keyframe
      for (let i = 0; i < 5; i++) {
        bundleAdjustment.shouldAddKeyframe(pose, features);
      }

      const result = bundleAdjustment.shouldAddKeyframe(pose, features);

      expect(result).toBe(false);
    });

    it("should return true when not enough tracked features", () => {
      bundleAdjustment.addKeyframe(
        createKeyframe(createIdentityPose(), [], 0)
      );

      const pose = createIdentityPose(100);
      const features = [
        createFeature(100, 100, "f0"),
        createFeature(200, 200, "f1"),
      ]; // Only 2 features

      // Enough frames since last keyframe
      for (let i = 0; i < 15; i++) {
        bundleAdjustment.shouldAddKeyframe(pose, features);
      }

      const result = bundleAdjustment.shouldAddKeyframe(pose, features);

      expect(result).toBe(true);
    });

    it("should return true when parallax is sufficient", () => {
      bundleAdjustment.addKeyframe(
        createKeyframe(createIdentityPose(), [], 0)
      );

      // Create rotated pose with sufficient parallax
      const rotatedPose = createRotatedPose(0.1, 100); // 0.1 rad > 0.03 default
      const features = Array.from({ length: 60 }, (_, i) =>
        createFeature(100 + i * 5, 100 + i * 3, `f${i}`)
      );

      // Enough frames since last keyframe
      for (let i = 0; i < 15; i++) {
        bundleAdjustment.shouldAddKeyframe(rotatedPose, features);
      }

      const result = bundleAdjustment.shouldAddKeyframe(rotatedPose, features);

      expect(result).toBe(true);
    });
  });

  describe("getLastKeyframe", () => {
    it("should return null when no keyframes", () => {
      const result = bundleAdjustment.getLastKeyframe();
      expect(result).toBeNull();
    });

    it("should return most recent keyframe", () => {
      bundleAdjustment.addKeyframe(createKeyframe(createIdentityPose(), [], 0));
      bundleAdjustment.addKeyframe(
        createKeyframe(createTranslatedPose(1, 0, 0), [], 100)
      );
      bundleAdjustment.addKeyframe(
        createKeyframe(createTranslatedPose(2, 0, 0), [], 200)
      );

      const last = bundleAdjustment.getLastKeyframe();

      expect(last).toBeDefined();
      expect(last?.pose.translation.x).toBe(2);
    });
  });

  describe("optimize", () => {
    it("should return empty result when not enough keyframes", () => {
      bundleAdjustment.addKeyframe(createKeyframe(createIdentityPose(), []));

      const result = bundleAdjustment.optimize();

      expect(result.optimizedPoses.size).toBe(0);
      expect(result.optimizedPoints.size).toBe(0);
      expect(result.converged).toBe(true);
    });

    it("should return empty result when not enough map points", () => {
      bundleAdjustment.addKeyframe(
        createKeyframe(createIdentityPose(), [], 0)
      );
      bundleAdjustment.addKeyframe(
        createKeyframe(createTranslatedPose(1, 0, 0), [], 100)
      );

      const result = bundleAdjustment.optimize();

      expect(result.optimizedPoses.size).toBe(0);
      expect(result.optimizedPoints.size).toBe(0);
    });

    it("should optimize with valid keyframes and map points", () => {
      // Create two keyframes with features
      const features1 = [
        createFeature(320, 240, "f0"),
        createFeature(400, 300, "f1"),
        createFeature(200, 180, "f2"),
      ];
      const features2 = [
        createFeature(310, 240, "f0"),
        createFeature(390, 300, "f1"),
        createFeature(190, 180, "f2"),
      ];

      const kf1Id = bundleAdjustment.addKeyframe(
        createKeyframe(createIdentityPose(0), features1, 0)
      );
      const kf2Id = bundleAdjustment.addKeyframe(
        createKeyframe(createTranslatedPose(0.5, 0, 0, 100), features2, 100)
      );

      // Create map points with observations
      for (let i = 0; i < 3; i++) {
        const observations = new Map<number, number>();
        observations.set(kf1Id, i);
        observations.set(kf2Id, i);

        const point = createMapPoint(
          `p${i}`,
          new THREE.Vector3((i - 1) * 0.5, (i % 2) * 0.3, 5),
          observations
        );
        bundleAdjustment.addMapPoint(point);
      }

      const result = bundleAdjustment.optimize();

      expect(result.iterations).toBeGreaterThan(0);
      expect(result.optimizedPoses.size).toBeGreaterThan(0);
      expect(result.optimizedPoints.size).toBeGreaterThan(0);
    });

    it("should calculate cost values", () => {
      // Create keyframes with feature observations
      const features1 = [
        createFeature(320, 240, "f0"),
        createFeature(420, 300, "f1"),
        createFeature(220, 180, "f2"),
        createFeature(350, 280, "f3"),
      ];
      const features2 = [
        createFeature(312, 238, "f0"),
        createFeature(412, 298, "f1"),
        createFeature(212, 178, "f2"),
        createFeature(342, 278, "f3"),
      ];

      const kf1Id = bundleAdjustment.addKeyframe(
        createKeyframe(createIdentityPose(0), features1, 0)
      );
      const kf2Id = bundleAdjustment.addKeyframe(
        createKeyframe(createTranslatedPose(0.3, 0, 0, 100), features2, 100)
      );

      // Create map points
      for (let i = 0; i < 4; i++) {
        const observations = new Map<number, number>();
        observations.set(kf1Id, i);
        observations.set(kf2Id, i);

        const point = createMapPoint(
          `p${i}`,
          new THREE.Vector3((i - 1.5) * 0.4, (i % 2 - 0.5) * 0.3, 5),
          observations
        );
        bundleAdjustment.addMapPoint(point);
      }

      const result = bundleAdjustment.optimize();

      // Should have calculated both initial and final costs
      expect(result.initialCost).toBeGreaterThanOrEqual(0);
      expect(result.finalCost).toBeGreaterThanOrEqual(0);
      expect(result.iterations).toBeGreaterThan(0);
    });

    it("should converge within max iterations", () => {
      const ba = new LocalBundleAdjustment(defaultIntrinsics, {
        maxIterations: 5,
      });

      const features1 = [
        createFeature(320, 240, "f0"),
        createFeature(400, 300, "f1"),
        createFeature(200, 180, "f2"),
      ];
      const features2 = [
        createFeature(310, 240, "f0"),
        createFeature(390, 300, "f1"),
        createFeature(190, 180, "f2"),
      ];

      const kf1Id = ba.addKeyframe(
        createKeyframe(createIdentityPose(0), features1, 0)
      );
      const kf2Id = ba.addKeyframe(
        createKeyframe(createTranslatedPose(0.5, 0, 0, 100), features2, 100)
      );

      for (let i = 0; i < 3; i++) {
        const observations = new Map<number, number>();
        observations.set(kf1Id, i);
        observations.set(kf2Id, i);

        const point = createMapPoint(
          `p${i}`,
          new THREE.Vector3((i - 1) * 0.5, 0, 5),
          observations
        );
        ba.addMapPoint(point);
      }

      const result = ba.optimize();

      expect(result.iterations).toBeLessThanOrEqual(5);
    });
  });

  describe("getKeyframes", () => {
    it("should return all keyframes", () => {
      bundleAdjustment.addKeyframe(createKeyframe(createIdentityPose(), [], 0));
      bundleAdjustment.addKeyframe(
        createKeyframe(createTranslatedPose(1, 0, 0), [], 100)
      );

      const keyframes = bundleAdjustment.getKeyframes();

      expect(keyframes).toHaveLength(2);
    });

    it("should return empty array when no keyframes", () => {
      const keyframes = bundleAdjustment.getKeyframes();
      expect(keyframes).toHaveLength(0);
    });
  });

  describe("getMapPoints", () => {
    it("should return all map points", () => {
      bundleAdjustment.addMapPoint(
        createMapPoint("p0", new THREE.Vector3(0, 0, 5))
      );
      bundleAdjustment.addMapPoint(
        createMapPoint("p1", new THREE.Vector3(1, 0, 5))
      );

      const points = bundleAdjustment.getMapPoints();

      expect(points).toHaveLength(2);
    });
  });

  describe("getKeyframe", () => {
    it("should return keyframe by ID", () => {
      const id = bundleAdjustment.addKeyframe(
        createKeyframe(createTranslatedPose(1, 2, 3), [], 0)
      );

      const keyframe = bundleAdjustment.getKeyframe(id);

      expect(keyframe).toBeDefined();
      expect(keyframe?.pose.translation.x).toBe(1);
    });

    it("should return undefined for invalid ID", () => {
      const keyframe = bundleAdjustment.getKeyframe(999);
      expect(keyframe).toBeUndefined();
    });
  });

  describe("getMapPoint", () => {
    it("should return map point by ID", () => {
      bundleAdjustment.addMapPoint(
        createMapPoint("test_point", new THREE.Vector3(1, 2, 3))
      );

      const point = bundleAdjustment.getMapPoint("test_point");

      expect(point).toBeDefined();
      expect(point?.position.x).toBe(1);
    });

    it("should return undefined for invalid ID", () => {
      const point = bundleAdjustment.getMapPoint("nonexistent");
      expect(point).toBeUndefined();
    });
  });

  describe("markAsOutlier", () => {
    it("should mark map point as invalid", () => {
      bundleAdjustment.addMapPoint(
        createMapPoint("p0", new THREE.Vector3(0, 0, 5))
      );

      bundleAdjustment.markAsOutlier("p0");

      const point = bundleAdjustment.getMapPoint("p0");
      expect(point?.isValid).toBe(false);
    });

    it("should handle non-existent map point", () => {
      expect(() => {
        bundleAdjustment.markAsOutlier("nonexistent");
      }).not.toThrow();
    });
  });

  describe("updateIntrinsics", () => {
    it("should update intrinsics", () => {
      const newIntrinsics: CameraIntrinsics = {
        fx: 600,
        fy: 600,
        cx: 400,
        cy: 300,
        width: 800,
        height: 600,
      };

      bundleAdjustment.updateIntrinsics(newIntrinsics);

      expect(bundleAdjustment).toBeDefined();
    });
  });

  describe("updateOptions", () => {
    it("should update windowSize", () => {
      bundleAdjustment.updateOptions({ windowSize: 5 });
      expect(bundleAdjustment).toBeDefined();
    });

    it("should update all options", () => {
      bundleAdjustment.updateOptions({
        windowSize: 5,
        maxIterations: 20,
        convergenceThreshold: 1e-8,
        keyframeInterval: 5,
        minParallax: 0.05,
        minTrackedFeatures: 30,
        huberThreshold: 4.0,
      });

      expect(bundleAdjustment).toBeDefined();
    });
  });

  describe("reset", () => {
    it("should clear all state", () => {
      bundleAdjustment.addKeyframe(createKeyframe(createIdentityPose(), []));
      bundleAdjustment.addMapPoint(
        createMapPoint("p0", new THREE.Vector3(0, 0, 5))
      );

      bundleAdjustment.reset();

      expect(bundleAdjustment.getKeyframeCount()).toBe(0);
      expect(bundleAdjustment.getMapPointCount()).toBe(0);
    });

    it("should reset keyframe ID counter", () => {
      bundleAdjustment.addKeyframe(createKeyframe(createIdentityPose(), []));
      bundleAdjustment.addKeyframe(createKeyframe(createIdentityPose(), []));
      bundleAdjustment.reset();

      const newId = bundleAdjustment.addKeyframe(
        createKeyframe(createIdentityPose(), [])
      );

      expect(newId).toBe(0);
    });
  });

  describe("dispose", () => {
    it("should clean up resources", () => {
      bundleAdjustment.addKeyframe(createKeyframe(createIdentityPose(), []));
      bundleAdjustment.addMapPoint(
        createMapPoint("p0", new THREE.Vector3(0, 0, 5))
      );

      bundleAdjustment.dispose();

      expect(bundleAdjustment.getKeyframeCount()).toBe(0);
      expect(bundleAdjustment.getMapPointCount()).toBe(0);
    });
  });

  describe("sliding window pruning", () => {
    it("should remove old keyframes when exceeding window size", () => {
      const ba = new LocalBundleAdjustment(defaultIntrinsics, {
        windowSize: 3,
      });

      const ids: number[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push(
          ba.addKeyframe(createKeyframe(createIdentityPose(), [], i * 100))
        );
      }

      expect(ba.getKeyframeCount()).toBe(3);
      expect(ba.getKeyframe(ids[0])).toBeUndefined();
      expect(ba.getKeyframe(ids[1])).toBeUndefined();
      expect(ba.getKeyframe(ids[4])).toBeDefined();
    });

    it("should remove observations when keyframe is pruned", () => {
      const ba = new LocalBundleAdjustment(defaultIntrinsics, {
        windowSize: 3,
      });

      const kf1Id = ba.addKeyframe(
        createKeyframe(createIdentityPose(), [createFeature(100, 100, "f0")], 0)
      );
      const kf2Id = ba.addKeyframe(
        createKeyframe(createIdentityPose(), [createFeature(100, 100, "f0")], 100)
      );
      const kf3Id = ba.addKeyframe(
        createKeyframe(createIdentityPose(), [createFeature(100, 100, "f0")], 200)
      );

      // Create map point with observations in all 3 keyframes
      const observations = new Map<number, number>();
      observations.set(kf1Id, 0);
      observations.set(kf2Id, 0);
      observations.set(kf3Id, 0);
      ba.addMapPoint(
        createMapPoint("p0", new THREE.Vector3(0, 0, 5), observations)
      );

      // Verify initial state
      expect(ba.getMapPoint("p0")?.observationCount).toBe(3);

      // Add another keyframe to push out the first one
      ba.addKeyframe(createKeyframe(createIdentityPose(), [], 300));

      // Point should still exist with 2 remaining observations
      const point = ba.getMapPoint("p0");
      expect(point).toBeDefined();
      expect(point?.observations.has(kf1Id)).toBe(false);
      expect(point?.observationCount).toBe(2);
    });

    it("should remove map points with too few observations", () => {
      const ba = new LocalBundleAdjustment(defaultIntrinsics, {
        windowSize: 2,
      });

      const kf1Id = ba.addKeyframe(
        createKeyframe(createIdentityPose(), [createFeature(100, 100, "f0")], 0)
      );

      const observations = new Map<number, number>();
      observations.set(kf1Id, 0);
      ba.addMapPoint(
        createMapPoint("p0", new THREE.Vector3(0, 0, 5), observations)
      );

      // Add more keyframes
      ba.addKeyframe(createKeyframe(createIdentityPose(), [], 100));
      ba.addKeyframe(createKeyframe(createIdentityPose(), [], 200));

      // Point should be removed since it has < 2 observations
      expect(ba.getMapPoint("p0")).toBeUndefined();
    });
  });
});

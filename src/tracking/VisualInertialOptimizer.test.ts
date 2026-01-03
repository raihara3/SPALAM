import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { VisualInertialOptimizer } from "./VisualInertialOptimizer";
import type {
  Keyframe,
  MapPoint,
  CameraPose,
  CameraIntrinsics,
  IMUBiases,
} from "../types/Pose";
import type { IMUConstraint } from "./VisualInertialOptimizer";

function createTestPose(
  x: number,
  y: number,
  z: number,
  timestamp: number
): CameraPose {
  return {
    rotation: new THREE.Matrix3(),
    translation: new THREE.Vector3(x, y, z),
    quaternion: new THREE.Quaternion(),
    timestamp,
    confidence: 1.0,
  };
}

function createTestKeyframe(
  id: number,
  pose: CameraPose,
  features: Array<{ x: number; y: number }>
): Keyframe {
  return {
    id,
    pose,
    features: features.map((f, i) => ({
      x: f.x,
      y: f.y,
      id: `feature_${id}_${i}`,
      score: 1.0,
      octave: 0,
      angle: 0,
      trackingCount: 1,
    })),
    descriptors: null,
    timestamp: pose.timestamp,
  };
}

function createTestMapPoint(
  id: string,
  position: THREE.Vector3,
  observations: Map<number, number>
): MapPoint {
  return {
    id,
    position,
    observations,
    observationCount: observations.size,
    isValid: true,
  };
}

describe("VisualInertialOptimizer", () => {
  let optimizer: VisualInertialOptimizer;
  let intrinsics: CameraIntrinsics;

  beforeEach(() => {
    intrinsics = {
      fx: 500,
      fy: 500,
      cx: 320,
      cy: 240,
      width: 640,
      height: 480,
    };
    optimizer = new VisualInertialOptimizer(intrinsics);
  });

  describe("constructor", () => {
    it("should initialize with default options", () => {
      expect(optimizer).toBeInstanceOf(VisualInertialOptimizer);
    });

    it("should initialize with custom options", () => {
      const customOptimizer = new VisualInertialOptimizer(intrinsics, {
        maxIterations: 20,
        convergenceThreshold: 1e-8,
        reprojectionWeight: 2.0,
        imuWeight: 0.5,
      });
      expect(customOptimizer).toBeInstanceOf(VisualInertialOptimizer);
    });
  });

  describe("optimize", () => {
    it("should return empty result for insufficient keyframes", () => {
      const keyframes: Keyframe[] = [
        createTestKeyframe(0, createTestPose(0, 0, 0, 1000), []),
      ];

      const result = optimizer.optimize(
        keyframes,
        [],
        [],
        1.0,
        new THREE.Vector3(0, -1, 0),
        {
          accelerometerBias: new THREE.Vector3(),
          gyroscopeBias: new THREE.Vector3(),
        }
      );

      expect(result.converged).toBe(true);
      expect(result.poses.size).toBe(0);
    });

    it("should optimize with keyframes and map points", () => {
      const keyframes: Keyframe[] = [
        createTestKeyframe(
          0,
          createTestPose(0, 0, 0, 1000),
          [{ x: 320, y: 240 }]
        ),
        createTestKeyframe(
          1,
          createTestPose(1, 0, 0, 1500),
          [{ x: 310, y: 240 }]
        ),
      ];

      const observations = new Map<number, number>();
      observations.set(0, 0);
      observations.set(1, 0);

      const mapPoints: MapPoint[] = [
        createTestMapPoint("point1", new THREE.Vector3(10, 0, 20), observations),
      ];

      const imuConstraints: IMUConstraint[] = [];
      const initialScale = 1.0;
      const initialGravity = new THREE.Vector3(0, -1, 0);
      const initialBiases: IMUBiases = {
        accelerometerBias: new THREE.Vector3(),
        gyroscopeBias: new THREE.Vector3(),
      };

      const result = optimizer.optimize(
        keyframes,
        mapPoints,
        imuConstraints,
        initialScale,
        initialGravity,
        initialBiases
      );

      expect(result.poses.size).toBeGreaterThan(0);
      expect(result.scale).toBeGreaterThan(0);
    });

    it("should optimize with IMU constraints", () => {
      const keyframes: Keyframe[] = [
        createTestKeyframe(
          0,
          createTestPose(0, 0, 0, 1000),
          [{ x: 320, y: 240 }]
        ),
        createTestKeyframe(
          1,
          createTestPose(1, 0, 0, 1500),
          [{ x: 310, y: 240 }]
        ),
      ];

      const observations = new Map<number, number>();
      observations.set(0, 0);
      observations.set(1, 0);

      const mapPoints: MapPoint[] = [
        createTestMapPoint("point1", new THREE.Vector3(10, 0, 20), observations),
      ];

      const imuConstraints: IMUConstraint[] = [
        {
          keyframeIdStart: 0,
          keyframeIdEnd: 1,
          preintegration: {
            deltaPosition: new THREE.Vector3(1, 0, 0),
            deltaVelocity: new THREE.Vector3(2, 0, 0),
            deltaRotation: new THREE.Quaternion(),
            covariance: [],
            integrationTime: 0.5,
            measurementCount: 50,
          },
          velocityStart: new THREE.Vector3(0, 0, 0),
        },
      ];

      const result = optimizer.optimize(
        keyframes,
        mapPoints,
        imuConstraints,
        1.0,
        new THREE.Vector3(0, -1, 0),
        {
          accelerometerBias: new THREE.Vector3(),
          gyroscopeBias: new THREE.Vector3(),
        }
      );

      expect(result.velocities.size).toBeGreaterThan(0);
      expect(result.biases).toBeDefined();
    });

    it("should converge on consistent data", () => {
      const keyframes: Keyframe[] = [
        createTestKeyframe(
          0,
          createTestPose(0, 0, 0, 1000),
          [{ x: 320, y: 240 }, { x: 400, y: 300 }]
        ),
        createTestKeyframe(
          1,
          createTestPose(0.5, 0, 0, 1500),
          [{ x: 315, y: 240 }, { x: 395, y: 300 }]
        ),
        createTestKeyframe(
          2,
          createTestPose(1, 0, 0, 2000),
          [{ x: 310, y: 240 }, { x: 390, y: 300 }]
        ),
      ];

      const observations1 = new Map<number, number>();
      observations1.set(0, 0);
      observations1.set(1, 0);
      observations1.set(2, 0);

      const observations2 = new Map<number, number>();
      observations2.set(0, 1);
      observations2.set(1, 1);
      observations2.set(2, 1);

      const mapPoints: MapPoint[] = [
        createTestMapPoint(
          "point1",
          new THREE.Vector3(10, 0, 20),
          observations1
        ),
        createTestMapPoint(
          "point2",
          new THREE.Vector3(15, 5, 25),
          observations2
        ),
      ];

      const imuConstraints: IMUConstraint[] = [
        {
          keyframeIdStart: 0,
          keyframeIdEnd: 1,
          preintegration: {
            deltaPosition: new THREE.Vector3(0.5, 0, 0),
            deltaVelocity: new THREE.Vector3(1, 0, 0),
            deltaRotation: new THREE.Quaternion(),
            covariance: [],
            integrationTime: 0.5,
            measurementCount: 50,
          },
          velocityStart: new THREE.Vector3(0, 0, 0),
        },
        {
          keyframeIdStart: 1,
          keyframeIdEnd: 2,
          preintegration: {
            deltaPosition: new THREE.Vector3(0.5, 0, 0),
            deltaVelocity: new THREE.Vector3(1, 0, 0),
            deltaRotation: new THREE.Quaternion(),
            covariance: [],
            integrationTime: 0.5,
            measurementCount: 50,
          },
          velocityStart: new THREE.Vector3(1, 0, 0),
        },
      ];

      const result = optimizer.optimize(
        keyframes,
        mapPoints,
        imuConstraints,
        1.0,
        new THREE.Vector3(0, -1, 0),
        {
          accelerometerBias: new THREE.Vector3(),
          gyroscopeBias: new THREE.Vector3(),
        }
      );

      // Should converge or run all iterations
      expect(result.cost).toBeGreaterThanOrEqual(0);
    });

    it("should clamp scale to valid range", () => {
      const keyframes: Keyframe[] = [
        createTestKeyframe(
          0,
          createTestPose(0, 0, 0, 1000),
          [{ x: 320, y: 240 }]
        ),
        createTestKeyframe(
          1,
          createTestPose(1, 0, 0, 1500),
          [{ x: 310, y: 240 }]
        ),
      ];

      const observations = new Map<number, number>();
      observations.set(0, 0);
      observations.set(1, 0);

      const mapPoints: MapPoint[] = [
        createTestMapPoint("point1", new THREE.Vector3(10, 0, 20), observations),
      ];

      // Start with extreme scale
      const result = optimizer.optimize(
        keyframes,
        mapPoints,
        [],
        0.001, // Very small scale
        new THREE.Vector3(0, -1, 0),
        {
          accelerometerBias: new THREE.Vector3(),
          gyroscopeBias: new THREE.Vector3(),
        }
      );

      expect(result.scale).toBeGreaterThanOrEqual(0.01);
      expect(result.scale).toBeLessThanOrEqual(100);
    });

    it("should return biases within reasonable bounds", () => {
      const keyframes: Keyframe[] = [
        createTestKeyframe(
          0,
          createTestPose(0, 0, 0, 1000),
          [{ x: 320, y: 240 }]
        ),
        createTestKeyframe(
          1,
          createTestPose(1, 0, 0, 1500),
          [{ x: 310, y: 240 }]
        ),
      ];

      const observations = new Map<number, number>();
      observations.set(0, 0);
      observations.set(1, 0);

      const mapPoints: MapPoint[] = [
        createTestMapPoint("point1", new THREE.Vector3(10, 0, 20), observations),
      ];

      const imuConstraints: IMUConstraint[] = [
        {
          keyframeIdStart: 0,
          keyframeIdEnd: 1,
          preintegration: {
            deltaPosition: new THREE.Vector3(1, 0, 0),
            deltaVelocity: new THREE.Vector3(2, 0, 0),
            deltaRotation: new THREE.Quaternion(),
            covariance: [],
            integrationTime: 0.5,
            measurementCount: 50,
          },
          velocityStart: new THREE.Vector3(0, 0, 0),
        },
      ];

      const result = optimizer.optimize(
        keyframes,
        mapPoints,
        imuConstraints,
        1.0,
        new THREE.Vector3(0, -1, 0),
        {
          accelerometerBias: new THREE.Vector3(),
          gyroscopeBias: new THREE.Vector3(),
        }
      );

      // Biases should be within reasonable limits
      expect(result.biases.accelerometerBias.length()).toBeLessThanOrEqual(1.0);
      expect(result.biases.gyroscopeBias.length()).toBeLessThanOrEqual(0.1);
    });

    it("should normalize gravity direction", () => {
      const keyframes: Keyframe[] = [
        createTestKeyframe(
          0,
          createTestPose(0, 0, 0, 1000),
          [{ x: 320, y: 240 }]
        ),
        createTestKeyframe(
          1,
          createTestPose(1, 0, 0, 1500),
          [{ x: 310, y: 240 }]
        ),
      ];

      const observations = new Map<number, number>();
      observations.set(0, 0);
      observations.set(1, 0);

      const mapPoints: MapPoint[] = [
        createTestMapPoint("point1", new THREE.Vector3(10, 0, 20), observations),
      ];

      const imuConstraints: IMUConstraint[] = [
        {
          keyframeIdStart: 0,
          keyframeIdEnd: 1,
          preintegration: {
            deltaPosition: new THREE.Vector3(1, -0.5, 0),
            deltaVelocity: new THREE.Vector3(2, 0, 0),
            deltaRotation: new THREE.Quaternion(),
            covariance: [],
            integrationTime: 0.5,
            measurementCount: 50,
          },
          velocityStart: new THREE.Vector3(0, 0, 0),
        },
      ];

      const result = optimizer.optimize(
        keyframes,
        mapPoints,
        imuConstraints,
        1.0,
        new THREE.Vector3(0, -1, 0),
        {
          accelerometerBias: new THREE.Vector3(),
          gyroscopeBias: new THREE.Vector3(),
        }
      );

      expect(result.gravityDirection.length()).toBeCloseTo(1, 5);
    });
  });

  describe("updateIntrinsics", () => {
    it("should update camera intrinsics", () => {
      const newIntrinsics: CameraIntrinsics = {
        fx: 600,
        fy: 600,
        cx: 400,
        cy: 300,
      };

      optimizer.updateIntrinsics(newIntrinsics);

      // Verify by running optimization (intrinsics affect projection)
      const keyframes: Keyframe[] = [
        createTestKeyframe(
          0,
          createTestPose(0, 0, 0, 1000),
          [{ x: 400, y: 300 }]
        ),
        createTestKeyframe(
          1,
          createTestPose(1, 0, 0, 1500),
          [{ x: 390, y: 300 }]
        ),
      ];

      const observations = new Map<number, number>();
      observations.set(0, 0);
      observations.set(1, 0);

      const mapPoints: MapPoint[] = [
        createTestMapPoint("point1", new THREE.Vector3(10, 0, 20), observations),
      ];

      const result = optimizer.optimize(
        keyframes,
        mapPoints,
        [],
        1.0,
        new THREE.Vector3(0, -1, 0),
        {
          accelerometerBias: new THREE.Vector3(),
          gyroscopeBias: new THREE.Vector3(),
        }
      );

      expect(result).toBeDefined();
    });
  });

  describe("updateOptions", () => {
    it("should update optimization options", () => {
      optimizer.updateOptions({
        maxIterations: 5,
        convergenceThreshold: 0.1,
      });

      // Run optimization with fewer iterations
      const keyframes: Keyframe[] = [
        createTestKeyframe(
          0,
          createTestPose(0, 0, 0, 1000),
          [{ x: 320, y: 240 }]
        ),
        createTestKeyframe(
          1,
          createTestPose(1, 0, 0, 1500),
          [{ x: 310, y: 240 }]
        ),
      ];

      const observations = new Map<number, number>();
      observations.set(0, 0);
      observations.set(1, 0);

      const mapPoints: MapPoint[] = [
        createTestMapPoint("point1", new THREE.Vector3(10, 0, 20), observations),
      ];

      const result = optimizer.optimize(
        keyframes,
        mapPoints,
        [],
        1.0,
        new THREE.Vector3(0, -1, 0),
        {
          accelerometerBias: new THREE.Vector3(),
          gyroscopeBias: new THREE.Vector3(),
        }
      );

      expect(result).toBeDefined();
    });
  });

  describe("reset", () => {
    it("should reset optimizer state", () => {
      optimizer.reset();
      // No internal state to verify, but should not throw
      expect(optimizer).toBeInstanceOf(VisualInertialOptimizer);
    });
  });

  describe("dispose", () => {
    it("should dispose resources", () => {
      optimizer.dispose();
      // Should not throw
      expect(optimizer).toBeInstanceOf(VisualInertialOptimizer);
    });
  });

  describe("edge cases", () => {
    it("should handle empty map points", () => {
      const keyframes: Keyframe[] = [
        createTestKeyframe(0, createTestPose(0, 0, 0, 1000), []),
        createTestKeyframe(1, createTestPose(1, 0, 0, 1500), []),
      ];

      const result = optimizer.optimize(
        keyframes,
        [],
        [],
        1.0,
        new THREE.Vector3(0, -1, 0),
        {
          accelerometerBias: new THREE.Vector3(),
          gyroscopeBias: new THREE.Vector3(),
        }
      );

      expect(result).toBeDefined();
      expect(result.poses.size).toBeGreaterThan(0);
    });

    it("should handle invalid map points", () => {
      const keyframes: Keyframe[] = [
        createTestKeyframe(
          0,
          createTestPose(0, 0, 0, 1000),
          [{ x: 320, y: 240 }]
        ),
        createTestKeyframe(
          1,
          createTestPose(1, 0, 0, 1500),
          [{ x: 310, y: 240 }]
        ),
      ];

      const observations = new Map<number, number>();
      observations.set(0, 0);
      observations.set(1, 0);

      const mapPoints: MapPoint[] = [
        {
          id: "invalid_point",
          position: new THREE.Vector3(10, 0, 20),
          observations,
          observationCount: 2,
          isValid: false, // Invalid point
        },
      ];

      const result = optimizer.optimize(
        keyframes,
        mapPoints,
        [],
        1.0,
        new THREE.Vector3(0, -1, 0),
        {
          accelerometerBias: new THREE.Vector3(),
          gyroscopeBias: new THREE.Vector3(),
        }
      );

      expect(result).toBeDefined();
    });

    it("should handle very short IMU integration time", () => {
      const keyframes: Keyframe[] = [
        createTestKeyframe(
          0,
          createTestPose(0, 0, 0, 1000),
          [{ x: 320, y: 240 }]
        ),
        createTestKeyframe(
          1,
          createTestPose(1, 0, 0, 1005),
          [{ x: 310, y: 240 }]
        ),
      ];

      const observations = new Map<number, number>();
      observations.set(0, 0);
      observations.set(1, 0);

      const mapPoints: MapPoint[] = [
        createTestMapPoint("point1", new THREE.Vector3(10, 0, 20), observations),
      ];

      const imuConstraints: IMUConstraint[] = [
        {
          keyframeIdStart: 0,
          keyframeIdEnd: 1,
          preintegration: {
            deltaPosition: new THREE.Vector3(0.01, 0, 0),
            deltaVelocity: new THREE.Vector3(0.02, 0, 0),
            deltaRotation: new THREE.Quaternion(),
            covariance: [],
            integrationTime: 0.005, // Very short
            measurementCount: 5,
          },
          velocityStart: new THREE.Vector3(0, 0, 0),
        },
      ];

      const result = optimizer.optimize(
        keyframes,
        mapPoints,
        imuConstraints,
        1.0,
        new THREE.Vector3(0, -1, 0),
        {
          accelerometerBias: new THREE.Vector3(),
          gyroscopeBias: new THREE.Vector3(),
        }
      );

      expect(result).toBeDefined();
    });
  });
});

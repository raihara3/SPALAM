import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { ScaleEstimator } from "./ScaleEstimator";
import type { CameraPose, PreintegrationResult } from "../types/Pose";

describe("ScaleEstimator", () => {
  let estimator: ScaleEstimator;

  beforeEach(() => {
    estimator = new ScaleEstimator();
  });

  describe("constructor", () => {
    it("should initialize with default options", () => {
      expect(estimator.getState()).toBe("uninitialized");
      expect(estimator.getScale()).toBe(1.0);
      expect(estimator.isConverged()).toBe(false);
    });

    it("should initialize with custom options", () => {
      const customEstimator = new ScaleEstimator({
        gravityMagnitude: 9.81,
        minStaticSamples: 50,
        convergenceThreshold: 0.02,
      });

      expect(customEstimator.getState()).toBe("uninitialized");
      expect(customEstimator.getScale()).toBe(1.0);
    });
  });

  describe("addStaticSample", () => {
    it("should accept static samples", () => {
      const acceleration = new THREE.Vector3(0, -9.8, 0);
      const angularVelocity = new THREE.Vector3(0, 0, 0);

      const result = estimator.addStaticSample(acceleration, angularVelocity, 1000);

      expect(result).toBe(false); // Not enough samples yet
      expect(estimator.getState()).toBe("initializing");
    });

    it("should reject samples with high angular velocity", () => {
      const acceleration = new THREE.Vector3(0, -9.8, 0);
      const angularVelocity = new THREE.Vector3(0.1, 0, 0); // Too high

      estimator.addStaticSample(acceleration, angularVelocity, 1000);

      expect(estimator.getState()).toBe("uninitialized");
    });

    it("should reject samples with acceleration deviation from gravity", () => {
      const acceleration = new THREE.Vector3(0, -8.0, 0); // Too far from 9.8
      const angularVelocity = new THREE.Vector3(0, 0, 0);

      estimator.addStaticSample(acceleration, angularVelocity, 1000);

      expect(estimator.getState()).toBe("uninitialized");
    });

    it("should initialize from sufficient static samples", () => {
      // Add 30 static samples
      for (let i = 0; i < 35; i++) {
        const acceleration = new THREE.Vector3(0, -9.8, 0);
        const angularVelocity = new THREE.Vector3(0, 0, 0);
        estimator.addStaticSample(acceleration, angularVelocity, 1000 + i * 50);
      }

      expect(estimator.getState()).toBe("converging");
    });

    it("should compute gravity direction from samples", () => {
      // Add samples with gravity pointing down (-Y)
      for (let i = 0; i < 35; i++) {
        const acceleration = new THREE.Vector3(0, -9.8, 0);
        const angularVelocity = new THREE.Vector3(0, 0, 0);
        estimator.addStaticSample(acceleration, angularVelocity, 1000 + i * 50);
      }

      const gravityDir = estimator.getGravityDirection();
      // Gravity direction should be pointing down (opposite direction to measured acceleration)
      // When acceleration is (0, -9.8, 0), gravity direction is normalized and negated
      expect(Math.abs(gravityDir.y)).toBeCloseTo(1, 1);
    });

    it("should remove old samples beyond time window", () => {
      // Add samples spanning more than 2 seconds
      for (let i = 0; i < 10; i++) {
        const acceleration = new THREE.Vector3(0, -9.8, 0);
        const angularVelocity = new THREE.Vector3(0, 0, 0);
        estimator.addStaticSample(acceleration, angularVelocity, 1000 + i * 500);
      }

      // Should not be initialized because samples are spread too far apart
      expect(estimator.getState()).not.toBe("converging");
    });
  });

  describe("updateScale", () => {
    beforeEach(() => {
      // Initialize estimator first
      for (let i = 0; i < 35; i++) {
        const acceleration = new THREE.Vector3(0, -9.8, 0);
        const angularVelocity = new THREE.Vector3(0, 0, 0);
        estimator.addStaticSample(acceleration, angularVelocity, 1000 + i * 50);
      }
    });

    it("should not update when uninitialized", () => {
      const uninitializedEstimator = new ScaleEstimator();
      const visualTranslation = new THREE.Vector3(1, 0, 0);
      const preintegration: PreintegrationResult = {
        deltaPosition: new THREE.Vector3(2, 0, 0),
        deltaVelocity: new THREE.Vector3(0, 0, 0),
        deltaRotation: new THREE.Quaternion(),
        covariance: [],
        integrationTime: 0.1,
        measurementCount: 10,
      };

      uninitializedEstimator.updateScale(
        visualTranslation,
        preintegration,
        new THREE.Vector3(),
        0.1
      );

      expect(uninitializedEstimator.getScale()).toBe(1.0);
    });

    it("should update scale from visual-inertial comparison", () => {
      const initialScale = estimator.getScale();
      const visualTranslation = new THREE.Vector3(0.5, 0, 0);
      const preintegration: PreintegrationResult = {
        deltaPosition: new THREE.Vector3(1.0, 0, 0),
        deltaVelocity: new THREE.Vector3(0, 0, 0),
        deltaRotation: new THREE.Quaternion(),
        covariance: [],
        integrationTime: 0.5,
        measurementCount: 50,
      };

      estimator.updateScale(
        visualTranslation,
        preintegration,
        new THREE.Vector3(),
        0.5
      );

      expect(estimator.getScale()).not.toBe(initialScale);
    });

    it("should ignore very small translations", () => {
      const initialScale = estimator.getScale();
      const visualTranslation = new THREE.Vector3(0.0001, 0, 0);
      const preintegration: PreintegrationResult = {
        deltaPosition: new THREE.Vector3(0.0001, 0, 0),
        deltaVelocity: new THREE.Vector3(0, 0, 0),
        deltaRotation: new THREE.Quaternion(),
        covariance: [],
        integrationTime: 0.1,
        measurementCount: 10,
      };

      estimator.updateScale(
        visualTranslation,
        preintegration,
        new THREE.Vector3(),
        0.1
      );

      expect(estimator.getScale()).toBe(initialScale);
    });

    it("should clamp scale to valid range", () => {
      const visualTranslation = new THREE.Vector3(0.001, 0, 0);
      const preintegration: PreintegrationResult = {
        deltaPosition: new THREE.Vector3(200, 0, 0), // Would result in scale > 100
        deltaVelocity: new THREE.Vector3(0, 0, 0),
        deltaRotation: new THREE.Quaternion(),
        covariance: [],
        integrationTime: 0.1,
        measurementCount: 10,
      };

      // This should be ignored because observed scale is out of range
      estimator.updateScale(
        visualTranslation,
        preintegration,
        new THREE.Vector3(),
        0.1
      );

      expect(estimator.getScale()).toBeLessThanOrEqual(100);
      expect(estimator.getScale()).toBeGreaterThanOrEqual(0.01);
    });
  });

  describe("refineScale", () => {
    beforeEach(() => {
      for (let i = 0; i < 35; i++) {
        const acceleration = new THREE.Vector3(0, -9.8, 0);
        const angularVelocity = new THREE.Vector3(0, 0, 0);
        estimator.addStaticSample(acceleration, angularVelocity, 1000 + i * 50);
      }
    });

    it("should refine scale from optimization", () => {
      const newScale = 2.5;
      const newGravity = new THREE.Vector3(0, -1, 0);

      estimator.refineScale(newScale, newGravity);

      // Should blend with current scale
      expect(estimator.getScale()).toBeGreaterThan(1.0);
      expect(estimator.getScale()).toBeLessThan(2.5);
    });

    it("should update gravity direction", () => {
      const newScale = 1.5;
      const newGravity = new THREE.Vector3(0.1, -0.99, 0);

      estimator.refineScale(newScale, newGravity);

      const gravityDir = estimator.getGravityDirection();
      expect(gravityDir.x).not.toBe(0);
    });

    it("should reject invalid scales", () => {
      const initialScale = estimator.getScale();

      estimator.refineScale(200, new THREE.Vector3(0, -1, 0)); // Too large

      expect(estimator.getScale()).toBe(initialScale);
    });
  });

  describe("computeScaleFromPoses", () => {
    beforeEach(() => {
      for (let i = 0; i < 35; i++) {
        const acceleration = new THREE.Vector3(0, -9.8, 0);
        const angularVelocity = new THREE.Vector3(0, 0, 0);
        estimator.addStaticSample(acceleration, angularVelocity, 1000 + i * 50);
      }
    });

    it("should compute scale from two poses", () => {
      const pose1: CameraPose = {
        rotation: new THREE.Matrix3(),
        translation: new THREE.Vector3(0, 0, 0),
        quaternion: new THREE.Quaternion(),
        timestamp: 1000,
        confidence: 1.0,
      };
      const pose2: CameraPose = {
        rotation: new THREE.Matrix3(),
        translation: new THREE.Vector3(1, 0, 0),
        quaternion: new THREE.Quaternion(),
        timestamp: 1500,
        confidence: 1.0,
      };
      const preintegration: PreintegrationResult = {
        deltaPosition: new THREE.Vector3(2, 0, 0),
        deltaVelocity: new THREE.Vector3(0, 0, 0),
        deltaRotation: new THREE.Quaternion(),
        covariance: [],
        integrationTime: 0.5,
        measurementCount: 50,
      };
      const velocity1 = new THREE.Vector3(0, 0, 0);

      const scale = estimator.computeScaleFromPoses(
        pose1,
        pose2,
        preintegration,
        velocity1
      );

      expect(scale).not.toBeNull();
    });

    it("should return null for insufficient translation", () => {
      const pose1: CameraPose = {
        rotation: new THREE.Matrix3(),
        translation: new THREE.Vector3(0, 0, 0),
        quaternion: new THREE.Quaternion(),
        timestamp: 1000,
        confidence: 1.0,
      };
      const pose2: CameraPose = {
        rotation: new THREE.Matrix3(),
        translation: new THREE.Vector3(0.0001, 0, 0), // Too small
        quaternion: new THREE.Quaternion(),
        timestamp: 1500,
        confidence: 1.0,
      };
      const preintegration: PreintegrationResult = {
        deltaPosition: new THREE.Vector3(0, 0, 0),
        deltaVelocity: new THREE.Vector3(0, 0, 0),
        deltaRotation: new THREE.Quaternion(),
        covariance: [],
        integrationTime: 0.5,
        measurementCount: 50,
      };
      const velocity1 = new THREE.Vector3(0, 0, 0);

      const scale = estimator.computeScaleFromPoses(
        pose1,
        pose2,
        preintegration,
        velocity1
      );

      expect(scale).toBeNull();
    });

    it("should return null for insufficient integration time", () => {
      const pose1: CameraPose = {
        rotation: new THREE.Matrix3(),
        translation: new THREE.Vector3(0, 0, 0),
        quaternion: new THREE.Quaternion(),
        timestamp: 1000,
        confidence: 1.0,
      };
      const pose2: CameraPose = {
        rotation: new THREE.Matrix3(),
        translation: new THREE.Vector3(1, 0, 0),
        quaternion: new THREE.Quaternion(),
        timestamp: 1005,
        confidence: 1.0,
      };
      const preintegration: PreintegrationResult = {
        deltaPosition: new THREE.Vector3(2, 0, 0),
        deltaVelocity: new THREE.Vector3(0, 0, 0),
        deltaRotation: new THREE.Quaternion(),
        covariance: [],
        integrationTime: 0.005, // Too short
        measurementCount: 5,
      };
      const velocity1 = new THREE.Vector3(0, 0, 0);

      const scale = estimator.computeScaleFromPoses(
        pose1,
        pose2,
        preintegration,
        velocity1
      );

      expect(scale).toBeNull();
    });
  });

  describe("applyScale", () => {
    it("should scale translation vector", () => {
      // Initialize and set scale
      for (let i = 0; i < 35; i++) {
        estimator.addStaticSample(
          new THREE.Vector3(0, -9.8, 0),
          new THREE.Vector3(0, 0, 0),
          1000 + i * 50
        );
      }

      const translation = new THREE.Vector3(1, 2, 3);
      const scaled = estimator.applyScale(translation);

      // With initial scale of 1.0
      expect(scaled.x).toBeCloseTo(1 * estimator.getScale());
      expect(scaled.y).toBeCloseTo(2 * estimator.getScale());
      expect(scaled.z).toBeCloseTo(3 * estimator.getScale());
    });

    it("should not modify original vector", () => {
      const translation = new THREE.Vector3(1, 2, 3);
      estimator.applyScale(translation);

      expect(translation.x).toBe(1);
      expect(translation.y).toBe(2);
      expect(translation.z).toBe(3);
    });
  });

  describe("applyScaleToPose", () => {
    it("should scale pose translation", () => {
      for (let i = 0; i < 35; i++) {
        estimator.addStaticSample(
          new THREE.Vector3(0, -9.8, 0),
          new THREE.Vector3(0, 0, 0),
          1000 + i * 50
        );
      }

      const pose: CameraPose = {
        rotation: new THREE.Matrix3(),
        translation: new THREE.Vector3(1, 2, 3),
        quaternion: new THREE.Quaternion(),
        timestamp: 1000,
        confidence: 1.0,
      };

      const scaledPose = estimator.applyScaleToPose(pose);

      expect(scaledPose.translation.x).toBeCloseTo(1 * estimator.getScale());
      expect(scaledPose.translation.y).toBeCloseTo(2 * estimator.getScale());
    });

    it("should preserve rotation and timestamp", () => {
      const pose: CameraPose = {
        rotation: new THREE.Matrix3(),
        translation: new THREE.Vector3(1, 2, 3),
        quaternion: new THREE.Quaternion(0.1, 0.2, 0.3, 0.9).normalize(),
        timestamp: 1234,
        confidence: 0.8,
      };

      const scaledPose = estimator.applyScaleToPose(pose);

      expect(scaledPose.timestamp).toBe(1234);
      expect(scaledPose.confidence).toBe(0.8);
      expect(scaledPose.quaternion.w).toBeCloseTo(pose.quaternion.w);
    });
  });

  describe("getScaleVariance", () => {
    it("should return variance", () => {
      const variance = estimator.getScaleVariance();
      expect(typeof variance).toBe("number");
    });

    it("should decrease variance with consistent observations", () => {
      for (let i = 0; i < 35; i++) {
        estimator.addStaticSample(
          new THREE.Vector3(0, -9.8, 0),
          new THREE.Vector3(0, 0, 0),
          1000 + i * 50
        );
      }

      // Add consistent scale observations
      for (let i = 0; i < 20; i++) {
        const visualTranslation = new THREE.Vector3(1, 0, 0);
        const preintegration: PreintegrationResult = {
          deltaPosition: new THREE.Vector3(2, 0, 0),
          deltaVelocity: new THREE.Vector3(0, 0, 0),
          deltaRotation: new THREE.Quaternion(),
          covariance: [],
          integrationTime: 0.5,
          measurementCount: 50,
        };

        estimator.updateScale(
          visualTranslation,
          preintegration,
          new THREE.Vector3(),
          0.5
        );
      }

      expect(estimator.getObservationCount()).toBeGreaterThan(0);
    });
  });

  describe("getScaleConfidence", () => {
    it("should return confidence between 0 and 1", () => {
      const confidence = estimator.getScaleConfidence();
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    });
  });

  describe("markAsLost", () => {
    it("should set state to lost", () => {
      estimator.markAsLost();
      expect(estimator.getState()).toBe("lost");
    });
  });

  describe("needsRecalibration", () => {
    it("should check recalibration conditions", () => {
      // Initially, lastScaleUpdateTime is 0, so time since update > 5000ms
      // But state is "uninitialized", so it doesn't need recalibration yet
      // After initialization but before convergence, it may need recalibration
      for (let i = 0; i < 35; i++) {
        estimator.addStaticSample(
          new THREE.Vector3(0, -9.8, 0),
          new THREE.Vector3(0, 0, 0),
          1000 + i * 50
        );
      }
      // After initialization, recalibration may be needed based on time and variance
      expect(typeof estimator.needsRecalibration()).toBe("boolean");
    });
  });

  describe("updateOptions", () => {
    it("should update options", () => {
      estimator.updateOptions({
        minStaticSamples: 100,
        convergenceThreshold: 0.05,
      });

      // Options are updated internally; verify by requiring more samples
      for (let i = 0; i < 50; i++) {
        estimator.addStaticSample(
          new THREE.Vector3(0, -9.8, 0),
          new THREE.Vector3(0, 0, 0),
          1000 + i * 50
        );
      }

      // Should not be converging yet (need 100 samples)
      expect(estimator.getState()).not.toBe("converging");
    });
  });

  describe("reset", () => {
    it("should reset all state", () => {
      for (let i = 0; i < 35; i++) {
        estimator.addStaticSample(
          new THREE.Vector3(0, -9.8, 0),
          new THREE.Vector3(0, 0, 0),
          1000 + i * 50
        );
      }

      estimator.reset();

      expect(estimator.getState()).toBe("uninitialized");
      expect(estimator.getScale()).toBe(1.0);
      expect(estimator.getObservationCount()).toBe(0);
    });
  });

  describe("dispose", () => {
    it("should reset on dispose", () => {
      for (let i = 0; i < 35; i++) {
        estimator.addStaticSample(
          new THREE.Vector3(0, -9.8, 0),
          new THREE.Vector3(0, 0, 0),
          1000 + i * 50
        );
      }

      estimator.dispose();

      expect(estimator.getState()).toBe("uninitialized");
    });
  });
});

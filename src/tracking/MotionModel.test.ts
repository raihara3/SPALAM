/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { MotionModel } from "./MotionModel";
import type { CameraPose, CameraIntrinsics } from "../types/Pose";
import type { Feature } from "../types/Feature";

describe("MotionModel", () => {
  let motionModel: MotionModel;

  const createPose = (
    translation: THREE.Vector3,
    quaternion: THREE.Quaternion,
    timestamp: number
  ): CameraPose => {
    const rotation = new THREE.Matrix3();
    const rotationMatrix4 = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
    rotation.setFromMatrix4(rotationMatrix4);

    return {
      rotation,
      translation,
      quaternion,
      timestamp,
      confidence: 1.0,
    };
  };

  const defaultIntrinsics: CameraIntrinsics = {
    fx: 500,
    fy: 500,
    cx: 320,
    cy: 240,
    width: 640,
    height: 480,
  };

  beforeEach(() => {
    motionModel = new MotionModel();
  });

  describe("constructor", () => {
    it("should create with default options", () => {
      expect(motionModel).toBeDefined();
      expect(motionModel.isInitialized()).toBe(false);
      expect(motionModel.isMoving()).toBe(false);
    });

    it("should create with custom options", () => {
      const customModel = new MotionModel({
        velocityDecay: 0.9,
        maxVelocity: 100,
        searchRegionScale: 3.0,
        minVelocityThreshold: 0.5,
        maxPredictionTimeMs: 200,
      });

      expect(customModel).toBeDefined();
    });
  });

  describe("update", () => {
    it("should not initialize velocity with single pose", () => {
      const pose = createPose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion(),
        0
      );

      motionModel.update(pose);

      expect(motionModel.isInitialized()).toBe(false);
    });

    it("should initialize velocity after two poses", () => {
      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion(),
        0
      );
      const pose2 = createPose(
        new THREE.Vector3(1, 0, 0),
        new THREE.Quaternion(),
        16.67
      );

      motionModel.update(pose1);
      motionModel.update(pose2);

      expect(motionModel.isInitialized()).toBe(true);
    });

    it("should compute linear velocity correctly", () => {
      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion(),
        0
      );
      const pose2 = createPose(
        new THREE.Vector3(10, 0, 0),
        new THREE.Quaternion(),
        100
      );

      motionModel.update(pose1);
      motionModel.update(pose2);

      const velocity = motionModel.getLinearVelocity();
      expect(velocity.x).toBeCloseTo(0.1, 2); // 10 / 100 = 0.1
      expect(velocity.y).toBeCloseTo(0, 2);
      expect(velocity.z).toBeCloseTo(0, 2);
    });

    it("should clamp velocity to maxVelocity", () => {
      const maxVelocity = 10;
      const model = new MotionModel({ maxVelocity });

      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion(),
        0
      );
      const pose2 = createPose(
        new THREE.Vector3(1000, 0, 0), // Very large movement
        new THREE.Quaternion(),
        1
      );

      model.update(pose1);
      model.update(pose2);

      const velocity = model.getLinearVelocity();
      expect(velocity.length()).toBeLessThanOrEqual(maxVelocity + 0.01);
    });

    it("should detect motion when velocity exceeds threshold", () => {
      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion(),
        0
      );
      const pose2 = createPose(
        new THREE.Vector3(20, 0, 0), // Large movement to exceed threshold
        new THREE.Quaternion(),
        100
      );

      motionModel.update(pose1);
      motionModel.update(pose2);

      expect(motionModel.isMoving()).toBe(true);
    });

    it("should track angular velocity", () => {
      const quaternion1 = new THREE.Quaternion();
      const quaternion2 = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        Math.PI / 4
      );

      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        quaternion1,
        0
      );
      const pose2 = createPose(
        new THREE.Vector3(0, 0, 0),
        quaternion2,
        100
      );

      motionModel.update(pose1);
      motionModel.update(pose2);

      const angularVelocity = motionModel.getAngularVelocity();
      expect(angularVelocity).not.toEqual(new THREE.Quaternion());
    });

    it("should handle same timestamp gracefully", () => {
      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion(),
        100
      );
      const pose2 = createPose(
        new THREE.Vector3(1, 0, 0),
        new THREE.Quaternion(),
        100 // Same timestamp
      );

      motionModel.update(pose1);
      motionModel.update(pose2);

      // Should not crash, velocity should remain uninitialized
      expect(motionModel.isInitialized()).toBe(false);
    });

    it("should smooth velocity updates over time", () => {
      const model = new MotionModel({ velocityDecay: 0.5 });

      const poses = [
        createPose(new THREE.Vector3(0, 0, 0), new THREE.Quaternion(), 0),
        createPose(new THREE.Vector3(10, 0, 0), new THREE.Quaternion(), 100),
        createPose(new THREE.Vector3(10, 0, 0), new THREE.Quaternion(), 200), // Stopped
      ];

      poses.forEach((pose) => model.update(pose));

      const velocity = model.getLinearVelocity();
      // Velocity should be smoothed (not exactly 0 due to decay)
      expect(velocity.x).toBeGreaterThan(0);
      expect(velocity.x).toBeLessThan(0.1);
    });
  });

  describe("predictPose", () => {
    it("should return null for uninitialized model", () => {
      const prediction = motionModel.predictPose(100);
      expect(prediction).toBeNull();
    });

    it("should return previous pose for short time delta", () => {
      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion(),
        0
      );
      const pose2 = createPose(
        new THREE.Vector3(1, 0, 0),
        new THREE.Quaternion(),
        100
      );

      motionModel.update(pose1);
      motionModel.update(pose2);

      const prediction = motionModel.predictPose(100); // Same as last timestamp
      expect(prediction?.translation.x).toBeCloseTo(1, 1);
    });

    it("should predict future position based on velocity", () => {
      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion(),
        0
      );
      const pose2 = createPose(
        new THREE.Vector3(10, 0, 0),
        new THREE.Quaternion(),
        100
      );

      motionModel.update(pose1);
      motionModel.update(pose2);

      const prediction = motionModel.predictPose(200);
      // Expect position to be greater than 10 (continued movement)
      expect(prediction?.translation.x).toBeGreaterThan(10);
    });

    it("should limit prediction time horizon", () => {
      const model = new MotionModel({ maxPredictionTimeMs: 50 });

      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion(),
        0
      );
      const pose2 = createPose(
        new THREE.Vector3(10, 0, 0),
        new THREE.Quaternion(),
        100
      );

      model.update(pose1);
      model.update(pose2);

      const shortPrediction = model.predictPose(150);
      const longPrediction = model.predictPose(1000);

      // Long prediction should be clamped
      expect(
        Math.abs(shortPrediction!.translation.x - longPrediction!.translation.x)
      ).toBeLessThan(1);
    });

    it("should decay confidence over time", () => {
      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion(),
        0
      );
      const pose2 = createPose(
        new THREE.Vector3(10, 0, 0),
        new THREE.Quaternion(),
        100
      );

      motionModel.update(pose1);
      motionModel.update(pose2);

      const nearPrediction = motionModel.predictPose(110);
      const farPrediction = motionModel.predictPose(200);

      expect(farPrediction!.confidence).toBeLessThan(nearPrediction!.confidence);
    });
  });

  describe("predictFeaturePosition", () => {
    it("should return default prediction for uninitialized model", () => {
      const feature: Feature = {
        id: "test",
        x: 320,
        y: 240,
        trackingCount: 1,
      };

      const prediction = motionModel.predictFeaturePosition(feature, defaultIntrinsics);

      expect(prediction.predictedPosition.x).toBe(320);
      expect(prediction.predictedPosition.y).toBe(240);
      expect(prediction.confidence).toBe(0.5);
    });

    it("should predict feature movement based on camera motion", () => {
      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion(),
        0
      );
      const pose2 = createPose(
        new THREE.Vector3(20, 0, 0), // Large movement to exceed threshold
        new THREE.Quaternion(),
        100
      );

      motionModel.update(pose1);
      motionModel.update(pose2);

      const feature: Feature = {
        id: "test",
        x: 320,
        y: 240,
        trackingCount: 1,
      };

      const prediction = motionModel.predictFeaturePosition(feature, defaultIntrinsics, 100);

      // Feature should move in predicted direction
      expect(prediction.predictedPosition.x).not.toBe(320);
    });

    it("should provide search region around predicted position", () => {
      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion(),
        0
      );
      const pose2 = createPose(
        new THREE.Vector3(5, 0, 0),
        new THREE.Quaternion(),
        100
      );

      motionModel.update(pose1);
      motionModel.update(pose2);

      const feature: Feature = {
        id: "test",
        x: 320,
        y: 240,
        trackingCount: 1,
      };

      const prediction = motionModel.predictFeaturePosition(feature, defaultIntrinsics);
      const { searchRegion, predictedPosition } = prediction;

      expect(searchRegion.minX).toBeLessThan(predictedPosition.x);
      expect(searchRegion.maxX).toBeGreaterThan(predictedPosition.x);
      expect(searchRegion.minY).toBeLessThan(predictedPosition.y);
      expect(searchRegion.maxY).toBeGreaterThan(predictedPosition.y);
    });

    it("should clamp search region to image bounds", () => {
      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion(),
        0
      );
      const pose2 = createPose(
        new THREE.Vector3(100, 0, 0), // Large movement
        new THREE.Quaternion(),
        100
      );

      motionModel.update(pose1);
      motionModel.update(pose2);

      const feature: Feature = {
        id: "test",
        x: 10, // Near edge
        y: 10,
        trackingCount: 1,
      };

      const prediction = motionModel.predictFeaturePosition(feature, defaultIntrinsics);

      expect(prediction.searchRegion.minX).toBeGreaterThanOrEqual(0);
      expect(prediction.searchRegion.minY).toBeGreaterThanOrEqual(0);
      expect(prediction.searchRegion.maxX).toBeLessThanOrEqual(defaultIntrinsics.width!);
      expect(prediction.searchRegion.maxY).toBeLessThanOrEqual(defaultIntrinsics.height!);
    });

    it("should handle rotation-only motion", () => {
      const quaternion1 = new THREE.Quaternion();
      const quaternion2 = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        0.1
      );

      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        quaternion1,
        0
      );
      const pose2 = createPose(
        new THREE.Vector3(0, 0, 0),
        quaternion2,
        100
      );

      motionModel.update(pose1);
      motionModel.update(pose2);

      const feature: Feature = {
        id: "test",
        x: 320,
        y: 240,
        trackingCount: 1,
      };

      const prediction = motionModel.predictFeaturePosition(feature, defaultIntrinsics, 100);

      // Should still have valid prediction even with minimal linear velocity
      expect(prediction.searchRegion).toBeDefined();
    });
  });

  describe("getPredictedSearchRegions", () => {
    it("should return empty map for empty features", () => {
      const predictions = motionModel.getPredictedSearchRegions([], defaultIntrinsics);
      expect(predictions.size).toBe(0);
    });

    it("should skip features without id", () => {
      const features: Feature[] = [
        { id: "test1", x: 100, y: 100, trackingCount: 1 },
        { x: 200, y: 200, trackingCount: 1 } as Feature, // No id
        { id: "test2", x: 300, y: 300, trackingCount: 1 },
      ];

      const predictions = motionModel.getPredictedSearchRegions(features, defaultIntrinsics);

      expect(predictions.size).toBe(2);
      expect(predictions.has("test1")).toBe(true);
      expect(predictions.has("test2")).toBe(true);
    });

    it("should return prediction for each feature", () => {
      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion(),
        0
      );
      const pose2 = createPose(
        new THREE.Vector3(5, 0, 0),
        new THREE.Quaternion(),
        100
      );

      motionModel.update(pose1);
      motionModel.update(pose2);

      const features: Feature[] = [
        { id: "f1", x: 100, y: 100, trackingCount: 1 },
        { id: "f2", x: 200, y: 200, trackingCount: 1 },
        { id: "f3", x: 300, y: 300, trackingCount: 1 },
      ];

      const predictions = motionModel.getPredictedSearchRegions(features, defaultIntrinsics);

      expect(predictions.size).toBe(3);
      predictions.forEach((prediction, _id) => {
        expect(prediction.predictedPosition).toBeDefined();
        expect(prediction.searchRegion).toBeDefined();
        expect(prediction.confidence).toBeGreaterThan(0);
      });
    });
  });

  describe("getters", () => {
    it("should return velocity magnitude", () => {
      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion(),
        0
      );
      const pose2 = createPose(
        new THREE.Vector3(3, 4, 0), // Magnitude = 5
        new THREE.Quaternion(),
        100
      );

      motionModel.update(pose1);
      motionModel.update(pose2);

      const magnitude = motionModel.getVelocityMagnitude();
      expect(magnitude).toBeGreaterThan(0);
    });
  });

  describe("updateOptions", () => {
    it("should update velocityDecay", () => {
      motionModel.updateOptions({ velocityDecay: 0.8 });

      // Create motion
      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion(),
        0
      );
      const pose2 = createPose(
        new THREE.Vector3(10, 0, 0),
        new THREE.Quaternion(),
        100
      );

      motionModel.update(pose1);
      motionModel.update(pose2);

      // Verify model works with updated options
      expect(motionModel.isInitialized()).toBe(true);
    });

    it("should update all options", () => {
      motionModel.updateOptions({
        velocityDecay: 0.8,
        maxVelocity: 100,
        searchRegionScale: 3.0,
        minVelocityThreshold: 0.5,
        maxPredictionTimeMs: 200,
      });

      // Model should still work
      expect(motionModel).toBeDefined();
    });
  });

  describe("reset", () => {
    it("should reset all state", () => {
      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion(),
        0
      );
      const pose2 = createPose(
        new THREE.Vector3(10, 0, 0),
        new THREE.Quaternion(),
        100
      );

      motionModel.update(pose1);
      motionModel.update(pose2);
      expect(motionModel.isInitialized()).toBe(true);

      motionModel.reset();

      expect(motionModel.isInitialized()).toBe(false);
      expect(motionModel.isMoving()).toBe(false);
      expect(motionModel.getVelocityMagnitude()).toBe(0);
    });
  });

  describe("dispose", () => {
    it("should reset state on dispose", () => {
      const pose1 = createPose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion(),
        0
      );
      const pose2 = createPose(
        new THREE.Vector3(10, 0, 0),
        new THREE.Quaternion(),
        100
      );

      motionModel.update(pose1);
      motionModel.update(pose2);

      motionModel.dispose();

      expect(motionModel.isInitialized()).toBe(false);
    });
  });
});

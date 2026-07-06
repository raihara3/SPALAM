/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  extrinsicsToCameraPose,
  pnpResultToCameraPose,
} from "./cameraPoseConversion";
import type { PnPResult } from "../types/Pose";

describe("cameraPoseConversion", () => {
  describe("extrinsicsToCameraPose", () => {
    it("should map identity extrinsics to the origin", () => {
      const pose = extrinsicsToCameraPose(
        new THREE.Matrix3().identity(),
        new THREE.Vector3(0, 0, 0),
        100,
        1.0
      );

      expect(pose.translation.length()).toBeCloseTo(0, 10);
      expect(pose.quaternion.w).toBeCloseTo(1, 10);
      expect(pose.timestamp).toBe(100);
      expect(pose.confidence).toBe(1.0);
    });

    it("should negate pure translations", () => {
      // x_cam = x_world + t means the camera sits at -t in world coordinates
      const pose = extrinsicsToCameraPose(
        new THREE.Matrix3().identity(),
        new THREE.Vector3(1, 2, 3),
        0,
        1.0
      );

      expect(pose.translation.x).toBeCloseTo(-1, 10);
      expect(pose.translation.y).toBeCloseTo(-2, 10);
      expect(pose.translation.z).toBeCloseTo(-3, 10);
    });

    it("should compute the camera center as -R^T * t", () => {
      // 90 degrees rotation around Y: R maps world x -> camera -z
      const rotation4 = new THREE.Matrix4().makeRotationY(Math.PI / 2);
      const rotation = new THREE.Matrix3().setFromMatrix4(rotation4);
      const translation = new THREE.Vector3(1, 0, 0);

      const pose = extrinsicsToCameraPose(rotation, translation, 0, 1.0);

      const expectedCenter = translation
        .clone()
        .applyMatrix3(rotation.clone().transpose())
        .negate();
      expect(pose.translation.x).toBeCloseTo(expectedCenter.x, 10);
      expect(pose.translation.y).toBeCloseTo(expectedCenter.y, 10);
      expect(pose.translation.z).toBeCloseTo(expectedCenter.z, 10);
    });

    it("should round-trip a world point through the extrinsics", () => {
      const rotation4 = new THREE.Matrix4().makeRotationAxis(
        new THREE.Vector3(1, 1, 0).normalize(),
        0.7
      );
      const extrinsicRotation = new THREE.Matrix3().setFromMatrix4(rotation4);
      const extrinsicTranslation = new THREE.Vector3(0.3, -0.2, 1.5);

      const pose = extrinsicsToCameraPose(
        extrinsicRotation,
        extrinsicTranslation,
        0,
        1.0
      );

      // x_cam = R * x_world + t must equal R_wc^T * (x_world - C)
      const worldPoint = new THREE.Vector3(2, -1, 4);
      const viaExtrinsics = worldPoint
        .clone()
        .applyMatrix3(extrinsicRotation)
        .add(extrinsicTranslation);
      const viaCameraPose = worldPoint
        .clone()
        .sub(pose.translation)
        .applyMatrix3(pose.rotation.clone().transpose());

      expect(viaCameraPose.x).toBeCloseTo(viaExtrinsics.x, 10);
      expect(viaCameraPose.y).toBeCloseTo(viaExtrinsics.y, 10);
      expect(viaCameraPose.z).toBeCloseTo(viaExtrinsics.z, 10);
    });

    it("should produce a quaternion matching the rotation matrix", () => {
      const rotation4 = new THREE.Matrix4().makeRotationZ(0.5);
      const rotation = new THREE.Matrix3().setFromMatrix4(rotation4);

      const pose = extrinsicsToCameraPose(
        rotation,
        new THREE.Vector3(0, 0, 0),
        0,
        1.0
      );

      const quaternionMatrix = new THREE.Matrix4().makeRotationFromQuaternion(
        pose.quaternion
      );
      const rotationMatrix = new THREE.Matrix4().setFromMatrix3(pose.rotation);
      quaternionMatrix.elements.forEach((element, index) => {
        expect(element).toBeCloseTo(rotationMatrix.elements[index], 10);
      });
    });
  });

  describe("pnpResultToCameraPose", () => {
    it("should convert a PnP result using its rotation matrix and translation", () => {
      const pnpResult: PnPResult = {
        rotationVector: new THREE.Vector3(0, 0, 0),
        rotationMatrix: new THREE.Matrix3().identity(),
        translation: new THREE.Vector3(0, 0, 2),
        inliers: [0, 1, 2, 3],
        reprojectionError: 0.5,
        isValid: true,
      };

      const pose = pnpResultToCameraPose(pnpResult, 42, 0.8);

      expect(pose.translation.z).toBeCloseTo(-2, 10);
      expect(pose.timestamp).toBe(42);
      expect(pose.confidence).toBe(0.8);
    });
  });
});

/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { TwoViewTriangulator } from "./TwoViewTriangulator";
import type { CameraPose, CameraIntrinsics } from "../types/Pose";

describe("TwoViewTriangulator", () => {
  const intrinsics: CameraIntrinsics = {
    fx: 500,
    fy: 500,
    cx: 320,
    cy: 240,
    width: 640,
    height: 480,
  };

  const createPose = (
    center: THREE.Vector3,
    rotation: THREE.Matrix3 = new THREE.Matrix3().identity()
  ): CameraPose => ({
    rotation,
    translation: center,
    quaternion: new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().setFromMatrix3(rotation)
    ),
    timestamp: 0,
    confidence: 1,
  });

  /** Project a world point into a camera (camera-to-world pose, OpenCV pinhole) */
  const project = (
    point: THREE.Vector3,
    pose: CameraPose
  ): { x: number; y: number } => {
    const cameraPoint = point
      .clone()
      .sub(pose.translation)
      .applyMatrix3(pose.rotation.clone().transpose());
    return {
      x: intrinsics.fx * (cameraPoint.x / cameraPoint.z) + intrinsics.cx,
      y: intrinsics.fy * (cameraPoint.y / cameraPoint.z) + intrinsics.cy,
    };
  };

  const groundTruthPoints = [
    new THREE.Vector3(0.1, -0.2, 2.0),
    new THREE.Vector3(-0.3, 0.1, 2.5),
    new THREE.Vector3(0.4, 0.3, 1.8),
    new THREE.Vector3(0.0, 0.0, 3.0),
  ];

  it("should recover ground-truth points from two translated views", () => {
    const triangulator = new TwoViewTriangulator(intrinsics);
    const pose1 = createPose(new THREE.Vector3(0, 0, 0));
    const pose2 = createPose(new THREE.Vector3(0.3, 0, 0));

    const points1 = groundTruthPoints.map((point) => project(point, pose1));
    const points2 = groundTruthPoints.map((point) => project(point, pose2));

    const results = triangulator.triangulate(
      points1,
      points2,
      pose1,
      pose2,
      groundTruthPoints.map((_, i) => `p${i}`)
    );

    results.forEach((result, i) => {
      expect(result.isValid).toBe(true);
      expect(result.id).toBe(`p${i}`);
      expect(result.point3D.x).toBeCloseTo(groundTruthPoints[i].x, 6);
      expect(result.point3D.y).toBeCloseTo(groundTruthPoints[i].y, 6);
      expect(result.point3D.z).toBeCloseTo(groundTruthPoints[i].z, 6);
      expect(result.reprojectionError).toBeLessThan(0.01);
    });
  });

  it("should recover points under camera rotation", () => {
    const triangulator = new TwoViewTriangulator(intrinsics);
    const rotation = new THREE.Matrix3().setFromMatrix4(
      new THREE.Matrix4().makeRotationY(0.1)
    );
    const pose1 = createPose(new THREE.Vector3(0, 0, 0));
    const pose2 = createPose(new THREE.Vector3(0.2, 0.05, 0), rotation);

    const points1 = groundTruthPoints.map((point) => project(point, pose1));
    const points2 = groundTruthPoints.map((point) => project(point, pose2));

    const results = triangulator.triangulate(points1, points2, pose1, pose2);

    results.forEach((result, i) => {
      expect(result.isValid).toBe(true);
      expect(result.point3D.distanceTo(groundTruthPoints[i])).toBeLessThan(
        1e-5
      );
    });
  });

  it("should reject zero-baseline (pure rotation) configurations", () => {
    const triangulator = new TwoViewTriangulator(intrinsics);
    const rotation = new THREE.Matrix3().setFromMatrix4(
      new THREE.Matrix4().makeRotationY(0.2)
    );
    const pose1 = createPose(new THREE.Vector3(0, 0, 0));
    const pose2 = createPose(new THREE.Vector3(0, 0, 0), rotation);

    const points1 = groundTruthPoints.map((point) => project(point, pose1));
    const points2 = groundTruthPoints.map((point) => project(point, pose2));

    const results = triangulator.triangulate(points1, points2, pose1, pose2);

    // Zero baseline means zero parallax; the parallax gate must reject
    results.forEach((result) => {
      expect(result.isValid).toBe(false);
    });
  });

  it("should reject points with excessive reprojection error", () => {
    const triangulator = new TwoViewTriangulator(intrinsics);
    const pose1 = createPose(new THREE.Vector3(0, 0, 0));
    const pose2 = createPose(new THREE.Vector3(0.3, 0, 0));

    const points1 = groundTruthPoints.map((point) => project(point, pose1));
    const points2 = groundTruthPoints.map((point, i) => {
      const projected = project(point, pose2);
      // Corrupt one correspondence far beyond the 4px gate
      return i === 0
        ? { x: projected.x + 40, y: projected.y - 25 }
        : projected;
    });

    const results = triangulator.triangulate(points1, points2, pose1, pose2);

    expect(results[0].isValid).toBe(false);
    expect(results[1].isValid).toBe(true);
  });

  it("should reject points outside the depth bounds", () => {
    const triangulator = new TwoViewTriangulator(intrinsics, { maxDepth: 2.2 });
    const pose1 = createPose(new THREE.Vector3(0, 0, 0));
    const pose2 = createPose(new THREE.Vector3(0.3, 0, 0));

    const points1 = groundTruthPoints.map((point) => project(point, pose1));
    const points2 = groundTruthPoints.map((point) => project(point, pose2));

    const results = triangulator.triangulate(points1, points2, pose1, pose2);

    // Points at z=2.5 and z=3.0 exceed maxDepth 2.2
    expect(results[0].isValid).toBe(true); // z=2.0
    expect(results[1].isValid).toBe(false); // z=2.5
    expect(results[3].isValid).toBe(false); // z=3.0
  });

  it("should handle empty and mismatched input", () => {
    const triangulator = new TwoViewTriangulator(intrinsics);
    const pose = createPose(new THREE.Vector3(0, 0, 0));

    expect(triangulator.triangulate([], [], pose, pose)).toEqual([]);
    expect(
      triangulator.triangulate([{ x: 1, y: 1 }], [], pose, pose)
    ).toEqual([]);
  });
});

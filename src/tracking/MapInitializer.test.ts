/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { MapInitializer } from "./MapInitializer";
import type { Feature } from "../types/Feature";
import type {
  CameraIntrinsics,
  EssentialMatrixResult,
  PoseRecoveryResult,
  TriangulationResult,
} from "../types/Pose";

describe("MapInitializer", () => {
  const intrinsics: CameraIntrinsics = {
    fx: 500,
    fy: 500,
    cx: 320,
    cy: 240,
    width: 640,
    height: 480,
  };

  const createFeatures = (
    count: number,
    offsetX: number = 0
  ): Feature[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `feature_${i}`,
      x: 100 + (i % 10) * 40 + offsetX,
      y: 100 + Math.floor(i / 10) * 40,
      trackingCount: 20,
    }));

  const createEssentialResult = (
    count: number,
    inlierCount: number
  ): EssentialMatrixResult => ({
    essentialMatrix: new THREE.Matrix3().identity(),
    inlierMask: Array.from({ length: count }, (_, i) => i < inlierCount),
    inlierCount,
    isValid: true,
  });

  const createRecoveryResult = (inFrontCount: number): PoseRecoveryResult => ({
    rotation: new THREE.Matrix3().identity(),
    translation: new THREE.Vector3(1, 0, 0),
    inFrontCount,
    isValid: true,
  });

  const createTriangulationResults = (
    ids: string[],
    parallaxDegrees: number,
    depth: number = 2
  ): TriangulationResult[] =>
    ids.map((id, i) => ({
      point3D: new THREE.Vector3(i * 0.1, 0, depth),
      reprojectionError: 0.5,
      parallaxAngle: THREE.MathUtils.degToRad(parallaxDegrees),
      isValid: true,
      id,
    }));

  const createInitializer = (overrides?: {
    essential?: EssentialMatrixResult | null;
    recovery?: PoseRecoveryResult | null;
    triangulation?: (ids: string[]) => TriangulationResult[];
  }) => {
    const poseEstimator = {
      findEssentialMatrix: vi.fn(
        (points1: Array<{ x: number; y: number }>) =>
          overrides?.essential !== undefined
            ? overrides.essential
            : createEssentialResult(points1.length, points1.length)
      ),
      recoverPose: vi.fn(() =>
        overrides?.recovery !== undefined
          ? overrides.recovery
          : createRecoveryResult(100)
      ),
    };
    const triangulator = {
      triangulate: vi.fn(
        (
          _points1: Array<{ x: number; y: number }>,
          _points2: Array<{ x: number; y: number }>,
          _pose1: unknown,
          _pose2: unknown,
          ids?: string[]
        ) =>
          overrides?.triangulation
            ? overrides.triangulation(ids ?? [])
            : createTriangulationResults(ids ?? [], 3)
      ),
    };

    const initializer = new MapInitializer(
      { poseEstimator, triangulator, intrinsics },
      { minCorrespondences: 50, minTriangulatedPoints: 30 }
    );
    return { initializer, poseEstimator, triangulator };
  };

  it("should fail without a reference frame", () => {
    const { initializer } = createInitializer();

    const attempt = initializer.attemptInitialization(createFeatures(60), 100);

    expect(attempt.success).toBe(false);
    expect(attempt.failureReason).toBe("no-reference");
  });

  it("should fail with insufficient correspondences", () => {
    const { initializer } = createInitializer();
    initializer.setReferenceFrame(createFeatures(30), 0);

    const attempt = initializer.attemptInitialization(
      createFeatures(30, 50),
      100
    );

    expect(attempt.success).toBe(false);
    expect(attempt.failureReason).toBe("insufficient-correspondences");
    expect(attempt.correspondenceCount).toBe(30);
  });

  it("should fail when the median displacement is too small", () => {
    const { initializer, poseEstimator } = createInitializer();
    initializer.setReferenceFrame(createFeatures(60), 0);

    const attempt = initializer.attemptInitialization(
      createFeatures(60, 5),
      100
    );

    expect(attempt.success).toBe(false);
    expect(attempt.failureReason).toBe("insufficient-displacement");
    expect(poseEstimator.findEssentialMatrix).not.toHaveBeenCalled();
  });

  it("should fail when essential-matrix inlier support is low", () => {
    const { initializer } = createInitializer({
      essential: createEssentialResult(60, 10),
    });
    initializer.setReferenceFrame(createFeatures(60), 0);

    const attempt = initializer.attemptInitialization(
      createFeatures(60, 50),
      100
    );

    expect(attempt.success).toBe(false);
    expect(attempt.failureReason).toBe("essential-matrix-failed");
  });

  it("should fail when the cheirality check rejects the pose", () => {
    const { initializer } = createInitializer({
      recovery: createRecoveryResult(10),
    });
    initializer.setReferenceFrame(createFeatures(60), 0);

    const attempt = initializer.attemptInitialization(
      createFeatures(60, 50),
      100
    );

    expect(attempt.success).toBe(false);
    expect(attempt.failureReason).toBe("pose-recovery-failed");
  });

  it("should fail with too few triangulated points", () => {
    const { initializer } = createInitializer({
      triangulation: (ids) => createTriangulationResults(ids.slice(0, 10), 3),
    });
    initializer.setReferenceFrame(createFeatures(60), 0);

    const attempt = initializer.attemptInitialization(
      createFeatures(60, 50),
      100
    );

    expect(attempt.success).toBe(false);
    expect(attempt.failureReason).toBe("triangulation-failed");
  });

  it("should reject pure rotation via the parallax gate", () => {
    // Large pixel displacement but near-zero triangulated parallax
    const { initializer } = createInitializer({
      triangulation: (ids) => createTriangulationResults(ids, 0.1),
    });
    initializer.setReferenceFrame(createFeatures(60), 0);

    const attempt = initializer.attemptInitialization(
      createFeatures(60, 50),
      100
    );

    expect(attempt.success).toBe(false);
    expect(attempt.failureReason).toBe("insufficient-parallax");
  });

  it("should initialize with poses, landmarks, and unit scale by default", () => {
    const { initializer } = createInitializer();
    initializer.setReferenceFrame(createFeatures(60), 0);

    const attempt = initializer.attemptInitialization(
      createFeatures(60, 50),
      100
    );

    expect(attempt.success).toBe(true);
    const result = attempt.result!;
    expect(result.landmarks).toHaveLength(60);
    expect(result.referencePose.translation.length()).toBe(0);
    // Extrinsics t=(1,0,0) with identity rotation puts the camera at (-1,0,0)
    expect(result.currentPose.translation.x).toBeCloseTo(-1, 10);
    expect(result.scale.scale).toBe(1);
    expect(result.scale.isReliable).toBe(false);
    expect(result.medianParallaxDegrees).toBeCloseTo(3, 5);
  });

  it("should apply the metric scale from depth priors", () => {
    const { initializer } = createInitializer({
      triangulation: (ids) => createTriangulationResults(ids, 3, 2),
    });
    initializer.setReferenceFrame(createFeatures(60), 0);

    // Triangulated depth 2, prior depth 6 => scale 3
    const priors = new Map<string, number>();
    for (let i = 0; i < 60; i++) {
      priors.set(`feature_${i}`, 6);
    }

    const attempt = initializer.attemptInitialization(
      createFeatures(60, 50),
      100,
      priors
    );

    expect(attempt.success).toBe(true);
    const result = attempt.result!;
    expect(result.scale.scale).toBe(3);
    expect(result.scale.isReliable).toBe(true);
    expect(result.landmarks[0].position.z).toBeCloseTo(6, 10);
    expect(result.currentPose.translation.x).toBeCloseTo(-3, 10);
  });

  it("should clear the reference frame on reset", () => {
    const { initializer } = createInitializer();
    initializer.setReferenceFrame(createFeatures(60), 0);

    initializer.reset();

    expect(initializer.hasReferenceFrame()).toBe(false);
  });
});

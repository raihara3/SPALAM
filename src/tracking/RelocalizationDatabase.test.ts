/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { RelocalizationDatabase } from "./RelocalizationDatabase";
import type { CameraPose, FeatureMatch, PnPResult } from "../types/Pose";

describe("RelocalizationDatabase", () => {
  const createPose = (x: number = 0): CameraPose => ({
    rotation: new THREE.Matrix3().identity(),
    translation: new THREE.Vector3(x, 0, 0),
    quaternion: new THREE.Quaternion(),
    timestamp: 0,
    confidence: 1,
  });

  const createDescriptorMat = (rows: number) =>
    ({ rows, delete: vi.fn() }) as unknown as cv.Mat;

  const createPoints = (count: number) => ({
    points2D: Array.from({ length: count }, (_, i) => ({
      x: i * 10,
      y: i * 5,
    })),
    points3D: Array.from(
      { length: count },
      (_, i) => new THREE.Vector3(i * 0.1, 0, 2)
    ),
  });

  const createMatches = (count: number): FeatureMatch[] =>
    Array.from({ length: count }, (_, i) => ({
      queryIndex: i,
      trainIndex: i,
      distance: 10,
    }));

  const createPnPResult = (
    inlierCount: number,
    reprojectionError: number = 1
  ): PnPResult => ({
    rotationVector: new THREE.Vector3(),
    rotationMatrix: new THREE.Matrix3().identity(),
    translation: new THREE.Vector3(0, 0, 1),
    inliers: Array.from({ length: inlierCount }, (_, i) => i),
    reprojectionError,
    isValid: true,
  });

  const createDatabase = (params?: {
    matchCount?: number;
    pnpResult?: PnPResult | null;
    options?: ConstructorParameters<typeof RelocalizationDatabase>[1];
  }) => {
    const matcher = {
      matchSimple: vi.fn(() => createMatches(params?.matchCount ?? 20)),
    };
    const pnpSolver = {
      solvePnP: vi.fn(() =>
        params?.pnpResult !== undefined ? params.pnpResult : createPnPResult(15)
      ),
    };
    const database = new RelocalizationDatabase(
      { matcher, pnpSolver },
      params?.options
    );
    return { database, matcher, pnpSolver };
  };

  describe("addKeyframe", () => {
    it("should store a keyframe with aligned data", () => {
      const { database } = createDatabase({});
      const { points2D, points3D } = createPoints(20);

      expect(
        database.addKeyframe(createPose(), createDescriptorMat(20), points2D, points3D)
      ).toBe(true);
      expect(database.size()).toBe(1);
    });

    it("should reject and delete descriptors on row misalignment", () => {
      const { database } = createDatabase({});
      const { points2D, points3D } = createPoints(20);
      const descriptors = createDescriptorMat(19);

      expect(
        database.addKeyframe(createPose(), descriptors, points2D, points3D)
      ).toBe(false);
      expect(descriptors.delete).toHaveBeenCalled();
    });

    it("should reject keyframes too close to an existing one", () => {
      const { database } = createDatabase({
        options: { minKeyframeDistance: 0.5 },
      });
      const { points2D, points3D } = createPoints(20);
      database.addKeyframe(createPose(0), createDescriptorMat(20), points2D, points3D);

      const rejected = createDescriptorMat(20);
      expect(
        database.addKeyframe(createPose(0.2), rejected, points2D, points3D)
      ).toBe(false);
      expect(rejected.delete).toHaveBeenCalled();
      expect(database.size()).toBe(1);
    });

    it("should evict the second-oldest keyframe past capacity, pinning the first", () => {
      const { database } = createDatabase({
        options: { maxKeyframes: 2, minKeyframeDistance: 0.1 },
      });
      const { points2D, points3D } = createPoints(20);
      const first = createDescriptorMat(20);
      const second = createDescriptorMat(20);
      database.addKeyframe(createPose(0), first, points2D, points3D);
      database.addKeyframe(createPose(1), second, points2D, points3D);
      database.addKeyframe(createPose(2), createDescriptorMat(20), points2D, points3D);

      expect(database.size()).toBe(2);
      // The first anchor covers the content placement region; it is pinned
      expect(first.delete).not.toHaveBeenCalled();
      expect(second.delete).toHaveBeenCalled();
    });
  });

  describe("wouldAcceptPose", () => {
    it("should report the spatial-diversity gate without side effects", () => {
      const { database } = createDatabase({
        options: { minKeyframeDistance: 0.5 },
      });
      const { points2D, points3D } = createPoints(20);
      database.addKeyframe(createPose(0), createDescriptorMat(20), points2D, points3D);

      expect(database.wouldAcceptPose(createPose(0.2))).toBe(false);
      expect(database.wouldAcceptPose(createPose(1))).toBe(true);
      expect(database.size()).toBe(1);
    });
  });

  describe("relocalize", () => {
    const seed = (database: RelocalizationDatabase, poseX: number = 0) => {
      const { points2D, points3D } = createPoints(20);
      database.addKeyframe(
        createPose(poseX),
        createDescriptorMat(20),
        points2D,
        points3D
      );
    };

    it("should return a verified pose from PnP inliers", () => {
      const { database } = createDatabase({});
      seed(database);

      const result = database.relocalize(
        createDescriptorMat(20),
        createPoints(20).points2D,
        500
      );

      expect(result).not.toBeNull();
      // Extrinsic t=(0,0,1) -> camera center (0,0,-1)
      expect(result!.pose.translation.z).toBeCloseTo(-1, 10);
      expect(result!.pose.timestamp).toBe(500);
      expect(result!.inlierMatches).toHaveLength(15);
    });

    it("should reject when there are too few matches", () => {
      const { database, pnpSolver } = createDatabase({ matchCount: 5 });
      seed(database);

      const result = database.relocalize(
        createDescriptorMat(20),
        createPoints(20).points2D,
        500
      );

      expect(result).toBeNull();
      expect(pnpSolver.solvePnP).not.toHaveBeenCalled();
    });

    it("should reject when PnP has too few inliers", () => {
      const { database } = createDatabase({ pnpResult: createPnPResult(5) });
      seed(database);

      expect(
        database.relocalize(createDescriptorMat(20), createPoints(20).points2D, 500)
      ).toBeNull();
    });

    it("should reject a low inlier ratio (repetitive-texture false positive)", () => {
      // 40 matches but only 13 inliers: passes the absolute count but the
      // ratio (0.325) is the signature of a wrong match on repeated texture
      const { database } = createDatabase({
        matchCount: 40,
        pnpResult: createPnPResult(13),
      });
      seed(database);

      expect(
        database.relocalize(createDescriptorMat(20), createPoints(20).points2D, 500)
      ).toBeNull();
    });

    it("should reject when the reprojection error is too large", () => {
      const { database } = createDatabase({
        pnpResult: createPnPResult(15, 20),
      });
      seed(database);

      expect(
        database.relocalize(createDescriptorMat(20), createPoints(20).points2D, 500)
      ).toBeNull();
    });

    it("should pick the keyframe with the most inliers", () => {
      const { database, pnpSolver } = createDatabase({});
      seed(database, 0);
      seed(database, 1);
      pnpSolver.solvePnP
        .mockReturnValueOnce(createPnPResult(12))
        .mockReturnValueOnce(createPnPResult(18));

      const result = database.relocalize(
        createDescriptorMat(20),
        createPoints(20).points2D,
        500
      );

      expect(result!.inlierMatches).toHaveLength(18);
      expect(result!.keyframe.pose.translation.x).toBe(1);
    });
  });

  describe("dispose", () => {
    it("should delete all stored descriptor Mats", () => {
      const { database } = createDatabase({});
      const { points2D, points3D } = createPoints(20);
      const descriptors = createDescriptorMat(20);
      database.addKeyframe(createPose(), descriptors, points2D, points3D);

      database.dispose();

      expect(database.size()).toBe(0);
      expect(descriptors.delete).toHaveBeenCalled();
    });
  });
});

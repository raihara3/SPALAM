/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import fitPlaneRANSAC, {
  distancePointToPlane,
  filterByDepth,
} from "./fitPlaneRANSAC";
import type { Point3D } from "../types";

describe("fitPlaneRANSAC", () => {
  describe("basic functionality", () => {
    it("should throw error when less than 3 points provided", () => {
      expect(() => fitPlaneRANSAC({ points: [] })).toThrow("最低3点が必要です");
      expect(() => fitPlaneRANSAC({ points: [{ x: 0, y: 0, z: 0 }] })).toThrow(
        "最低3点が必要です"
      );
      expect(() =>
        fitPlaneRANSAC({
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
          ],
        })
      ).toThrow("最低3点が必要です");
    });

    it("should throw error when iterations is not positive", () => {
      const points: Point3D[] = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ];
      expect(() => fitPlaneRANSAC({ points, iterations: 0 })).toThrow(
        "iterationsは正の値である必要があります"
      );
      expect(() => fitPlaneRANSAC({ points, iterations: -1 })).toThrow(
        "iterationsは正の値である必要があります"
      );
    });

    it("should throw error when threshold is not positive", () => {
      const points: Point3D[] = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ];
      expect(() => fitPlaneRANSAC({ points, threshold: 0 })).toThrow(
        "thresholdは正の値である必要があります"
      );
      expect(() => fitPlaneRANSAC({ points, threshold: -0.1 })).toThrow(
        "thresholdは正の値である必要があります"
      );
    });
  });

  describe("plane fitting", () => {
    it("should fit a horizontal plane (z = 0)", () => {
      const points: Point3D[] = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0.5, y: 0.5, z: 0 },
      ];

      const result = fitPlaneRANSAC({
        points,
        iterations: 100,
        threshold: 0.01,
      });

      expect(result.model).not.toBeNull();
      expect(result.inliers.length).toBe(5);

      // Plane should be z = 0, so normal should be (0, 0, 1) or (0, 0, -1)
      expect(Math.abs(result.model!.c)).toBeCloseTo(1, 5);
      expect(Math.abs(result.model!.a)).toBeCloseTo(0, 5);
      expect(Math.abs(result.model!.b)).toBeCloseTo(0, 5);
    });

    it("should fit a horizontal plane with noise and find most inliers", () => {
      // Points on z = 0 plane with one outlier
      const points: Point3D[] = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0.5, y: 0.5, z: 0 },
        { x: 0.5, y: 0.5, z: 1 }, // outlier
      ];

      const result = fitPlaneRANSAC({
        points,
        iterations: 100,
        threshold: 0.01,
      });

      expect(result.model).not.toBeNull();
      expect(result.inliers.length).toBe(5); // Should exclude the outlier
    });

    it("should fit a vertical plane (x = 0)", () => {
      const points: Point3D[] = [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 1, z: 1 },
        { x: 0, y: 0.5, z: 0.5 },
      ];

      const result = fitPlaneRANSAC({
        points,
        iterations: 100,
        threshold: 0.01,
      });

      expect(result.model).not.toBeNull();
      expect(result.inliers.length).toBe(5);

      // Plane should be x = 0, so normal should be (1, 0, 0) or (-1, 0, 0)
      expect(Math.abs(result.model!.a)).toBeCloseTo(1, 5);
      expect(Math.abs(result.model!.b)).toBeCloseTo(0, 5);
      expect(Math.abs(result.model!.c)).toBeCloseTo(0, 5);
    });
  });
});

describe("distancePointToPlane", () => {
  it("should calculate distance for horizontal plane", () => {
    const plane = { a: 0, b: 0, c: 1, d: 0 }; // z = 0 plane
    const point: Point3D = { x: 0, y: 0, z: 5 };

    expect(distancePointToPlane(point, plane)).toBeCloseTo(5, 10);
  });

  it("should calculate distance for vertical plane", () => {
    const plane = { a: 1, b: 0, c: 0, d: 0 }; // x = 0 plane
    const point: Point3D = { x: 3, y: 0, z: 0 };

    expect(distancePointToPlane(point, plane)).toBeCloseTo(3, 10);
  });

  it("should return 0 for point on plane", () => {
    const plane = { a: 0, b: 0, c: 1, d: 0 }; // z = 0 plane
    const point: Point3D = { x: 5, y: 10, z: 0 };

    expect(distancePointToPlane(point, plane)).toBeCloseTo(0, 10);
  });

  it("should calculate distance for offset plane", () => {
    const plane = { a: 0, b: 0, c: 1, d: -5 }; // z = 5 plane
    const point: Point3D = { x: 0, y: 0, z: 8 };

    expect(distancePointToPlane(point, plane)).toBeCloseTo(3, 10);
  });
});

describe("filterByDepth", () => {
  it("should filter points by depth median", () => {
    const points: Point3D[] = [
      { x: 0, y: 0, z: 1.0 },
      { x: 1, y: 0, z: 1.01 },
      { x: 0, y: 1, z: 0.99 },
      { x: 1, y: 1, z: 1.02 },
      { x: 0.5, y: 0.5, z: 5.0 }, // outlier - far from median
    ];

    const filtered = filterByDepth(points, 0.05);

    expect(filtered.length).toBe(4);
    expect(filtered.find((p) => p.z === 5.0)).toBeUndefined();
  });

  it("should keep all points when within delta", () => {
    const points: Point3D[] = [
      { x: 0, y: 0, z: 1.0 },
      { x: 1, y: 0, z: 1.01 },
      { x: 0, y: 1, z: 0.99 },
    ];

    const filtered = filterByDepth(points, 0.1);

    expect(filtered.length).toBe(3);
  });

  it("should filter all points outside delta", () => {
    const points: Point3D[] = [
      { x: 0, y: 0, z: 1.0 },
      { x: 1, y: 0, z: 2.0 },
      { x: 0, y: 1, z: 3.0 },
    ];

    // median is 2.0, delta is 0.1
    // Only point at z=2.0 is within delta
    const filtered = filterByDepth(points, 0.1);

    expect(filtered.length).toBe(1);
    expect(filtered[0].z).toBe(2.0);
  });
});

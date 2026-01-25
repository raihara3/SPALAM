/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import computeConvexHull2D from "./computeConvexHull2D";
import type { Point2D } from "../types";

describe("computeConvexHull2D", () => {
  describe("input validation", () => {
    it("should throw error for non-array input", () => {
      expect(() => computeConvexHull2D(null as unknown as Point2D[])).toThrow(
        "入力は配列である必要があります"
      );
      expect(() =>
        computeConvexHull2D(undefined as unknown as Point2D[])
      ).toThrow("入力は配列である必要があります");
    });

    it("should throw error for points with invalid coordinates", () => {
      const invalidPoints = [
        { u: 0, v: 0 },
        { u: "invalid" as unknown as number, v: 0 },
        { u: 1, v: 1 },
      ];
      expect(() =>
        computeConvexHull2D(invalidPoints as unknown as Point2D[])
      ).toThrow("すべての点は有効な座標値を持つ必要があります");
    });

    it("should return empty array for empty input", () => {
      expect(computeConvexHull2D([])).toEqual([]);
    });

    it("should return single point for single point input", () => {
      const points: Point2D[] = [{ u: 1, v: 2 }];
      expect(computeConvexHull2D(points)).toEqual([{ u: 1, v: 2 }]);
    });

    it("should return two points for two point input", () => {
      const points: Point2D[] = [
        { u: 0, v: 0 },
        { u: 1, v: 1 },
      ];
      expect(computeConvexHull2D(points)).toHaveLength(2);
    });
  });

  describe("convex hull computation", () => {
    it("should compute hull for triangle", () => {
      const points: Point2D[] = [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 0.5, v: 1 },
      ];

      const hull = computeConvexHull2D(points);

      expect(hull).toHaveLength(3);
    });

    it("should compute hull for square", () => {
      const points: Point2D[] = [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 1, v: 1 },
        { u: 0, v: 1 },
      ];

      const hull = computeConvexHull2D(points);

      expect(hull).toHaveLength(4);
    });

    it("should exclude interior points", () => {
      // Square with center point
      const points: Point2D[] = [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 1, v: 1 },
        { u: 0, v: 1 },
        { u: 0.5, v: 0.5 }, // interior point
      ];

      const hull = computeConvexHull2D(points);

      expect(hull).toHaveLength(4);
      expect(hull.find((p) => p.u === 0.5 && p.v === 0.5)).toBeUndefined();
    });

    it("should handle collinear points", () => {
      const points: Point2D[] = [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 2, v: 0 },
        { u: 3, v: 0 },
      ];

      const hull = computeConvexHull2D(points);

      // Collinear points should return just the endpoints
      expect(hull).toHaveLength(2);
    });

    it("should compute hull for pentagon with interior points", () => {
      // Pentagon vertices
      const points: Point2D[] = [];
      for (let i = 0; i < 5; i++) {
        const angle = (2 * Math.PI * i) / 5 - Math.PI / 2;
        points.push({
          u: Math.cos(angle),
          v: Math.sin(angle),
        });
      }
      // Add interior points
      points.push({ u: 0, v: 0 });
      points.push({ u: 0.1, v: 0.1 });
      points.push({ u: -0.1, v: 0.1 });

      const hull = computeConvexHull2D(points);

      expect(hull).toHaveLength(5); // Only pentagon vertices
    });

    it("should preserve point order as counterclockwise", () => {
      const points: Point2D[] = [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 1, v: 1 },
        { u: 0, v: 1 },
      ];

      const hull = computeConvexHull2D(points);

      // Verify counterclockwise ordering
      for (let i = 0; i < hull.length; i++) {
        const p1 = hull[i];
        const p2 = hull[(i + 1) % hull.length];
        const p3 = hull[(i + 2) % hull.length];
        const crossProduct =
          (p2.u - p1.u) * (p3.v - p1.v) - (p2.v - p1.v) * (p3.u - p1.u);
        // Cross product should be positive for CCW or zero for collinear
        expect(crossProduct).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("edge cases", () => {
    it("should handle duplicate points", () => {
      const points: Point2D[] = [
        { u: 0, v: 0 },
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 1, v: 0 },
        { u: 0.5, v: 1 },
      ];

      const hull = computeConvexHull2D(points);

      // Should still compute valid hull
      expect(hull.length).toBeGreaterThanOrEqual(3);
    });

    it("should handle negative coordinates", () => {
      const points: Point2D[] = [
        { u: -1, v: -1 },
        { u: 1, v: -1 },
        { u: 1, v: 1 },
        { u: -1, v: 1 },
      ];

      const hull = computeConvexHull2D(points);

      expect(hull).toHaveLength(4);
    });

    it("should handle very large coordinates", () => {
      const points: Point2D[] = [
        { u: 1e6, v: 1e6 },
        { u: -1e6, v: 1e6 },
        { u: -1e6, v: -1e6 },
        { u: 1e6, v: -1e6 },
      ];

      const hull = computeConvexHull2D(points);

      expect(hull).toHaveLength(4);
    });
  });
});

import { describe, it, expect } from "vitest";
import backProjectPoints, { getCameraIntrinsics } from "./backProjectPoints";
import type { Point3D } from "../types";
import type { CameraIntrinsicsConfig } from "../config/types";

describe("getCameraIntrinsics", () => {
  it("should calculate intrinsics from FoV", () => {
    const config: CameraIntrinsicsConfig = {
      focalLengthPixels: null,
      horizontalFov: 60,
      principalPointOffset: { x: 0, y: 0 },
    };

    const intrinsics = getCameraIntrinsics(config, 640, 480);

    // For 60 degree FoV:
    // fx = (width / 2) / tan(30 degrees) = 320 / tan(30) ≈ 554.26
    expect(intrinsics.fx).toBeCloseTo(554.26, 0);
    expect(intrinsics.fy).toBeCloseTo(554.26, 0);
    expect(intrinsics.cx).toBe(320);
    expect(intrinsics.cy).toBe(240);
  });

  it("should use explicit focal length when provided", () => {
    const config: CameraIntrinsicsConfig = {
      focalLengthPixels: 500,
      horizontalFov: 60, // Should be ignored
      principalPointOffset: { x: 0, y: 0 },
    };

    const intrinsics = getCameraIntrinsics(config, 640, 480);

    expect(intrinsics.fx).toBe(500);
    expect(intrinsics.fy).toBe(500);
  });

  it("should apply principal point offset", () => {
    const config: CameraIntrinsicsConfig = {
      focalLengthPixels: 500,
      horizontalFov: 60,
      principalPointOffset: { x: 0.1, y: -0.05 },
    };

    const intrinsics = getCameraIntrinsics(config, 640, 480);

    // cx = 320 + 0.1 * 640 = 320 + 64 = 384
    expect(intrinsics.cx).toBe(384);
    // cy = 240 + (-0.05) * 480 = 240 - 24 = 216
    expect(intrinsics.cy).toBe(216);
  });

  it("should handle different image sizes", () => {
    const config: CameraIntrinsicsConfig = {
      focalLengthPixels: null,
      horizontalFov: 90,
      principalPointOffset: { x: 0, y: 0 },
    };

    const intrinsics = getCameraIntrinsics(config, 1920, 1080);

    // For 90 degree FoV:
    // fx = (1920 / 2) / tan(45 degrees) = 960 / 1 = 960
    expect(intrinsics.fx).toBeCloseTo(960, 0);
    expect(intrinsics.cx).toBe(960);
    expect(intrinsics.cy).toBe(540);
  });
});

describe("backProjectPoints", () => {
  const defaultIntrinsics = {
    fx: 500,
    fy: 500,
    cx: 320,
    cy: 240,
  };

  it("should back-project center point correctly", () => {
    // Point at image center with depth 1
    const points: Point3D[] = [{ x: 320, y: 240, z: 1.0 }];

    const projected = backProjectPoints({
      points,
      intrinsics: defaultIntrinsics,
    });

    // Center point should project to (0, 0, z)
    expect(projected[0].x).toBeCloseTo(0, 10);
    expect(projected[0].y).toBeCloseTo(0, 10);
    expect(projected[0].z).toBeCloseTo(1.0, 10);
  });

  it("should back-project off-center point correctly", () => {
    // Point at (420, 140) with depth 2
    const points: Point3D[] = [{ x: 420, y: 140, z: 2.0 }];

    const projected = backProjectPoints({
      points,
      intrinsics: defaultIntrinsics,
    });

    // x = ((420 - 320) * 2) / 500 = 200 / 500 = 0.4
    expect(projected[0].x).toBeCloseTo(0.4, 10);
    // y = -((140 - 240) * 2) / 500 = -(-200) / 500 = 0.4
    expect(projected[0].y).toBeCloseTo(0.4, 10);
    expect(projected[0].z).toBeCloseTo(2.0, 10);
  });

  it("should preserve point id", () => {
    const points: Point3D[] = [{ x: 320, y: 240, z: 1.0, id: "test_point" }];

    const projected = backProjectPoints({
      points,
      intrinsics: defaultIntrinsics,
    });

    expect(projected[0].id).toBe("test_point");
  });

  it("should handle multiple points", () => {
    const points: Point3D[] = [
      { x: 320, y: 240, z: 1.0, id: "p1" },
      { x: 420, y: 340, z: 2.0, id: "p2" },
      { x: 220, y: 140, z: 0.5, id: "p3" },
    ];

    const projected = backProjectPoints({
      points,
      intrinsics: defaultIntrinsics,
    });

    expect(projected).toHaveLength(3);
    expect(projected[0].id).toBe("p1");
    expect(projected[1].id).toBe("p2");
    expect(projected[2].id).toBe("p3");
  });

  it("should handle empty points array", () => {
    const points: Point3D[] = [];

    const projected = backProjectPoints({
      points,
      intrinsics: defaultIntrinsics,
    });

    expect(projected).toHaveLength(0);
  });

  it("should invert Y axis for Three.js coordinate system", () => {
    // Point above center in image (lower y value)
    const pointAbove: Point3D[] = [{ x: 320, y: 140, z: 1.0 }];

    const projectedAbove = backProjectPoints({
      points: pointAbove,
      intrinsics: defaultIntrinsics,
    });

    // In Three.js, Y up, so above center should be positive Y
    expect(projectedAbove[0].y).toBeGreaterThan(0);

    // Point below center in image (higher y value)
    const pointBelow: Point3D[] = [{ x: 320, y: 340, z: 1.0 }];

    const projectedBelow = backProjectPoints({
      points: pointBelow,
      intrinsics: defaultIntrinsics,
    });

    // Below center should be negative Y
    expect(projectedBelow[0].y).toBeLessThan(0);
  });

  it("should scale correctly with depth", () => {
    // Same image point at different depths
    const points: Point3D[] = [
      { x: 420, y: 240, z: 1.0 },
      { x: 420, y: 240, z: 2.0 },
    ];

    const projected = backProjectPoints({
      points,
      intrinsics: defaultIntrinsics,
    });

    // X should scale linearly with depth
    expect(projected[1].x).toBeCloseTo(projected[0].x * 2, 10);
  });
});

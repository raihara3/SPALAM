/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Point3D, Point2D } from "../types/Point";
import type { Feature } from "../types/Feature";
import type { PlaneModel } from "../types/Plane";

/**
 * Creates a set of 3D points on a horizontal plane (z = height)
 */
export function createHorizontalPlanePoints(
  count: number,
  height: number = 0,
  spread: number = 1
): Point3D[] {
  const points: Point3D[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      x: (Math.random() - 0.5) * spread * 2,
      y: (Math.random() - 0.5) * spread * 2,
      z: height,
    });
  }
  return points;
}

/**
 * Creates a set of 3D points on a vertical plane (x = offset)
 */
export function createVerticalPlanePoints(
  count: number,
  offset: number = 0,
  spread: number = 1
): Point3D[] {
  const points: Point3D[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      x: offset,
      y: (Math.random() - 0.5) * spread * 2,
      z: (Math.random() - 0.5) * spread * 2,
    });
  }
  return points;
}

/**
 * Creates a set of 2D points forming a convex shape (using u, v coordinates)
 */
export function createConvexPolygon2D(
  vertexCount: number = 5,
  radius: number = 1
): Point2D[] {
  const points: Point2D[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const angle = (2 * Math.PI * i) / vertexCount;
    points.push({
      u: Math.cos(angle) * radius,
      v: Math.sin(angle) * radius,
    });
  }
  return points;
}

/**
 * Creates mock features with positions
 */
export function createMockFeatures(
  count: number,
  imageWidth: number = 640,
  imageHeight: number = 480
): Feature[] {
  const features: Feature[] = [];
  for (let i = 0; i < count; i++) {
    features.push({
      id: `feature_${i}`,
      x: Math.random() * imageWidth,
      y: Math.random() * imageHeight,
      trackingCount: Math.floor(Math.random() * 10) + 1,
    });
  }
  return features;
}

/**
 * Creates a mock depth map (Uint8Array)
 */
export function createMockDepthMap(
  width: number,
  height: number,
  fillValue: number = 128
): Uint8Array {
  const size = width * height;
  const depthMap = new Uint8Array(size);
  depthMap.fill(fillValue);
  return depthMap;
}

/**
 * Creates a mock gradient depth map (near=0, far=255)
 */
export function createGradientDepthMap(
  width: number,
  height: number
): Uint8Array {
  const size = width * height;
  const depthMap = new Uint8Array(size);
  for (let y = 0; y < height; y++) {
    const value = Math.floor((y / height) * 255);
    for (let x = 0; x < width; x++) {
      depthMap[y * width + x] = value;
    }
  }
  return depthMap;
}

/**
 * Creates a mock PlaneModel (ax + by + cz + d = 0)
 */
export function createMockPlaneModel(
  a: number = 0,
  b: number = 0,
  c: number = 1,
  d: number = 0
): PlaneModel {
  return { a, b, c, d };
}

/**
 * Adds noise to 3D points
 */
export function addNoise(
  points: Point3D[],
  noiseLevel: number = 0.01
): Point3D[] {
  return points.map((p) => ({
    x: p.x + (Math.random() - 0.5) * noiseLevel * 2,
    y: p.y + (Math.random() - 0.5) * noiseLevel * 2,
    z: p.z + (Math.random() - 0.5) * noiseLevel * 2,
  }));
}

/**
 * Creates camera intrinsics for testing
 */
export function createMockCameraIntrinsics(
  width: number = 640,
  height: number = 480,
  fov: number = 60
) {
  const focalLength = height / (2 * Math.tan((fov * Math.PI) / 180 / 2));
  return {
    fx: focalLength,
    fy: focalLength,
    cx: width / 2,
    cy: height / 2,
  };
}

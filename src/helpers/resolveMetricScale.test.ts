/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { resolveMetricScale } from "./resolveMetricScale";

describe("resolveMetricScale", () => {
  it("should return the median ratio of prior to triangulated depths", () => {
    const result = resolveMetricScale({
      triangulatedDepths: [1, 2, 4],
      priorDepths: [2, 4, 8],
      minSamples: 3,
    });

    expect(result.scale).toBe(2);
    expect(result.sampleCount).toBe(3);
    expect(result.isReliable).toBe(true);
  });

  it("should be robust to outliers via the median", () => {
    const result = resolveMetricScale({
      triangulatedDepths: [1, 1, 1, 1, 0.001],
      priorDepths: [3, 3, 3, 3, 300],
      minSamples: 5,
    });

    expect(result.scale).toBe(3);
  });

  it("should average the two middle ratios for even sample counts", () => {
    const result = resolveMetricScale({
      triangulatedDepths: [1, 1],
      priorDepths: [2, 4],
      minSamples: 2,
    });

    expect(result.scale).toBe(3);
  });

  it("should skip non-positive and non-finite depths", () => {
    const result = resolveMetricScale({
      triangulatedDepths: [1, -1, 0, NaN, 2],
      priorDepths: [5, 5, 5, 5, 10],
      minSamples: 2,
    });

    expect(result.sampleCount).toBe(2);
    expect(result.scale).toBe(5);
  });

  it("should be unreliable with no valid pairs", () => {
    const result = resolveMetricScale({
      triangulatedDepths: [],
      priorDepths: [],
    });

    expect(result.scale).toBe(1);
    expect(result.sampleCount).toBe(0);
    expect(result.isReliable).toBe(false);
  });

  it("should be unreliable below minSamples", () => {
    const result = resolveMetricScale({
      triangulatedDepths: [1, 1],
      priorDepths: [2, 2],
      minSamples: 10,
    });

    expect(result.scale).toBe(2);
    expect(result.isReliable).toBe(false);
  });

  it("should clamp extreme scales and mark them unreliable", () => {
    const result = resolveMetricScale({
      triangulatedDepths: [1],
      priorDepths: [10000],
      minSamples: 1,
      maxScale: 100,
    });

    expect(result.scale).toBe(100);
    expect(result.isReliable).toBe(false);
  });
});

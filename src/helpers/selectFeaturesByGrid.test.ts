/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { selectFeaturesByGrid } from "./selectFeaturesByGrid";

describe("selectFeaturesByGrid", () => {
  const baseOptions = {
    imageWidth: 100,
    imageHeight: 100,
    rows: 2,
    columns: 2,
    maxFeatures: 10,
  };

  it("should return empty array for empty candidates", () => {
    expect(selectFeaturesByGrid([], baseOptions)).toEqual([]);
  });

  it("should keep all features when under the per-cell quota", () => {
    const candidates = [
      { x: 10, y: 10 },
      { x: 60, y: 10 },
      { x: 10, y: 60 },
      { x: 60, y: 60 },
    ];

    expect(selectFeaturesByGrid(candidates, baseOptions)).toHaveLength(4);
  });

  it("should cap dense clusters at the per-cell quota", () => {
    // 8 candidates in the top-left cell, quota = 2 per cell
    const clustered = Array.from({ length: 8 }, (_, i) => ({
      x: 5 + i,
      y: 5,
    }));

    const selected = selectFeaturesByGrid(clustered, {
      ...baseOptions,
      maxFeaturesPerCell: 2,
    });

    expect(selected).toHaveLength(2);
    // Quality order preserved: strongest (earliest) candidates win
    expect(selected[0]).toEqual(clustered[0]);
    expect(selected[1]).toEqual(clustered[1]);
  });

  it("should keep spatially distributed features while capping clusters", () => {
    const clustered = Array.from({ length: 8 }, (_, i) => ({
      x: 5 + i,
      y: 5,
    }));
    const spread = [
      { x: 75, y: 25 },
      { x: 25, y: 75 },
      { x: 75, y: 75 },
    ];

    const selected = selectFeaturesByGrid([...clustered, ...spread], {
      ...baseOptions,
      maxFeaturesPerCell: 2,
    });

    expect(selected).toHaveLength(5);
    expect(selected).toEqual(expect.arrayContaining(spread));
  });

  it("should respect the total feature budget", () => {
    const candidates = Array.from({ length: 20 }, (_, i) => ({
      x: (i % 4) * 25 + 5,
      y: Math.floor(i / 4) * 20 + 5,
    }));

    const selected = selectFeaturesByGrid(candidates, {
      ...baseOptions,
      maxFeatures: 6,
      maxFeaturesPerCell: 100,
    });

    expect(selected).toHaveLength(6);
  });

  it("should skip candidates outside the image bounds", () => {
    const candidates = [
      { x: -1, y: 10 },
      { x: 10, y: 100 },
      { x: 50, y: 50 },
    ];

    expect(selectFeaturesByGrid(candidates, baseOptions)).toHaveLength(1);
  });

  it("should assign boundary coordinates to the last row/column cell", () => {
    const candidates = [{ x: 99.9, y: 99.9 }];

    expect(selectFeaturesByGrid(candidates, baseOptions)).toHaveLength(1);
  });

  it("should use the automatic quota when maxFeaturesPerCell is 0", () => {
    // Auto quota = ceil(10 / 4) * 2 = 6
    const clustered = Array.from({ length: 10 }, (_, i) => ({
      x: 5 + i,
      y: 5,
    }));

    const selected = selectFeaturesByGrid(clustered, {
      ...baseOptions,
      maxFeaturesPerCell: 0,
    });

    expect(selected).toHaveLength(6);
  });
});

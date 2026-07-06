/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { computeForwardBackwardMask } from "./computeForwardBackwardMask";

describe("computeForwardBackwardMask", () => {
  it("should keep points with a small round-trip error", () => {
    const mask = computeForwardBackwardMask({
      previousPoints: [{ x: 10, y: 10 }],
      backwardPoints: [{ x: 10.3, y: 9.8 }],
      forwardStatus: [1],
      backwardStatus: [1],
      threshold: 1.0,
    });

    expect(mask).toEqual([true]);
  });

  it("should reject points exceeding the threshold", () => {
    const mask = computeForwardBackwardMask({
      previousPoints: [{ x: 10, y: 10 }],
      backwardPoints: [{ x: 12, y: 10 }],
      forwardStatus: [1],
      backwardStatus: [1],
      threshold: 1.0,
    });

    expect(mask).toEqual([false]);
  });

  it("should accept an error exactly at the threshold", () => {
    const mask = computeForwardBackwardMask({
      previousPoints: [{ x: 10, y: 10 }],
      backwardPoints: [{ x: 11, y: 10 }],
      forwardStatus: [1],
      backwardStatus: [1],
      threshold: 1.0,
    });

    expect(mask).toEqual([true]);
  });

  it("should reject points where forward tracking failed", () => {
    const mask = computeForwardBackwardMask({
      previousPoints: [{ x: 10, y: 10 }],
      backwardPoints: [{ x: 10, y: 10 }],
      forwardStatus: [0],
      backwardStatus: [1],
      threshold: 1.0,
    });

    expect(mask).toEqual([false]);
  });

  it("should reject points where backward tracking failed", () => {
    const mask = computeForwardBackwardMask({
      previousPoints: [{ x: 10, y: 10 }],
      backwardPoints: [{ x: 10, y: 10 }],
      forwardStatus: [1],
      backwardStatus: [0],
      threshold: 1.0,
    });

    expect(mask).toEqual([false]);
  });

  it("should handle typed-array statuses", () => {
    const mask = computeForwardBackwardMask({
      previousPoints: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
      backwardPoints: [
        { x: 0.1, y: 0 },
        { x: 9, y: 5 },
      ],
      forwardStatus: new Uint8Array([1, 1]),
      backwardStatus: new Uint8Array([1, 1]),
      threshold: 0.5,
    });

    expect(mask).toEqual([true, false]);
  });

  it("should handle empty input", () => {
    const mask = computeForwardBackwardMask({
      previousPoints: [],
      backwardPoints: [],
      forwardStatus: [],
      backwardStatus: [],
      threshold: 1.0,
    });

    expect(mask).toEqual([]);
  });
});

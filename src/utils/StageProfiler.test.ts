/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StageProfiler } from "./StageProfiler";

describe("StageProfiler", () => {
  let profiler: StageProfiler;
  let nowSpy: ReturnType<typeof vi.spyOn>;
  let currentTime: number;

  const advanceTime = (deltaMs: number) => {
    currentTime += deltaMs;
  };

  beforeEach(() => {
    profiler = new StageProfiler({ frameBudgetMs: 33, windowSize: 4 });
    currentTime = 0;
    nowSpy = vi
      .spyOn(performance, "now")
      .mockImplementation(() => currentTime);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  describe("stage measurement", () => {
    it("should measure stage durations", () => {
      profiler.beginStage("featureDetection");
      advanceTime(12);
      profiler.endStage("featureDetection");

      const stage = profiler.getStatistics().stages["featureDetection"];
      expect(stage.lastMs).toBe(12);
      expect(stage.averageMs).toBe(12);
      expect(stage.sampleCount).toBe(1);
    });

    it("should ignore endStage without beginStage", () => {
      profiler.endStage("unknown");
      expect(profiler.getStatistics().stages["unknown"]).toBeUndefined();
    });

    it("should average over the rolling window and evict old samples", () => {
      for (const duration of [10, 20, 30, 40, 50]) {
        profiler.beginStage("render");
        advanceTime(duration);
        profiler.endStage("render");
      }

      const stage = profiler.getStatistics().stages["render"];
      // Window size 4: the first sample (10) has been evicted
      expect(stage.sampleCount).toBe(4);
      expect(stage.averageMs).toBe((20 + 30 + 40 + 50) / 4);
      expect(stage.maxMs).toBe(50);
    });

    it("should measure a callback with measure()", () => {
      const result = profiler.measure("tracking", () => {
        advanceTime(7);
        return "value";
      });

      expect(result).toBe("value");
      expect(profiler.getStatistics().stages["tracking"].lastMs).toBe(7);
    });

    it("should record the stage even when the callback throws", () => {
      expect(() =>
        profiler.measure("tracking", () => {
          advanceTime(5);
          throw new Error("failure");
        })
      ).toThrow("failure");

      expect(profiler.getStatistics().stages["tracking"].lastMs).toBe(5);
    });
  });

  describe("frame measurement", () => {
    it("should compute fps from frame start intervals", () => {
      for (let i = 0; i < 3; i++) {
        profiler.beginFrame();
        advanceTime(10);
        profiler.endFrame();
        advanceTime(23); // next frame starts 33ms after the previous start
      }

      expect(profiler.getStatistics().fps).toBeCloseTo(1000 / 33, 1);
    });

    it("should report over-budget frames", () => {
      // Two frames within budget, two over budget
      for (const duration of [10, 10, 40, 40]) {
        profiler.beginFrame();
        advanceTime(duration);
        profiler.endFrame();
      }

      const statistics = profiler.getStatistics();
      expect(statistics.overBudgetRatio).toBe(0.5);
      expect(profiler.isOverBudget()).toBe(false); // average 25ms < 33ms

      for (const duration of [40, 40, 40, 40]) {
        profiler.beginFrame();
        advanceTime(duration);
        profiler.endFrame();
      }
      expect(profiler.isOverBudget()).toBe(true);
    });

    it("should ignore endFrame without beginFrame", () => {
      profiler.endFrame();
      expect(profiler.getStatistics().averageFrameMs).toBe(0);
    });
  });

  describe("reset", () => {
    it("should clear all samples", () => {
      profiler.beginFrame();
      profiler.beginStage("render");
      advanceTime(10);
      profiler.endStage("render");
      profiler.endFrame();

      profiler.reset();

      const statistics = profiler.getStatistics();
      expect(statistics.averageFrameMs).toBe(0);
      expect(statistics.fps).toBe(0);
      expect(Object.keys(statistics.stages)).toHaveLength(0);
    });
  });
});

/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { TimeBase } from "./TimeBase";

describe("TimeBase", () => {
  describe("unix time conversion", () => {
    it("should convert between unix and monotonic domains", () => {
      const timeBase = new TimeBase(1_000_000);

      expect(timeBase.fromUnixTime(1_000_500)).toBe(500);
      expect(timeBase.toUnixTime(500)).toBe(1_000_500);
    });

    it("should round-trip timestamps", () => {
      const timeBase = new TimeBase(123_456.789);
      const unixTime = 987_654.321;

      expect(timeBase.toUnixTime(timeBase.fromUnixTime(unixTime))).toBeCloseTo(
        unixTime,
        6
      );
    });

    it("should default to performance.timeOrigin", () => {
      const timeBase = new TimeBase();

      expect(timeBase.fromUnixTime(performance.timeOrigin)).toBe(0);
    });
  });

  describe("source latency offsets", () => {
    it("should default to zero offset for unknown sources", () => {
      const timeBase = new TimeBase(0);

      expect(timeBase.getSourceLatencyOffset("imu")).toBe(0);
      expect(timeBase.alignSourceTimestamp("imu", 100)).toBe(100);
    });

    it("should subtract the configured latency offset", () => {
      const timeBase = new TimeBase(0);
      timeBase.setSourceLatencyOffset("imu", 15);

      expect(timeBase.alignSourceTimestamp("imu", 100)).toBe(85);
    });

    it("should keep offsets independent per source", () => {
      const timeBase = new TimeBase(0);
      timeBase.setSourceLatencyOffset("imu", 15);
      timeBase.setSourceLatencyOffset("camera", 40);

      expect(timeBase.alignSourceTimestamp("imu", 100)).toBe(85);
      expect(timeBase.alignSourceTimestamp("camera", 100)).toBe(60);
    });

    it("should clear offsets on reset", () => {
      const timeBase = new TimeBase(0);
      timeBase.setSourceLatencyOffset("imu", 15);

      timeBase.reset();

      expect(timeBase.getSourceLatencyOffset("imu")).toBe(0);
    });
  });
});

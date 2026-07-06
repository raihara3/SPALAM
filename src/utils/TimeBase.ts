/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Time Base
 *
 * Camera frames, DeviceMotion/DeviceOrientation events, and render callbacks
 * live on different clocks with different latencies. This class establishes
 * a single monotonic time base (the performance.now() domain) and holds an
 * explicit per-source latency offset so that sensor fusion can align
 * measurements instead of implicitly assuming synchronized clocks.
 */
export class TimeBase {
  private readonly timeOrigin: number;
  private readonly sourceLatencyOffsets: Map<string, number> = new Map();

  /**
   * @param timeOrigin Unix time (ms) corresponding to monotonic time zero.
   *                   Defaults to performance.timeOrigin.
   */
  constructor(timeOrigin: number = performance.timeOrigin) {
    this.timeOrigin = timeOrigin;
  }

  /**
   * Current time in the monotonic domain (ms)
   */
  public now(): number {
    return performance.now();
  }

  /**
   * Convert a Unix-epoch timestamp (e.g. Date.now()) to the monotonic domain
   */
  public fromUnixTime(unixTimeMs: number): number {
    return unixTimeMs - this.timeOrigin;
  }

  /**
   * Convert a monotonic timestamp to the Unix-epoch domain
   */
  public toUnixTime(monotonicTimeMs: number): number {
    return monotonicTimeMs + this.timeOrigin;
  }

  /**
   * Set the latency offset for a timestamp source (e.g. "imu", "camera").
   *
   * The offset is the estimated delay between the physical measurement and
   * the timestamp attached to the event; alignSourceTimestamp() subtracts it.
   */
  public setSourceLatencyOffset(source: string, offsetMs: number): void {
    this.sourceLatencyOffsets.set(source, offsetMs);
  }

  /**
   * Get the latency offset for a source (0 if not set)
   */
  public getSourceLatencyOffset(source: string): number {
    return this.sourceLatencyOffsets.get(source) ?? 0;
  }

  /**
   * Align a source timestamp (already in the monotonic domain) by removing
   * the source's latency offset, yielding the estimated measurement time.
   */
  public alignSourceTimestamp(source: string, timestampMs: number): number {
    return timestampMs - this.getSourceLatencyOffset(source);
  }

  /**
   * Reset all latency offsets
   */
  public reset(): void {
    this.sourceLatencyOffsets.clear();
  }
}

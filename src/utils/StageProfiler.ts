/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Statistics for a single profiled stage
 */
export interface StageStatistics {
  /** Average duration over the rolling window (ms) */
  averageMs: number;
  /** Maximum duration over the rolling window (ms) */
  maxMs: number;
  /** Duration of the most recent sample (ms) */
  lastMs: number;
  /** Number of samples currently in the window */
  sampleCount: number;
}

/**
 * Aggregated frame budget statistics
 */
export interface FrameBudgetStatistics {
  /** Configured frame budget (ms) */
  frameBudgetMs: number;
  /** Average frame duration over the rolling window (ms) */
  averageFrameMs: number;
  /** Frames per second derived from frame start intervals */
  fps: number;
  /** Fraction of recent frames exceeding the budget (0-1) */
  overBudgetRatio: number;
  /** Per-stage statistics keyed by stage name */
  stages: Record<string, StageStatistics>;
}

/**
 * Stage Profiler Options
 */
export interface StageProfilerOptions {
  /** Frame time budget in ms. Default: 1000 / 30 */
  frameBudgetMs?: number;
  /** Rolling window size in frames. Default: 60 */
  windowSize?: number;
  /** Emit performance.mark()/measure() entries for devtools. Default: false */
  enablePerformanceMarks?: boolean;
}

/**
 * Fixed-size rolling window of duration samples (O(1) insertion, no shift())
 */
class RollingWindow {
  private readonly values: number[];
  private writeIndex: number = 0;
  private filled: number = 0;
  private lastValue: number = 0;

  constructor(size: number) {
    this.values = new Array<number>(size).fill(0);
  }

  public push(value: number): void {
    this.values[this.writeIndex] = value;
    this.writeIndex = (this.writeIndex + 1) % this.values.length;
    this.filled = Math.min(this.filled + 1, this.values.length);
    this.lastValue = value;
  }

  public average(): number {
    if (this.filled === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.filled; i++) {
      sum += this.values[i];
    }
    return sum / this.filled;
  }

  public max(): number {
    if (this.filled === 0) return 0;
    let maxValue = -Infinity;
    for (let i = 0; i < this.filled; i++) {
      maxValue = Math.max(maxValue, this.values[i]);
    }
    return maxValue;
  }

  public countAbove(threshold: number): number {
    let count = 0;
    for (let i = 0; i < this.filled; i++) {
      if (this.values[i] > threshold) count++;
    }
    return count;
  }

  public last(): number {
    return this.lastValue;
  }

  public count(): number {
    return this.filled;
  }

  public clear(): void {
    this.writeIndex = 0;
    this.filled = 0;
    this.lastValue = 0;
  }
}

/**
 * Stage Profiler
 *
 * Measures per-stage and per-frame wall-clock durations of the processing
 * pipeline over a rolling window. Dropped frames degrade tracking quality
 * directly (longer optical-flow baselines), so the frame budget signal is
 * a tracking-accuracy input, not just a diagnostics output.
 */
export class StageProfiler {
  private readonly frameBudgetMs: number;
  private readonly windowSize: number;
  private readonly enablePerformanceMarks: boolean;

  private readonly stageWindows: Map<string, RollingWindow> = new Map();
  private readonly stageStartTimes: Map<string, number> = new Map();
  private readonly frameDurations: RollingWindow;
  private readonly frameIntervals: RollingWindow;
  private frameStartTime: number | null = null;
  private previousFrameStartTime: number | null = null;

  constructor(options?: StageProfilerOptions) {
    this.frameBudgetMs = options?.frameBudgetMs ?? 1000 / 30;
    this.windowSize = options?.windowSize ?? 60;
    this.enablePerformanceMarks = options?.enablePerformanceMarks ?? false;
    this.frameDurations = new RollingWindow(this.windowSize);
    this.frameIntervals = new RollingWindow(this.windowSize);
  }

  /**
   * Mark the start of a frame
   */
  public beginFrame(): void {
    const now = performance.now();
    if (this.previousFrameStartTime !== null) {
      this.frameIntervals.push(now - this.previousFrameStartTime);
    }
    this.previousFrameStartTime = now;
    this.frameStartTime = now;
  }

  /**
   * Mark the end of a frame
   */
  public endFrame(): void {
    if (this.frameStartTime === null) {
      return;
    }
    this.frameDurations.push(performance.now() - this.frameStartTime);
    this.frameStartTime = null;
  }

  /**
   * Mark the start of a named stage
   */
  public beginStage(name: string): void {
    this.stageStartTimes.set(name, performance.now());
    if (this.enablePerformanceMarks) {
      performance.mark(`spalam:${name}:start`);
    }
  }

  /**
   * Mark the end of a named stage
   */
  public endStage(name: string): void {
    const startTime = this.stageStartTimes.get(name);
    if (startTime === undefined) {
      return;
    }
    this.stageStartTimes.delete(name);

    let window = this.stageWindows.get(name);
    if (!window) {
      window = new RollingWindow(this.windowSize);
      this.stageWindows.set(name, window);
    }
    window.push(performance.now() - startTime);

    if (this.enablePerformanceMarks) {
      performance.mark(`spalam:${name}:end`);
      performance.measure(
        `spalam:${name}`,
        `spalam:${name}:start`,
        `spalam:${name}:end`
      );
    }
  }

  /**
   * Measure a synchronous function as a named stage
   */
  public measure<T>(name: string, callback: () => T): T {
    this.beginStage(name);
    try {
      return callback();
    } finally {
      this.endStage(name);
    }
  }

  /**
   * Whether the average frame duration exceeds the budget
   */
  public isOverBudget(): boolean {
    return this.frameDurations.average() > this.frameBudgetMs;
  }

  /**
   * Get aggregated statistics over the rolling window
   */
  public getStatistics(): FrameBudgetStatistics {
    const stages: Record<string, StageStatistics> = {};
    this.stageWindows.forEach((window, name) => {
      stages[name] = {
        averageMs: window.average(),
        maxMs: window.max(),
        lastMs: window.last(),
        sampleCount: window.count(),
      };
    });

    const averageInterval = this.frameIntervals.average();
    const frameCount = this.frameDurations.count();

    return {
      frameBudgetMs: this.frameBudgetMs,
      averageFrameMs: this.frameDurations.average(),
      fps: averageInterval > 0 ? 1000 / averageInterval : 0,
      overBudgetRatio:
        frameCount > 0
          ? this.frameDurations.countAbove(this.frameBudgetMs) / frameCount
          : 0,
      stages,
    };
  }

  /**
   * Reset all collected samples
   */
  public reset(): void {
    this.stageWindows.clear();
    this.stageStartTimes.clear();
    this.frameDurations.clear();
    this.frameIntervals.clear();
    this.frameStartTime = null;
    this.previousFrameStartTime = null;
  }
}

/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { Feature } from "../types/Feature";

export enum FeatureQualityState {
  RICH = "RICH",
  POOR = "POOR",
  DROUGHT = "DROUGHT",
}

export interface FeatureQualityMonitorOptions {
  /** Min trackingCount to consider a feature "stable". Default: 3 */
  minStableTrackingCount?: number;
  /** RICH -> POOR when stable count drops below this. Default: 8 */
  richToPoorThreshold?: number;
  /** POOR -> RICH when stable count >= this for N frames. Default: 10 */
  poorToRichThreshold?: number;
  /** POOR -> DROUGHT when stable count drops below this. Default: 2 */
  poorToDroughtThreshold?: number;
  /** DROUGHT -> POOR when stable count >= this for N frames. Default: 5 */
  droughtToPoorThreshold?: number;
  /** Frames a threshold must be sustained for upward transitions. Default: 5 */
  sustainedFramesRequired?: number;
}

export class FeatureQualityMonitor {
  private state: FeatureQualityState = FeatureQualityState.RICH;
  private stableFeatureCount: number = 0;
  private framesInCurrentState: number = 0;
  private sustainedUpwardFrames: number = 0;

  private readonly minStableTrackingCount: number;
  private readonly richToPoorThreshold: number;
  private readonly poorToRichThreshold: number;
  private readonly poorToDroughtThreshold: number;
  private readonly droughtToPoorThreshold: number;
  private readonly sustainedFramesRequired: number;

  constructor(options?: FeatureQualityMonitorOptions) {
    this.minStableTrackingCount = options?.minStableTrackingCount ?? 3;
    this.richToPoorThreshold = options?.richToPoorThreshold ?? 8;
    this.poorToRichThreshold = options?.poorToRichThreshold ?? 10;
    this.poorToDroughtThreshold = options?.poorToDroughtThreshold ?? 2;
    this.droughtToPoorThreshold = options?.droughtToPoorThreshold ?? 5;
    this.sustainedFramesRequired = options?.sustainedFramesRequired ?? 5;
  }

  public update(features: Feature[]): FeatureQualityState {
    this.stableFeatureCount = 0;
    for (const feature of features) {
      if (feature.trackingCount >= this.minStableTrackingCount) {
        this.stableFeatureCount++;
      }
    }

    const previousState = this.state;
    this.applyTransitions();

    if (this.state !== previousState) {
      this.framesInCurrentState = 0;
      this.sustainedUpwardFrames = 0;
    } else {
      this.framesInCurrentState++;
    }

    return this.state;
  }

  private applyTransitions(): void {
    const count = this.stableFeatureCount;

    switch (this.state) {
      case FeatureQualityState.RICH:
        if (count < this.richToPoorThreshold) {
          this.state = FeatureQualityState.POOR;
        }
        break;

      case FeatureQualityState.POOR:
        if (count < this.poorToDroughtThreshold) {
          this.state = FeatureQualityState.DROUGHT;
        } else if (count >= this.poorToRichThreshold) {
          this.sustainedUpwardFrames++;
          if (this.sustainedUpwardFrames >= this.sustainedFramesRequired) {
            this.state = FeatureQualityState.RICH;
          }
        } else {
          this.sustainedUpwardFrames = 0;
        }
        break;

      case FeatureQualityState.DROUGHT:
        if (count >= this.droughtToPoorThreshold) {
          this.sustainedUpwardFrames++;
          if (this.sustainedUpwardFrames >= this.sustainedFramesRequired) {
            this.state = FeatureQualityState.POOR;
          }
        } else {
          this.sustainedUpwardFrames = 0;
        }
        break;
    }
  }

  public getState(): FeatureQualityState {
    return this.state;
  }

  public getStableFeatureCount(): number {
    return this.stableFeatureCount;
  }

  public getFramesInCurrentState(): number {
    return this.framesInCurrentState;
  }

  public reset(): void {
    this.state = FeatureQualityState.RICH;
    this.stableFeatureCount = 0;
    this.framesInCurrentState = 0;
    this.sustainedUpwardFrames = 0;
  }

  public dispose(): void {
    this.reset();
  }
}

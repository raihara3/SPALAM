/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { FeatureQualityState } from "./FeatureQualityMonitor";

export interface PlaneModelPersistenceOptions {
  /** Confidence decay per frame during DROUGHT. Default: 0.995 */
  confidenceDecayRate?: number;
  /** Lerp factor for POOR state. Default: 0.1 */
  poorLerpFactor?: number;
  /** Lerp factor for RICH state. Default: 0.5 */
  richLerpFactor?: number;
  /** Frames to blend from locked to visual during recovery. Default: 30 */
  recoveryBlendFrames?: number;
  /** Minimum confidence to allow recovery (below this, plane is lost). Default: 0.1 */
  minimumConfidenceForRecovery?: number;
}

export interface LockedPlaneModel {
  position: THREE.Vector3;
  confidence: number;
}

export class PlaneModelPersistence {
  private locked: LockedPlaneModel | null = null;
  private recovering: boolean = false;
  private recoveryFrame: number = 0;

  private readonly confidenceDecayRate: number;
  private readonly poorLerpFactor: number;
  private readonly richLerpFactor: number;
  private readonly recoveryBlendFrames: number;
  private readonly minimumConfidenceForRecovery: number;

  // Reusable objects to prevent GC pressure
  private readonly reusablePosition: THREE.Vector3 = new THREE.Vector3();

  constructor(options?: PlaneModelPersistenceOptions) {
    this.confidenceDecayRate = options?.confidenceDecayRate ?? 0.995;
    this.poorLerpFactor = options?.poorLerpFactor ?? 0.1;
    this.richLerpFactor = options?.richLerpFactor ?? 0.5;
    this.recoveryBlendFrames = options?.recoveryBlendFrames ?? 30;
    this.minimumConfidenceForRecovery =
      options?.minimumConfidenceForRecovery ?? 0.1;
  }

  public lockPosition(worldPosition: THREE.Vector3): void {
    if (!this.locked) {
      this.locked = {
        position: new THREE.Vector3(),
        confidence: 1.0,
      };
    }
    this.locked.position.copy(worldPosition);
    this.locked.confidence = 1.0;
    this.recovering = false;
    this.recoveryFrame = 0;
  }

  public updateDuringDrought(): void {
    if (!this.locked) return;
    this.locked.confidence *= this.confidenceDecayRate;
    if (this.locked.confidence < this.minimumConfidenceForRecovery) {
      this.locked = null;
    }
  }

  public getLockedPosition(): THREE.Vector3 | null {
    if (!this.locked) return null;
    return this.reusablePosition.copy(this.locked.position);
  }

  public getConfidence(): number {
    return this.locked?.confidence ?? 0;
  }

  public isConfidenceSufficient(): boolean {
    return this.getConfidence() >= this.minimumConfidenceForRecovery;
  }

  public getLerpFactor(state: FeatureQualityState): number {
    switch (state) {
      case FeatureQualityState.RICH:
        return this.richLerpFactor;
      case FeatureQualityState.POOR:
        return this.poorLerpFactor;
      case FeatureQualityState.DROUGHT:
        return 0;
    }
  }

  public startRecovery(): void {
    this.recovering = true;
    this.recoveryFrame = 0;
  }

  public isRecovering(): boolean {
    return this.recovering;
  }

  public updateRecovery(): void {
    if (!this.recovering) return;
    this.recoveryFrame++;
    if (this.recoveryFrame >= this.recoveryBlendFrames) {
      this.recovering = false;
    }
  }

  public getRecoveryBlendFactor(): number {
    if (!this.recovering) return 1.0;
    if (this.recoveryBlendFrames <= 0) return 1.0;
    return Math.min(1.0, this.recoveryFrame / this.recoveryBlendFrames);
  }

  public isLocked(): boolean {
    return this.locked !== null;
  }

  public reset(): void {
    this.locked = null;
    this.recovering = false;
    this.recoveryFrame = 0;
  }

  public dispose(): void {
    this.reset();
  }
}

/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import type { Feature } from "../types/Feature";
import type { Point2D3DCorrespondence } from "../types/Pose";

/**
 * A 3D landmark tracked across frames
 */
export interface Landmark {
  /** Landmark ID (shared with the feature ID that observes it) */
  id: string;
  /** 3D position in world coordinates */
  position: THREE.Vector3;
  /** Frame index at creation */
  createdAtFrame: number;
  /** Number of frames in which the landmark was observed */
  observationCount: number;
  /** Frame index of the most recent observation */
  lastObservedFrame: number;
  /** Exponential moving average of the reprojection error (px) */
  averageReprojectionError: number;
}

/**
 * Landmark Map Options
 */
export interface LandmarkMapOptions {
  /** Maximum number of landmarks. Default: 500 */
  maxLandmarks?: number;
  /** Cull when the average reprojection error exceeds this (px). Default: 8.0 */
  maxReprojectionError?: number;
  /** Cull when observationCount / age falls below this ratio. Default: 0.25 */
  minObservationRatio?: number;
  /** Grace period in frames before ratio-based culling applies. Default: 10 */
  minFramesBeforeCulling?: number;
  /** Cull when unobserved for this many frames. Default: 30 */
  maxUnobservedFrames?: number;
  /** EMA smoothing factor for reprojection errors (0-1). Default: 0.3 */
  errorSmoothingAlpha?: number;
}

/**
 * Landmark Map
 *
 * Holds triangulated 3D landmarks and manages their lifecycle: observation
 * bookkeeping, reprojection-error tracking, and culling of unreliable
 * points. Accuracy gains from pose optimization are quickly erased if bad
 * landmarks persist in the map, so culling rules are enforced here rather
 * than left to callers.
 */
export class LandmarkMap {
  private readonly maxLandmarks: number;
  private readonly maxReprojectionError: number;
  private readonly minObservationRatio: number;
  private readonly minFramesBeforeCulling: number;
  private readonly maxUnobservedFrames: number;
  private readonly errorSmoothingAlpha: number;

  private readonly landmarks: Map<string, Landmark> = new Map();
  private currentFrame: number = 0;

  constructor(options?: LandmarkMapOptions) {
    this.maxLandmarks = options?.maxLandmarks ?? 500;
    this.maxReprojectionError = options?.maxReprojectionError ?? 8.0;
    this.minObservationRatio = options?.minObservationRatio ?? 0.25;
    this.minFramesBeforeCulling = options?.minFramesBeforeCulling ?? 10;
    this.maxUnobservedFrames = options?.maxUnobservedFrames ?? 30;
    this.errorSmoothingAlpha = options?.errorSmoothingAlpha ?? 0.3;
  }

  /**
   * Advance the frame counter (call once per processed frame)
   *
   * @returns The new current frame index
   */
  public beginFrame(): number {
    return ++this.currentFrame;
  }

  /**
   * Get the current frame index
   */
  public getCurrentFrame(): number {
    return this.currentFrame;
  }

  /**
   * Add a new landmark
   *
   * @returns true if added, false if the ID exists or the map is full
   */
  public addLandmark(id: string, position: THREE.Vector3): boolean {
    if (this.landmarks.has(id) || this.landmarks.size >= this.maxLandmarks) {
      return false;
    }

    this.landmarks.set(id, {
      id,
      position: position.clone(),
      createdAtFrame: this.currentFrame,
      observationCount: 1,
      lastObservedFrame: this.currentFrame,
      averageReprojectionError: 0,
    });
    return true;
  }

  /**
   * Record an observation of a landmark in the current frame
   *
   * @param id Landmark ID
   * @param reprojectionError Reprojection error of this observation (px)
   * @returns true if the landmark exists
   */
  public recordObservation(id: string, reprojectionError: number): boolean {
    const landmark = this.landmarks.get(id);
    if (!landmark) {
      return false;
    }

    landmark.observationCount++;
    landmark.lastObservedFrame = this.currentFrame;
    landmark.averageReprojectionError =
      landmark.observationCount === 2
        ? reprojectionError
        : landmark.averageReprojectionError *
            (1 - this.errorSmoothingAlpha) +
          reprojectionError * this.errorSmoothingAlpha;
    return true;
  }

  /**
   * Update the 3D position of a landmark (e.g. after triangulation refinement)
   */
  public updatePosition(id: string, position: THREE.Vector3): boolean {
    const landmark = this.landmarks.get(id);
    if (!landmark) {
      return false;
    }
    landmark.position.copy(position);
    return true;
  }

  /**
   * Remove unreliable landmarks
   *
   * Culling rules:
   * - average reprojection error above maxReprojectionError
   * - unobserved for more than maxUnobservedFrames
   * - observation ratio below minObservationRatio after the grace period
   *
   * @returns Number of removed landmarks
   */
  public cull(): number {
    let removed = 0;
    this.landmarks.forEach((landmark, id) => {
      const age = this.currentFrame - landmark.createdAtFrame;
      const unobservedFrames = this.currentFrame - landmark.lastObservedFrame;
      const observationRatio =
        age > 0 ? landmark.observationCount / (age + 1) : 1;

      const shouldCull =
        landmark.averageReprojectionError > this.maxReprojectionError ||
        unobservedFrames > this.maxUnobservedFrames ||
        (age >= this.minFramesBeforeCulling &&
          observationRatio < this.minObservationRatio);

      if (shouldCull) {
        this.landmarks.delete(id);
        removed++;
      }
    });
    return removed;
  }

  /**
   * Build 2D-3D correspondences for PnP from the given features
   *
   * Features whose ID matches a landmark contribute a correspondence with
   * their current 2D position and the landmark's 3D position.
   */
  public getCorrespondences(features: Feature[]): Point2D3DCorrespondence[] {
    const correspondences: Point2D3DCorrespondence[] = [];
    for (const feature of features) {
      const landmark = this.landmarks.get(feature.id);
      if (!landmark) {
        continue;
      }
      correspondences.push({
        point2D: { x: feature.x, y: feature.y },
        point3D: landmark.position,
        id: feature.id,
      });
    }
    return correspondences;
  }

  /**
   * Get a landmark by ID
   */
  public getLandmark(id: string): Landmark | null {
    return this.landmarks.get(id) ?? null;
  }

  /**
   * Get all landmarks
   */
  public getLandmarks(): Landmark[] {
    return Array.from(this.landmarks.values());
  }

  /**
   * Number of landmarks in the map
   */
  public size(): number {
    return this.landmarks.size;
  }

  /**
   * Get statistics for debugging and monitoring
   */
  public getStatistics(): {
    landmarkCount: number;
    currentFrame: number;
    averageReprojectionError: number;
    averageObservationCount: number;
  } {
    let errorSum = 0;
    let observationSum = 0;
    this.landmarks.forEach((landmark) => {
      errorSum += landmark.averageReprojectionError;
      observationSum += landmark.observationCount;
    });
    const count = this.landmarks.size;
    return {
      landmarkCount: count,
      currentFrame: this.currentFrame,
      averageReprojectionError: count > 0 ? errorSum / count : 0,
      averageObservationCount: count > 0 ? observationSum / count : 0,
    };
  }

  /**
   * Remove all landmarks and reset the frame counter
   */
  public clear(): void {
    this.landmarks.clear();
    this.currentFrame = 0;
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.clear();
  }
}

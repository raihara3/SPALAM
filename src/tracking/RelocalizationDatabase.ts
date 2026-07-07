/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import type { CameraPose, FeatureMatch } from "../types/Pose";
import type { DescriptorMatcher } from "./DescriptorMatcher";
import type { PnPSolver } from "./PnPSolver";
import { pnpResultToCameraPose } from "../helpers/cameraPoseConversion";

/**
 * A long-lived anchor keyframe stored for relocalization
 */
export interface RelocalizationKeyframe {
  /** Unique entry ID */
  id: number;
  /** Camera pose at this keyframe (world coordinates, OpenCV basis) */
  pose: CameraPose;
  /** ORB descriptors, one row per stored point (owned by the database) */
  descriptors: cv.Mat;
  /** 2D positions aligned with descriptor rows (full-resolution pixels) */
  points2D: Array<{ x: number; y: number }>;
  /** Landmark 3D positions aligned with descriptor rows */
  points3D: THREE.Vector3[];
}

/**
 * Result of a successful relocalization
 */
export interface RelocalizationResult {
  /** Recovered camera pose (camera-to-world, OpenCV basis) */
  pose: CameraPose;
  /** The keyframe entry that produced the best verified match */
  keyframe: RelocalizationKeyframe;
  /** PnP-inlier matches (queryIndex: query row, trainIndex: keyframe row) */
  inlierMatches: FeatureMatch[];
}

/**
 * Relocalization Database Options
 */
export interface RelocalizationDatabaseOptions {
  /** Maximum stored keyframes (oldest evicted). Default: 8 */
  maxKeyframes?: number;
  /** Minimum camera distance between stored keyframes (world units). Default: 0.1 */
  minKeyframeDistance?: number;
  /** Minimum descriptor matches before attempting PnP. Default: 15 */
  minMatches?: number;
  /** Minimum PnP inliers for a verified relocalization. Default: 12 */
  minInliers?: number;
  /**
   * Minimum ratio of PnP inliers to descriptor matches. Repetitive
   * texture (wood grain, tiles) produces many plausible-but-wrong
   * matches; a low inlier ratio is the signature of such a false
   * positive even when the absolute inlier count passes. Default: 0.6
   */
  minInlierRatio?: number;
  /** Maximum PnP reprojection error for a verified relocalization (px). Default: 8 */
  maxReprojectionError?: number;
}

/**
 * Relocalization Database
 *
 * Stores long-lived anchor keyframes (pose + descriptors + landmark
 * positions) outside the bundle-adjustment sliding window, so the world
 * frame can be recovered after a full tracking loss.
 *
 * Relocalization is verified geometrically: descriptor matches alone are
 * not trusted — a candidate must pass RANSAC PnP with enough inliers and
 * a bounded reprojection error. A wrong relocalization that teleports the
 * content is worse than staying lost, so all gates default conservative.
 */
export class RelocalizationDatabase {
  private readonly matcher: Pick<DescriptorMatcher, "matchSimple">;
  private readonly pnpSolver: Pick<PnPSolver, "solvePnP">;

  private readonly maxKeyframes: number;
  private readonly minKeyframeDistance: number;
  private readonly minMatches: number;
  private readonly minInliers: number;
  private readonly minInlierRatio: number;
  private readonly maxReprojectionError: number;

  private readonly keyframes: RelocalizationKeyframe[] = [];
  private nextKeyframeId: number = 0;

  constructor(
    dependencies: {
      matcher: Pick<DescriptorMatcher, "matchSimple">;
      pnpSolver: Pick<PnPSolver, "solvePnP">;
    },
    options?: RelocalizationDatabaseOptions
  ) {
    this.matcher = dependencies.matcher;
    this.pnpSolver = dependencies.pnpSolver;

    this.maxKeyframes = options?.maxKeyframes ?? 8;
    this.minKeyframeDistance = options?.minKeyframeDistance ?? 0.1;
    this.minMatches = options?.minMatches ?? 15;
    this.minInliers = options?.minInliers ?? 12;
    this.minInlierRatio = options?.minInlierRatio ?? 0.6;
    this.maxReprojectionError = options?.maxReprojectionError ?? 8;
  }

  /**
   * Store an anchor keyframe
   *
   * Ownership of the descriptors Mat transfers to the database in all
   * cases: it is deleted on rejection, eviction, and dispose().
   *
   * @returns true if the keyframe was stored
   */
  public addKeyframe(
    pose: CameraPose,
    descriptors: cv.Mat,
    points2D: Array<{ x: number; y: number }>,
    points3D: THREE.Vector3[]
  ): boolean {
    if (
      descriptors.rows !== points2D.length ||
      descriptors.rows !== points3D.length ||
      descriptors.rows === 0
    ) {
      descriptors.delete();
      return false;
    }

    if (!this.wouldAcceptPose(pose)) {
      descriptors.delete();
      return false;
    }

    this.keyframes.push({
      id: this.nextKeyframeId++,
      pose,
      descriptors,
      points2D,
      points3D,
    });

    if (this.keyframes.length > this.maxKeyframes) {
      // Keep the first anchor pinned: it covers the region where the
      // content was placed, which is the most valuable recovery target.
      // Evicting purely by age would eventually leave no anchors there.
      const evicted = this.keyframes.splice(1, 1)[0];
      evicted?.descriptors.delete();
    }
    return true;
  }

  /**
   * Cheap pre-check for the spatial-diversity gate.
   *
   * Callers should test this BEFORE computing descriptors: a keyframe too
   * close to an existing one adds matching cost without adding recovery
   * coverage, and descriptor extraction is the expensive part.
   */
  public wouldAcceptPose(pose: CameraPose): boolean {
    for (const keyframe of this.keyframes) {
      if (
        keyframe.pose.translation.distanceTo(pose.translation) <
        this.minKeyframeDistance
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Attempt to relocalize against the stored keyframes
   *
   * @param queryDescriptors Descriptors of the current frame (caller owns)
   * @param queryPoints2D 2D positions aligned with query rows (full-res px)
   * @param timestamp Current frame timestamp in milliseconds
   * @returns Verified relocalization result, or null
   */
  public relocalize(
    queryDescriptors: cv.Mat,
    queryPoints2D: Array<{ x: number; y: number }>,
    timestamp: number
  ): RelocalizationResult | null {
    let best: RelocalizationResult | null = null;
    let bestInlierCount = 0;
    // A candidate this strong ends the search early; further RANSAC PnP
    // solves would only add main-thread cost
    const confidentInlierCount = this.minInliers * 2;

    for (const keyframe of this.keyframes) {
      const matches = this.matcher.matchSimple(
        queryDescriptors,
        keyframe.descriptors
      );
      if (matches.length < this.minMatches) {
        continue;
      }

      const correspondences = matches.map((match) => ({
        point2D: queryPoints2D[match.queryIndex],
        point3D: keyframe.points3D[match.trainIndex],
        id: String(match.queryIndex),
      }));

      const pnpResult = this.pnpSolver.solvePnP(correspondences);
      if (
        !pnpResult ||
        !pnpResult.isValid ||
        pnpResult.inliers.length < this.minInliers ||
        pnpResult.inliers.length / correspondences.length <
          this.minInlierRatio ||
        pnpResult.reprojectionError > this.maxReprojectionError
      ) {
        continue;
      }

      if (pnpResult.inliers.length > bestInlierCount) {
        bestInlierCount = pnpResult.inliers.length;
        const confidence = pnpResult.inliers.length / correspondences.length;
        best = {
          pose: pnpResultToCameraPose(pnpResult, timestamp, confidence),
          keyframe,
          inlierMatches: pnpResult.inliers.map((index) => matches[index]),
        };
        if (bestInlierCount >= confidentInlierCount) {
          break;
        }
      }
    }

    return best;
  }

  /**
   * Number of stored keyframes
   */
  public size(): number {
    return this.keyframes.length;
  }

  /**
   * Remove all stored keyframes (deletes owned descriptor Mats)
   */
  public clear(): void {
    for (const keyframe of this.keyframes) {
      keyframe.descriptors.delete();
    }
    this.keyframes.length = 0;
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.clear();
  }
}

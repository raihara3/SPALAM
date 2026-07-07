/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FeatureMatch } from "../types/Pose";
import type { Feature } from "../types/Feature";

/**
 * Descriptor Matcher Options
 */
export interface DescriptorMatcherOptions {
  /** Lowe's ratio test threshold (0-1). Default: 0.75 */
  ratioThreshold?: number;
  /** Maximum Hamming distance for valid match. Default: 64 */
  maxDistance?: number;
  /** Minimum number of matches for valid result. Default: 8 */
  minMatches?: number;
  /** Use cross-check matching. Default: false */
  crossCheck?: boolean;
  /** K value for knnMatch. Default: 2 */
  knnK?: number;
}

/**
 * Match statistics
 */
export interface MatchStatistics {
  /** Total matches before filtering */
  totalMatches: number;
  /** Matches after ratio test */
  afterRatioTest: number;
  /** Matches after distance filter */
  afterDistanceFilter: number;
  /** Average match distance */
  averageDistance: number;
  /** Matching time in milliseconds */
  matchingTimeMs: number;
}

/**
 * Descriptor Matcher
 *
 * Wraps OpenCV BFMatcher for ORB descriptor matching with Hamming distance.
 * Implements Lowe's ratio test for robust matching.
 */
export class DescriptorMatcher {
  private cv: typeof cv;
  private ratioThreshold: number;
  private maxDistance: number;
  private minMatches: number;
  private crossCheck: boolean;
  private knnK: number;
  private matcher: cv.BFMatcher | null = null;
  private lastStatistics: MatchStatistics | null = null;

  constructor(cvInstance: typeof cv, options?: DescriptorMatcherOptions) {
    this.cv = cvInstance;
    this.ratioThreshold = options?.ratioThreshold ?? 0.75;
    this.maxDistance = options?.maxDistance ?? 64;
    this.minMatches = options?.minMatches ?? 8;
    this.crossCheck = options?.crossCheck ?? false;
    this.knnK = options?.knnK ?? 2;

    this.initializeMatcher();
  }

  /**
   * Initialize BFMatcher
   */
  private initializeMatcher(): void {
    if (this.matcher) {
      this.matcher.delete();
    }
    // NORM_HAMMING for binary descriptors (ORB).
    // OpenCV.js exposes the embind constructor, not the *_create factory
    // functions from the C++ API; keep the factory as a fallback for
    // builds that do provide it.
    if (typeof this.cv.BFMatcher === "function") {
      this.matcher = new this.cv.BFMatcher(
        this.cv.NORM_HAMMING,
        this.crossCheck
      );
    } else {
      this.matcher = this.cv.BFMatcher_create(
        this.cv.NORM_HAMMING,
        this.crossCheck
      );
    }
  }

  /**
   * Match descriptors between two frames using kNN with ratio test
   *
   * @param queryDescriptors Descriptors from query (current) frame
   * @param trainDescriptors Descriptors from train (reference) frame
   * @returns Array of good matches
   */
  public match(
    queryDescriptors: cv.Mat,
    trainDescriptors: cv.Mat
  ): FeatureMatch[] {
    const startTime = performance.now();

    if (
      !this.matcher ||
      queryDescriptors.empty() ||
      trainDescriptors.empty()
    ) {
      this.lastStatistics = {
        totalMatches: 0,
        afterRatioTest: 0,
        afterDistanceFilter: 0,
        averageDistance: 0,
        matchingTimeMs: performance.now() - startTime,
      };
      return [];
    }

    // Perform kNN matching
    const knnMatches = new this.cv.DMatchVectorVector();

    try {
      this.matcher.knnMatch(
        queryDescriptors,
        trainDescriptors,
        knnMatches,
        this.knnK
      );

      const totalMatches = knnMatches.size();
      const goodMatches: FeatureMatch[] = [];
      let totalDistance = 0;

      // Apply Lowe's ratio test
      for (let i = 0; i < totalMatches; i++) {
        const matches = knnMatches.get(i);
        if (matches.size() >= 2) {
          const best = matches.get(0);
          const secondBest = matches.get(1);

          // Ratio test: best match should be significantly better than second best
          if (best.distance < this.ratioThreshold * secondBest.distance) {
            // Also check absolute distance threshold
            if (best.distance <= this.maxDistance) {
              goodMatches.push({
                queryIndex: best.queryIdx,
                trainIndex: best.trainIdx,
                distance: best.distance,
              });
              totalDistance += best.distance;
            }
          }
        } else if (matches.size() === 1) {
          // Only one match found, use distance threshold only
          const best = matches.get(0);
          if (best.distance <= this.maxDistance) {
            goodMatches.push({
              queryIndex: best.queryIdx,
              trainIndex: best.trainIdx,
              distance: best.distance,
            });
            totalDistance += best.distance;
          }
        }
      }

      this.lastStatistics = {
        totalMatches,
        afterRatioTest: goodMatches.length,
        afterDistanceFilter: goodMatches.length,
        averageDistance:
          goodMatches.length > 0 ? totalDistance / goodMatches.length : 0,
        matchingTimeMs: performance.now() - startTime,
      };

      return goodMatches;
    } finally {
      knnMatches.delete();
    }
  }

  /**
   * Match with simple best-match (no ratio test)
   * Faster but less robust
   *
   * @param queryDescriptors Descriptors from query frame
   * @param trainDescriptors Descriptors from train frame
   * @returns Array of matches
   */
  public matchSimple(
    queryDescriptors: cv.Mat,
    trainDescriptors: cv.Mat
  ): FeatureMatch[] {
    const startTime = performance.now();

    if (
      !this.matcher ||
      queryDescriptors.empty() ||
      trainDescriptors.empty()
    ) {
      this.lastStatistics = {
        totalMatches: 0,
        afterRatioTest: 0,
        afterDistanceFilter: 0,
        averageDistance: 0,
        matchingTimeMs: performance.now() - startTime,
      };
      return [];
    }

    const matches = new this.cv.DMatchVector();

    try {
      this.matcher.match(queryDescriptors, trainDescriptors, matches);

      const totalMatches = matches.size();
      const goodMatches: FeatureMatch[] = [];
      let totalDistance = 0;

      for (let i = 0; i < totalMatches; i++) {
        const match = matches.get(i);
        if (match.distance <= this.maxDistance) {
          goodMatches.push({
            queryIndex: match.queryIdx,
            trainIndex: match.trainIdx,
            distance: match.distance,
          });
          totalDistance += match.distance;
        }
      }

      this.lastStatistics = {
        totalMatches,
        afterRatioTest: totalMatches,
        afterDistanceFilter: goodMatches.length,
        averageDistance:
          goodMatches.length > 0 ? totalDistance / goodMatches.length : 0,
        matchingTimeMs: performance.now() - startTime,
      };

      return goodMatches;
    } finally {
      matches.delete();
    }
  }

  /**
   * Filter matches by geometric consistency using homography or fundamental matrix
   *
   * @param matches Input matches
   * @param queryFeatures Query frame features
   * @param trainFeatures Train frame features
   * @param threshold RANSAC threshold in pixels
   * @returns Filtered matches (geometrically consistent)
   */
  public filterMatchesByGeometry(
    matches: FeatureMatch[],
    queryFeatures: Feature[],
    trainFeatures: Feature[],
    threshold: number = 3.0
  ): FeatureMatch[] {
    if (matches.length < 4) {
      return matches;
    }

    // Build point arrays for findHomography
    const numMatches = matches.length;
    const srcPoints = new this.cv.Mat(numMatches, 1, this.cv.CV_32FC2);
    const dstPoints = new this.cv.Mat(numMatches, 1, this.cv.CV_32FC2);
    const mask = new this.cv.Mat();

    try {
      // Fill point arrays
      for (let i = 0; i < numMatches; i++) {
        const match = matches[i];
        const queryFeature = queryFeatures[match.queryIndex];
        const trainFeature = trainFeatures[match.trainIndex];

        if (!queryFeature || !trainFeature) {
          continue;
        }

        srcPoints.data32F[i * 2] = queryFeature.x;
        srcPoints.data32F[i * 2 + 1] = queryFeature.y;
        dstPoints.data32F[i * 2] = trainFeature.x;
        dstPoints.data32F[i * 2 + 1] = trainFeature.y;
      }

      // Find homography with RANSAC
      const homography = this.cv.findHomography(
        srcPoints,
        dstPoints,
        this.cv.RANSAC,
        threshold,
        mask
      );

      if (homography.empty()) {
        return matches;
      }

      // Filter matches by inlier mask
      const filteredMatches: FeatureMatch[] = [];
      for (let i = 0; i < numMatches; i++) {
        if (mask.data[i] !== 0) {
          filteredMatches.push(matches[i]);
        }
      }

      homography.delete();

      return filteredMatches;
    } finally {
      srcPoints.delete();
      dstPoints.delete();
      mask.delete();
    }
  }

  /**
   * Augment matches with feature IDs
   *
   * @param matches Matches to augment
   * @param queryFeatures Query frame features
   * @param trainFeatures Train frame features
   * @returns Matches with IDs filled in
   */
  public augmentMatchesWithIds(
    matches: FeatureMatch[],
    queryFeatures: Feature[],
    trainFeatures: Feature[]
  ): FeatureMatch[] {
    return matches.map((match) => ({
      ...match,
      queryId: queryFeatures[match.queryIndex]?.id,
      trainId: trainFeatures[match.trainIndex]?.id,
    }));
  }

  /**
   * Check if we have enough matches for pose estimation
   *
   * @param matches Matches to check
   * @returns true if enough matches
   */
  public hasEnoughMatches(matches: FeatureMatch[]): boolean {
    return matches.length >= this.minMatches;
  }

  /**
   * Get matched point pairs
   *
   * @param matches Matches
   * @param queryFeatures Query features
   * @param trainFeatures Train features
   * @returns Array of [query point, train point] pairs
   */
  public getMatchedPointPairs(
    matches: FeatureMatch[],
    queryFeatures: Feature[],
    trainFeatures: Feature[]
  ): Array<[{ x: number; y: number }, { x: number; y: number }]> {
    const pairs: Array<[{ x: number; y: number }, { x: number; y: number }]> =
      [];

    for (const match of matches) {
      const queryFeature = queryFeatures[match.queryIndex];
      const trainFeature = trainFeatures[match.trainIndex];

      if (queryFeature && trainFeature) {
        pairs.push([
          { x: queryFeature.x, y: queryFeature.y },
          { x: trainFeature.x, y: trainFeature.y },
        ]);
      }
    }

    return pairs;
  }

  /**
   * Get last matching statistics
   */
  public getStatistics(): MatchStatistics | null {
    return this.lastStatistics;
  }

  /**
   * Update options
   */
  public updateOptions(options: Partial<DescriptorMatcherOptions>): void {
    if (options.ratioThreshold !== undefined) {
      this.ratioThreshold = options.ratioThreshold;
    }
    if (options.maxDistance !== undefined) {
      this.maxDistance = options.maxDistance;
    }
    if (options.minMatches !== undefined) {
      this.minMatches = options.minMatches;
    }
    if (options.knnK !== undefined) {
      this.knnK = options.knnK;
    }
    if (options.crossCheck !== undefined) {
      this.crossCheck = options.crossCheck;
      this.initializeMatcher();
    }
  }

  /**
   * Reset state
   */
  public reset(): void {
    this.lastStatistics = null;
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    if (this.matcher) {
      this.matcher.delete();
      this.matcher = null;
    }
    this.lastStatistics = null;
  }
}

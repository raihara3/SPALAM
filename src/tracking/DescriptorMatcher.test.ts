/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { DescriptorMatcher } from "./DescriptorMatcher";
import type { Feature } from "../types/Feature";

// Mock OpenCV types and functions
function createMockMat(
  rows: number,
  cols: number,
  data?: Float32Array
): cv.Mat {
  return {
    rows,
    cols,
    data: new Uint8Array(rows * cols),
    data32F: data ?? new Float32Array(rows * cols * 2),
    empty: () => rows === 0 || cols === 0,
    delete: vi.fn(),
    clone: vi.fn(),
    size: () => ({ width: cols, height: rows }),
    type: () => 0,
    channels: () => 1,
  } as unknown as cv.Mat;
}

function createMockDMatch(
  queryIdx: number,
  trainIdx: number,
  distance: number
): cv.DMatch {
  return { queryIdx, trainIdx, imgIdx: 0, distance } as cv.DMatch;
}

function createMockDMatchVector(matches: cv.DMatch[]): cv.DMatchVector {
  return {
    get: (i: number) => matches[i],
    size: () => matches.length,
    push_back: vi.fn(),
    delete: vi.fn(),
  } as unknown as cv.DMatchVector;
}

function createMockDMatchVectorVector(
  matchGroups: cv.DMatch[][]
): cv.DMatchVectorVector {
  const vectors = matchGroups.map((group) => createMockDMatchVector(group));
  return {
    get: (i: number) => vectors[i],
    size: () => matchGroups.length,
    push_back: vi.fn(),
    delete: vi.fn(),
  } as unknown as cv.DMatchVectorVector;
}

function createMockBFMatcher(): cv.BFMatcher {
  return {
    match: vi.fn(),
    knnMatch: vi.fn(),
    delete: vi.fn(),
  };
}

function createMockCv() {
  const mockMatcher = createMockBFMatcher();

  // Create constructor-like functions
  const MockDMatchVector = function (this: cv.DMatchVector) {
    const mock = createMockDMatchVector([]);
    Object.assign(this, mock);
  } as unknown as { new (): cv.DMatchVector };

  const MockDMatchVectorVector = function (this: cv.DMatchVectorVector) {
    const mock = createMockDMatchVectorVector([]);
    Object.assign(this, mock);
  } as unknown as { new (): cv.DMatchVectorVector };

  const MockMat = function (
    this: cv.Mat,
    rows?: number,
    cols?: number
  ) {
    const mock = createMockMat(rows ?? 0, cols ?? 0);
    Object.assign(this, mock);
  } as unknown as cv.MatConstructor;

  return {
    NORM_HAMMING: 6,
    RANSAC: 8,
    CV_32FC2: 13,
    BFMatcher_create: vi.fn(() => mockMatcher),
    DMatchVector: MockDMatchVector,
    DMatchVectorVector: MockDMatchVectorVector,
    Mat: MockMat,
    findHomography: vi.fn(() => {
      const mat = createMockMat(3, 3);
      (mat as { empty: () => boolean }).empty = () => false;
      return mat;
    }),
    _mockMatcher: mockMatcher,
  } as unknown as typeof cv & { _mockMatcher: cv.BFMatcher };
}

function createFeature(
  id: string,
  x: number,
  y: number,
  trackingCount: number = 10
): Feature {
  return { id, x, y, trackingCount };
}

describe("DescriptorMatcher", () => {
  let mockCv: ReturnType<typeof createMockCv>;
  let matcher: DescriptorMatcher;

  beforeEach(() => {
    mockCv = createMockCv();
    matcher = new DescriptorMatcher(mockCv as unknown as typeof cv);
  });

  describe("constructor", () => {
    it("should create BFMatcher with NORM_HAMMING", () => {
      expect(mockCv.BFMatcher_create).toHaveBeenCalledWith(
        mockCv.NORM_HAMMING,
        false
      );
    });

    it("should use default options", () => {
      const stats = matcher.getStatistics();
      expect(stats).toBeNull(); // No matches yet
    });

    it("should accept custom options", () => {
      const customMatcher = new DescriptorMatcher(
        mockCv as unknown as typeof cv,
        {
          ratioThreshold: 0.8,
          maxDistance: 32,
          minMatches: 10,
          crossCheck: true,
        }
      );

      expect(mockCv.BFMatcher_create).toHaveBeenLastCalledWith(
        mockCv.NORM_HAMMING,
        true
      );
      customMatcher.dispose();
    });
  });

  describe("match", () => {
    it("should return empty array for empty descriptors", () => {
      const emptyMat = createMockMat(0, 0);

      const matches = matcher.match(emptyMat, emptyMat);

      expect(matches).toHaveLength(0);
    });

    it("should perform kNN matching with ratio test", () => {
      const queryDesc = createMockMat(10, 32); // 10 descriptors, 32 bytes each
      const trainDesc = createMockMat(10, 32);

      // Setup mock knnMatch to populate matches
      const mockKnnMatches: cv.DMatch[][] = [
        [createMockDMatch(0, 0, 10), createMockDMatch(0, 1, 20)], // Good: 10/20 = 0.5 < 0.75
        [createMockDMatch(1, 1, 30), createMockDMatch(1, 2, 35)], // Bad: 30/35 = 0.86 > 0.75
        [createMockDMatch(2, 3, 15), createMockDMatch(2, 4, 50)], // Good: 15/50 = 0.3 < 0.75
      ];

      mockCv._mockMatcher.knnMatch = vi.fn(
        (
          _query: cv.Mat,
          _train: cv.Mat,
          matches: cv.DMatchVectorVector,
          _k: number
        ) => {
          // Populate the matches object
          const mockMatches = createMockDMatchVectorVector(mockKnnMatches);
          (matches as unknown as { get: typeof mockMatches.get }).get =
            mockMatches.get;
          (matches as unknown as { size: typeof mockMatches.size }).size =
            mockMatches.size;
        }
      );

      const matches = matcher.match(queryDesc, trainDesc);

      expect(mockCv._mockMatcher.knnMatch).toHaveBeenCalled();
      expect(matches).toHaveLength(2); // Only 2 pass ratio test
      expect(matches[0].distance).toBe(10);
      expect(matches[1].distance).toBe(15);
    });

    it("should filter by max distance", () => {
      const queryDesc = createMockMat(5, 32);
      const trainDesc = createMockMat(5, 32);

      const mockKnnMatches: cv.DMatch[][] = [
        [createMockDMatch(0, 0, 100), createMockDMatch(0, 1, 200)], // Fails distance: 100 > 64
        [createMockDMatch(1, 1, 30), createMockDMatch(1, 2, 100)], // Passes: 30 < 64
      ];

      mockCv._mockMatcher.knnMatch = vi.fn(
        (
          _query: cv.Mat,
          _train: cv.Mat,
          matches: cv.DMatchVectorVector,
          _k: number
        ) => {
          const mockMatches = createMockDMatchVectorVector(mockKnnMatches);
          (matches as unknown as { get: typeof mockMatches.get }).get =
            mockMatches.get;
          (matches as unknown as { size: typeof mockMatches.size }).size =
            mockMatches.size;
        }
      );

      const matches = matcher.match(queryDesc, trainDesc);

      expect(matches).toHaveLength(1);
      expect(matches[0].distance).toBe(30);
    });

    it("should update statistics after matching", () => {
      const queryDesc = createMockMat(5, 32);
      const trainDesc = createMockMat(5, 32);

      const mockKnnMatches: cv.DMatch[][] = [
        [createMockDMatch(0, 0, 20), createMockDMatch(0, 1, 50)],
      ];

      mockCv._mockMatcher.knnMatch = vi.fn(
        (
          _query: cv.Mat,
          _train: cv.Mat,
          matches: cv.DMatchVectorVector,
          _k: number
        ) => {
          const mockMatches = createMockDMatchVectorVector(mockKnnMatches);
          (matches as unknown as { get: typeof mockMatches.get }).get =
            mockMatches.get;
          (matches as unknown as { size: typeof mockMatches.size }).size =
            mockMatches.size;
        }
      );

      matcher.match(queryDesc, trainDesc);

      const stats = matcher.getStatistics();
      expect(stats).not.toBeNull();
      expect(stats!.totalMatches).toBe(1);
      expect(stats!.afterRatioTest).toBe(1);
      expect(stats!.averageDistance).toBe(20);
      expect(stats!.matchingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("matchSimple", () => {
    it("should perform simple matching without ratio test", () => {
      const queryDesc = createMockMat(5, 32);
      const trainDesc = createMockMat(5, 32);

      const mockMatches = [
        createMockDMatch(0, 0, 20),
        createMockDMatch(1, 1, 30),
        createMockDMatch(2, 2, 100), // Fails distance threshold
      ];

      mockCv._mockMatcher.match = vi.fn(
        (
          _query: cv.Mat,
          _train: cv.Mat,
          matches: cv.DMatchVector,
          _mask?: cv.Mat
        ) => {
          const mockMatchVector = createMockDMatchVector(mockMatches);
          (matches as unknown as { get: typeof mockMatchVector.get }).get =
            mockMatchVector.get;
          (matches as unknown as { size: typeof mockMatchVector.size }).size =
            mockMatchVector.size;
        }
      );

      const matches = matcher.matchSimple(queryDesc, trainDesc);

      expect(matches).toHaveLength(2);
      expect(matches[0].distance).toBe(20);
      expect(matches[1].distance).toBe(30);
    });
  });

  describe("filterMatchesByGeometry", () => {
    it("should return original matches if less than 4", () => {
      const matches = [
        { queryIndex: 0, trainIndex: 0, distance: 10 },
        { queryIndex: 1, trainIndex: 1, distance: 15 },
      ];
      const queryFeatures = [createFeature("q0", 100, 100)];
      const trainFeatures = [createFeature("t0", 100, 100)];

      const filtered = matcher.filterMatchesByGeometry(
        matches,
        queryFeatures,
        trainFeatures
      );

      expect(filtered).toEqual(matches);
    });

    it("should filter matches using homography", () => {
      const matches = [
        { queryIndex: 0, trainIndex: 0, distance: 10 },
        { queryIndex: 1, trainIndex: 1, distance: 15 },
        { queryIndex: 2, trainIndex: 2, distance: 20 },
        { queryIndex: 3, trainIndex: 3, distance: 25 },
      ];

      const queryFeatures = [
        createFeature("q0", 100, 100),
        createFeature("q1", 200, 100),
        createFeature("q2", 100, 200),
        createFeature("q3", 200, 200),
      ];

      const trainFeatures = [
        createFeature("t0", 110, 110),
        createFeature("t1", 210, 110),
        createFeature("t2", 110, 210),
        createFeature("t3", 210, 210),
      ];

      // Mock findHomography to return mask with some inliers
      mockCv.findHomography = vi.fn(() => {
        const mat = createMockMat(3, 3);
        (mat as { empty: () => boolean }).empty = () => false;
        return mat;
      });

      const filtered = matcher.filterMatchesByGeometry(
        matches,
        queryFeatures,
        trainFeatures
      );

      expect(mockCv.findHomography).toHaveBeenCalled();
      expect(filtered.length).toBeLessThanOrEqual(matches.length);
    });
  });

  describe("augmentMatchesWithIds", () => {
    it("should add feature IDs to matches", () => {
      const matches = [
        { queryIndex: 0, trainIndex: 1, distance: 10 },
        { queryIndex: 1, trainIndex: 0, distance: 15 },
      ];

      const queryFeatures = [
        createFeature("query-0", 100, 100),
        createFeature("query-1", 200, 200),
      ];

      const trainFeatures = [
        createFeature("train-0", 100, 100),
        createFeature("train-1", 200, 200),
      ];

      const augmented = matcher.augmentMatchesWithIds(
        matches,
        queryFeatures,
        trainFeatures
      );

      expect(augmented[0].queryId).toBe("query-0");
      expect(augmented[0].trainId).toBe("train-1");
      expect(augmented[1].queryId).toBe("query-1");
      expect(augmented[1].trainId).toBe("train-0");
    });
  });

  describe("hasEnoughMatches", () => {
    it("should return true when enough matches", () => {
      const matches = Array(10)
        .fill(null)
        .map((_, i) => ({
          queryIndex: i,
          trainIndex: i,
          distance: 10,
        }));

      expect(matcher.hasEnoughMatches(matches)).toBe(true);
    });

    it("should return false when not enough matches", () => {
      const matches = [{ queryIndex: 0, trainIndex: 0, distance: 10 }];

      expect(matcher.hasEnoughMatches(matches)).toBe(false);
    });
  });

  describe("getMatchedPointPairs", () => {
    it("should return matched point pairs", () => {
      const matches = [
        { queryIndex: 0, trainIndex: 1, distance: 10 },
        { queryIndex: 1, trainIndex: 0, distance: 15 },
      ];

      const queryFeatures = [
        createFeature("q0", 100, 150),
        createFeature("q1", 200, 250),
      ];

      const trainFeatures = [
        createFeature("t0", 110, 160),
        createFeature("t1", 210, 260),
      ];

      const pairs = matcher.getMatchedPointPairs(
        matches,
        queryFeatures,
        trainFeatures
      );

      expect(pairs).toHaveLength(2);
      expect(pairs[0][0]).toEqual({ x: 100, y: 150 });
      expect(pairs[0][1]).toEqual({ x: 210, y: 260 });
      expect(pairs[1][0]).toEqual({ x: 200, y: 250 });
      expect(pairs[1][1]).toEqual({ x: 110, y: 160 });
    });

    it("should skip invalid indices", () => {
      const matches = [
        { queryIndex: 0, trainIndex: 10, distance: 10 }, // Invalid train index
      ];

      const queryFeatures = [createFeature("q0", 100, 150)];
      const trainFeatures = [createFeature("t0", 110, 160)];

      const pairs = matcher.getMatchedPointPairs(
        matches,
        queryFeatures,
        trainFeatures
      );

      expect(pairs).toHaveLength(0);
    });
  });

  describe("updateOptions", () => {
    it("should update options", () => {
      matcher.updateOptions({
        ratioThreshold: 0.9,
        maxDistance: 100,
      });

      // Verify by checking that new matches use updated thresholds
      const queryDesc = createMockMat(1, 32);
      const trainDesc = createMockMat(1, 32);

      const mockKnnMatches: cv.DMatch[][] = [
        [createMockDMatch(0, 0, 80), createMockDMatch(0, 1, 85)], // 80/85 = 0.94 > 0.9, but < old 0.75
      ];

      mockCv._mockMatcher.knnMatch = vi.fn(
        (
          _query: cv.Mat,
          _train: cv.Mat,
          matches: cv.DMatchVectorVector,
          _k: number
        ) => {
          const mockMatches = createMockDMatchVectorVector(mockKnnMatches);
          (matches as unknown as { get: typeof mockMatches.get }).get =
            mockMatches.get;
          (matches as unknown as { size: typeof mockMatches.size }).size =
            mockMatches.size;
        }
      );

      const matches = matcher.match(queryDesc, trainDesc);

      // With new threshold 0.9, this should fail (0.94 > 0.9)
      expect(matches).toHaveLength(0);
    });

    it("should reinitialize matcher when crossCheck changes", () => {
      const initialCallCount = (mockCv.BFMatcher_create as ReturnType<typeof vi.fn>).mock.calls.length;

      matcher.updateOptions({ crossCheck: true });

      expect(
        (mockCv.BFMatcher_create as ReturnType<typeof vi.fn>).mock.calls.length
      ).toBe(initialCallCount + 1);
    });
  });

  describe("reset", () => {
    it("should clear statistics", () => {
      const queryDesc = createMockMat(1, 32);
      const trainDesc = createMockMat(1, 32);

      mockCv._mockMatcher.knnMatch = vi.fn(
        (
          _query: cv.Mat,
          _train: cv.Mat,
          matches: cv.DMatchVectorVector,
          _k: number
        ) => {
          const mockMatches = createMockDMatchVectorVector([]);
          (matches as unknown as { get: typeof mockMatches.get }).get =
            mockMatches.get;
          (matches as unknown as { size: typeof mockMatches.size }).size =
            mockMatches.size;
        }
      );

      matcher.match(queryDesc, trainDesc);
      expect(matcher.getStatistics()).not.toBeNull();

      matcher.reset();
      expect(matcher.getStatistics()).toBeNull();
    });
  });

  describe("dispose", () => {
    it("should delete BFMatcher", () => {
      matcher.dispose();

      expect(mockCv._mockMatcher.delete).toHaveBeenCalled();
    });

    it("should clear statistics", () => {
      const queryDesc = createMockMat(1, 32);
      const trainDesc = createMockMat(1, 32);

      mockCv._mockMatcher.knnMatch = vi.fn(
        (
          _query: cv.Mat,
          _train: cv.Mat,
          matches: cv.DMatchVectorVector,
          _k: number
        ) => {
          const mockMatches = createMockDMatchVectorVector([]);
          (matches as unknown as { get: typeof mockMatches.get }).get =
            mockMatches.get;
          (matches as unknown as { size: typeof mockMatches.size }).size =
            mockMatches.size;
        }
      );

      matcher.match(queryDesc, trainDesc);
      matcher.dispose();

      expect(matcher.getStatistics()).toBeNull();
    });
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as THREE from "three";
import { PoseEstimator } from "./PoseEstimator";
import type { CameraIntrinsics, FeatureMatch } from "../types/Pose";
import type { Feature } from "../types/Feature";

describe("PoseEstimator", () => {
  let poseEstimator: PoseEstimator;
  let mockCv: typeof cv;
  let createdMats: Array<{
    data: Uint8Array;
    data32F: Float32Array;
    data64F: Float64Array;
    rows: number;
    cols: number;
    empty: () => boolean;
    delete: () => void;
  }>;

  const defaultIntrinsics: CameraIntrinsics = {
    fx: 500,
    fy: 500,
    cx: 320,
    cy: 240,
    width: 640,
    height: 480,
  };

  // Create a trackable mock Mat
  const createMockMat = (
    rows: number = 0,
    cols: number = 0,
    data64FData?: number[]
  ) => {
    const mat = {
      rows,
      cols,
      type: () => 6,
      empty: () => rows === 0 || cols === 0,
      data: new Uint8Array(Math.max(rows * cols, 20)),
      data32F: new Float32Array(Math.max(rows * cols * 2, 40)),
      data64F: data64FData
        ? new Float64Array(data64FData)
        : new Float64Array(Math.max(rows * cols, 20)),
      delete: vi.fn(),
    };
    createdMats.push(mat);
    return mat as unknown as cv.Mat;
  };

  beforeEach(() => {
    createdMats = [];

    // Create mock OpenCV instance
    mockCv = {
      CV_32FC2: 13,
      CV_64FC1: 6,
      RANSAC: 8,
      LMEDS: 4,
      Mat: function (this: cv.Mat) {
        const mat = createMockMat(3, 3);
        Object.assign(this, mat);
        return this;
      } as unknown as { new (): cv.Mat },
      matFromArray: vi.fn((rows: number, cols: number, _type: number, data: number[]) => {
        return createMockMat(rows, cols, data);
      }),
      findEssentialMat: vi.fn(
        (
          _pts1: cv.Mat,
          _pts2: cv.Mat,
          _K: cv.Mat,
          _method: number,
          _prob: number,
          _threshold: number,
          _maxIter: number,
          mask: cv.Mat
        ) => {
          // Fill the mask with inliers (all 1s for testing)
          const maskObj = mask as unknown as { data: Uint8Array };
          for (let i = 0; i < maskObj.data.length; i++) {
            maskObj.data[i] = 1;
          }
          // Return essential matrix
          return createMockMat(3, 3, [0, -1, 0, 1, 0, 0, 0, 0, 1]);
        }
      ),
      recoverPose: vi.fn(
        (
          _E: cv.Mat,
          _pts1: cv.Mat,
          _pts2: cv.Mat,
          _K: cv.Mat,
          R: cv.Mat,
          t: cv.Mat,
          _mask: cv.Mat
        ) => {
          // Fill rotation matrix (identity)
          const rotObj = R as unknown as { data64F: Float64Array };
          const newRot = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
          for (let i = 0; i < 9; i++) {
            rotObj.data64F[i] = newRot[i];
          }

          // Fill translation vector
          const transObj = t as unknown as { data64F: Float64Array };
          const newTrans = new Float64Array([0.1, 0, 0.99]);
          for (let i = 0; i < 3; i++) {
            transObj.data64F[i] = newTrans[i];
          }

          return 10; // Number of points in front of both cameras
        }
      ),
    } as unknown as typeof cv;

    poseEstimator = new PoseEstimator(mockCv, defaultIntrinsics);
  });

  describe("constructor", () => {
    it("should create with default options", () => {
      expect(poseEstimator).toBeDefined();
    });

    it("should create with custom options", () => {
      const customEstimator = new PoseEstimator(mockCv, defaultIntrinsics, {
        ransacProbability: 0.99,
        ransacThreshold: 2.0,
        minInliers: 10,
        maxIterations: 1000,
        use5Point: false,
      });

      expect(customEstimator).toBeDefined();
    });

    it("should initialize camera matrix from intrinsics", () => {
      expect(mockCv.matFromArray).toHaveBeenCalledWith(
        3,
        3,
        mockCv.CV_64FC1,
        [
          defaultIntrinsics.fx, 0, defaultIntrinsics.cx,
          0, defaultIntrinsics.fy, defaultIntrinsics.cy,
          0, 0, 1,
        ]
      );
    });
  });

  describe("findEssentialMatrix", () => {
    it("should return null for insufficient points", () => {
      const points1 = [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ];
      const points2 = [
        { x: 110, y: 100 },
        { x: 210, y: 200 },
      ];

      const result = poseEstimator.findEssentialMatrix(points1, points2);

      expect(result).toBeNull();
    });

    it("should return null for mismatched point counts", () => {
      const points1 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: i * 10, y: i * 10 }));
      const points2 = Array(8)
        .fill(null)
        .map((_, i) => ({ x: i * 10 + 5, y: i * 10 }));

      const result = poseEstimator.findEssentialMatrix(points1, points2);

      expect(result).toBeNull();
    });

    it("should call findEssentialMat with correct parameters", () => {
      const points1 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 100 + i * 20, y: 100 + i * 20 }));
      const points2 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 110 + i * 20, y: 100 + i * 20 }));

      poseEstimator.findEssentialMatrix(points1, points2);

      expect(mockCv.findEssentialMat).toHaveBeenCalled();
    });

    it("should return EssentialMatrixResult for valid input", () => {
      const points1 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 100 + i * 20, y: 100 + i * 20 }));
      const points2 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 110 + i * 20, y: 100 + i * 20 }));

      const result = poseEstimator.findEssentialMatrix(points1, points2);

      expect(result).toBeDefined();
      expect(result?.essentialMatrix).toBeInstanceOf(THREE.Matrix3);
      expect(result?.inlierMask).toHaveLength(10);
      expect(result?.inlierCount).toBe(10);
      expect(result?.isValid).toBe(true);
    });

    it("should return invalid result when not enough inliers", () => {
      // Override findEssentialMat to set fewer inliers
      mockCv.findEssentialMat = vi.fn(
        (
          _pts1: cv.Mat,
          _pts2: cv.Mat,
          _K: cv.Mat,
          _method?: number,
          _prob?: number,
          _threshold?: number,
          _maxIter?: number,
          mask?: cv.Mat
        ) => {
          if (mask) {
            const maskObj = mask as unknown as { data: Uint8Array };
            // Only 3 inliers (below threshold)
            maskObj.data[0] = 1;
            maskObj.data[1] = 1;
            maskObj.data[2] = 1;
            for (let i = 3; i < maskObj.data.length; i++) {
              maskObj.data[i] = 0;
            }
          }
          return createMockMat(3, 3, [0, -1, 0, 1, 0, 0, 0, 0, 1]);
        }
      );

      const points1 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 100 + i * 20, y: 100 + i * 20 }));
      const points2 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 110 + i * 20, y: 100 + i * 20 }));

      const result = poseEstimator.findEssentialMatrix(points1, points2);

      expect(result?.isValid).toBe(false);
      expect(result?.inlierCount).toBe(3);
    });

    it("should return null when findEssentialMat returns empty matrix", () => {
      mockCv.findEssentialMat = vi.fn(() => createMockMat(0, 0));

      const points1 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 100 + i * 20, y: 100 + i * 20 }));
      const points2 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 110 + i * 20, y: 100 + i * 20 }));

      const result = poseEstimator.findEssentialMatrix(points1, points2);

      expect(result).toBeNull();
    });
  });

  describe("recoverPose", () => {
    const essentialMatrix = new THREE.Matrix3();
    essentialMatrix.set(0, -1, 0, 1, 0, 0, 0, 0, 1);

    it("should return null for insufficient points", () => {
      const points1 = [{ x: 100, y: 100 }];
      const points2 = [{ x: 110, y: 100 }];

      const result = poseEstimator.recoverPose(essentialMatrix, points1, points2);

      expect(result).toBeNull();
    });

    it("should filter points by inlier mask", () => {
      const points1 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 100 + i * 20, y: 100 }));
      const points2 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 110 + i * 20, y: 100 }));
      const inlierMask = [true, true, false, true, true, false, true, true, true, true];

      poseEstimator.recoverPose(essentialMatrix, points1, points2, inlierMask);

      expect(mockCv.recoverPose).toHaveBeenCalled();
    });

    it("should return null when too few inliers remain after filtering", () => {
      const points1 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 100 + i * 20, y: 100 }));
      const points2 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 110 + i * 20, y: 100 }));
      // Only 3 inliers
      const inlierMask = [true, true, true, false, false, false, false, false, false, false];

      const result = poseEstimator.recoverPose(essentialMatrix, points1, points2, inlierMask);

      expect(result).toBeNull();
    });

    it("should return PoseRecoveryResult for valid input", () => {
      const points1 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 100 + i * 20, y: 100 }));
      const points2 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 110 + i * 20, y: 100 }));

      const result = poseEstimator.recoverPose(essentialMatrix, points1, points2);

      expect(result).toBeDefined();
      expect(result?.rotation).toBeInstanceOf(THREE.Matrix3);
      expect(result?.translation).toBeInstanceOf(THREE.Vector3);
      expect(result?.inFrontCount).toBe(10);
      expect(result?.isValid).toBe(true);
    });

    it("should return invalid result when inFrontCount is low", () => {
      mockCv.recoverPose = vi.fn(
        (
          _E: cv.Mat,
          _pts1: cv.Mat,
          _pts2: cv.Mat,
          _K: cv.Mat,
          R: cv.Mat,
          t: cv.Mat,
          _mask?: cv.Mat
        ) => {
          const rotObj = R as unknown as { data64F: Float64Array };
          const transObj = t as unknown as { data64F: Float64Array };
          for (let i = 0; i < 9; i++) rotObj.data64F[i] = i === 0 || i === 4 || i === 8 ? 1 : 0;
          for (let i = 0; i < 3; i++) transObj.data64F[i] = i === 0 ? 1 : 0;
          return 2; // Very few points in front
        }
      );

      const points1 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 100 + i * 20, y: 100 }));
      const points2 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 110 + i * 20, y: 100 }));

      const result = poseEstimator.recoverPose(essentialMatrix, points1, points2);

      expect(result?.isValid).toBe(false);
    });
  });

  describe("estimatePose", () => {
    it("should return null for insufficient points", () => {
      const points1 = [{ x: 100, y: 100 }];
      const points2 = [{ x: 110, y: 100 }];

      const result = poseEstimator.estimatePose(points1, points2, 1000);

      expect(result).toBeNull();
    });

    it("should return CameraPose for valid input", () => {
      const points1 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 100 + i * 20, y: 100 + i * 10 }));
      const points2 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 110 + i * 20, y: 100 + i * 10 }));

      const result = poseEstimator.estimatePose(points1, points2, 1000);

      expect(result).toBeDefined();
      expect(result?.rotation).toBeInstanceOf(THREE.Matrix3);
      expect(result?.translation).toBeInstanceOf(THREE.Vector3);
      expect(result?.quaternion).toBeInstanceOf(THREE.Quaternion);
      expect(result?.timestamp).toBe(1000);
      expect(result?.confidence).toBeGreaterThan(0);
      expect(result?.confidence).toBeLessThanOrEqual(1);
    });

    it("should return null when Essential Matrix estimation fails", () => {
      mockCv.findEssentialMat = vi.fn(() => createMockMat(0, 0));

      const points1 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 100 + i * 20, y: 100 }));
      const points2 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 110 + i * 20, y: 100 }));

      const result = poseEstimator.estimatePose(points1, points2, 1000);

      expect(result).toBeNull();
    });

    it("should return null when pose recovery fails", () => {
      mockCv.recoverPose = vi.fn(
        (
          _E: cv.Mat,
          _pts1: cv.Mat,
          _pts2: cv.Mat,
          _K: cv.Mat,
          R: cv.Mat,
          t: cv.Mat,
          _mask?: cv.Mat
        ) => {
          const rotObj = R as unknown as { data64F: Float64Array };
          const transObj = t as unknown as { data64F: Float64Array };
          for (let i = 0; i < 9; i++) rotObj.data64F[i] = i === 0 || i === 4 || i === 8 ? 1 : 0;
          for (let i = 0; i < 3; i++) transObj.data64F[i] = i === 0 ? 1 : 0;
          return 2; // Too few inliers
        }
      );

      const points1 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 100 + i * 20, y: 100 }));
      const points2 = Array(10)
        .fill(null)
        .map((_, i) => ({ x: 110 + i * 20, y: 100 }));

      const result = poseEstimator.estimatePose(points1, points2, 1000);

      expect(result).toBeNull();
    });

    it("should compute confidence based on inlier ratio", () => {
      const points1 = Array(20)
        .fill(null)
        .map((_, i) => ({ x: 100 + i * 10, y: 100 + i * 5 }));
      const points2 = Array(20)
        .fill(null)
        .map((_, i) => ({ x: 110 + i * 10, y: 100 + i * 5 }));

      const result = poseEstimator.estimatePose(points1, points2, 1000);

      expect(result?.confidence).toBe(1); // All points are inliers in mock
    });
  });

  describe("estimatePoseFromMatches", () => {
    it("should return null for insufficient matches", () => {
      const matches: FeatureMatch[] = [{ queryIndex: 0, trainIndex: 0, distance: 10 }];
      const features1: Feature[] = [{ id: "f1", x: 100, y: 100, trackingCount: 1 }];
      const features2: Feature[] = [{ id: "f2", x: 110, y: 100, trackingCount: 1 }];

      const result = poseEstimator.estimatePoseFromMatches(matches, features1, features2, 1000);

      expect(result).toBeNull();
    });

    it("should extract points from matches and estimate pose", () => {
      const features1: Feature[] = Array(10)
        .fill(null)
        .map((_, i) => ({
          id: `q${i}`,
          x: 100 + i * 20,
          y: 100 + i * 10,
          trackingCount: 1,
        }));
      const features2: Feature[] = Array(10)
        .fill(null)
        .map((_, i) => ({
          id: `t${i}`,
          x: 110 + i * 20,
          y: 100 + i * 10,
          trackingCount: 1,
        }));
      const matches: FeatureMatch[] = Array(10)
        .fill(null)
        .map((_, i) => ({
          queryIndex: i,
          trainIndex: i,
          distance: 10 + i,
        }));

      const result = poseEstimator.estimatePoseFromMatches(matches, features1, features2, 1000);

      expect(result).toBeDefined();
      expect(result?.timestamp).toBe(1000);
    });

    it("should skip invalid match indices", () => {
      const features1: Feature[] = Array(10)
        .fill(null)
        .map((_, i) => ({
          id: `q${i}`,
          x: 100 + i * 20,
          y: 100,
          trackingCount: 1,
        }));
      const features2: Feature[] = Array(10)
        .fill(null)
        .map((_, i) => ({
          id: `t${i}`,
          x: 110 + i * 20,
          y: 100,
          trackingCount: 1,
        }));
      const matches: FeatureMatch[] = [
        { queryIndex: 0, trainIndex: 0, distance: 10 },
        { queryIndex: 100, trainIndex: 0, distance: 10 }, // Invalid query index
        { queryIndex: 1, trainIndex: 100, distance: 10 }, // Invalid train index
        { queryIndex: 2, trainIndex: 2, distance: 10 },
        { queryIndex: 3, trainIndex: 3, distance: 10 },
        { queryIndex: 4, trainIndex: 4, distance: 10 },
        { queryIndex: 5, trainIndex: 5, distance: 10 },
        { queryIndex: 6, trainIndex: 6, distance: 10 },
        { queryIndex: 7, trainIndex: 7, distance: 10 },
        { queryIndex: 8, trainIndex: 8, distance: 10 },
      ];

      const result = poseEstimator.estimatePoseFromMatches(matches, features1, features2, 1000);

      // 8 valid matches should be enough
      expect(result).toBeDefined();
    });
  });

  describe("updateIntrinsics", () => {
    it("should update intrinsics and reinitialize camera matrix", () => {
      const newIntrinsics: CameraIntrinsics = {
        fx: 600,
        fy: 600,
        cx: 400,
        cy: 300,
        width: 800,
        height: 600,
      };

      poseEstimator.updateIntrinsics(newIntrinsics);

      const retrieved = poseEstimator.getIntrinsics();
      expect(retrieved.fx).toBe(600);
      expect(retrieved.fy).toBe(600);
      expect(retrieved.cx).toBe(400);
      expect(retrieved.cy).toBe(300);
    });
  });

  describe("updateOptions", () => {
    it("should update ransacProbability", () => {
      poseEstimator.updateOptions({ ransacProbability: 0.99 });
      expect(poseEstimator).toBeDefined();
    });

    it("should update all options", () => {
      poseEstimator.updateOptions({
        ransacProbability: 0.99,
        ransacThreshold: 2.0,
        minInliers: 10,
        maxIterations: 1000,
        use5Point: false,
      });

      expect(poseEstimator).toBeDefined();
    });
  });

  describe("getIntrinsics", () => {
    it("should return copy of intrinsics", () => {
      const intrinsics = poseEstimator.getIntrinsics();

      expect(intrinsics.fx).toBe(defaultIntrinsics.fx);
      expect(intrinsics.fy).toBe(defaultIntrinsics.fy);
      expect(intrinsics.cx).toBe(defaultIntrinsics.cx);
      expect(intrinsics.cy).toBe(defaultIntrinsics.cy);
    });
  });

  describe("reset", () => {
    it("should not throw", () => {
      expect(() => poseEstimator.reset()).not.toThrow();
    });
  });

  describe("dispose", () => {
    it("should clean up resources", () => {
      poseEstimator.dispose();
      expect(poseEstimator).toBeDefined();
    });
  });
});

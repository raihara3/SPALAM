import { describe, it, expect, beforeEach, vi } from "vitest";
import * as THREE from "three";
import { Triangulator } from "./Triangulator";
import type { CameraPose, CameraIntrinsics } from "../types/Pose";

describe("Triangulator", () => {
  let triangulator: Triangulator;
  let mockCv: typeof cv;

  const defaultIntrinsics: CameraIntrinsics = {
    fx: 500,
    fy: 500,
    cx: 320,
    cy: 240,
    width: 640,
    height: 480,
  };

  // Create identity pose
  const createIdentityPose = (timestamp: number = 0): CameraPose => {
    return {
      rotation: new THREE.Matrix3().identity(),
      translation: new THREE.Vector3(0, 0, 0),
      quaternion: new THREE.Quaternion(),
      timestamp,
      confidence: 1.0,
    };
  };

  // Create translated pose
  const createTranslatedPose = (
    tx: number,
    ty: number,
    tz: number,
    timestamp: number = 0
  ): CameraPose => {
    return {
      rotation: new THREE.Matrix3().identity(),
      translation: new THREE.Vector3(tx, ty, tz),
      quaternion: new THREE.Quaternion(),
      timestamp,
      confidence: 1.0,
    };
  };

  // Create a trackable mock Mat
  const createMockMat = (
    rows: number = 0,
    cols: number = 0,
    data?: number[]
  ) => {
    return {
      rows,
      cols,
      type: () => 6,
      empty: () => rows === 0 || cols === 0,
      data: new Uint8Array(Math.max(rows * cols, 20)),
      data32F: data
        ? new Float32Array(data)
        : new Float32Array(Math.max(rows * cols * 4, 100)),
      data64F: data
        ? new Float64Array(data)
        : new Float64Array(Math.max(rows * cols, 20)),
      delete: vi.fn(),
    } as unknown as cv.Mat;
  };

  beforeEach(() => {
    // Create mock OpenCV instance
    mockCv = {
      CV_64FC1: 6,
      Mat: function (this: cv.Mat, rows?: number, cols?: number) {
        const mat = createMockMat(rows ?? 3, cols ?? 3);
        Object.assign(this, mat);
        return this;
      } as unknown as { new (rows?: number, cols?: number, type?: number): cv.Mat },
      matFromArray: vi.fn((rows: number, cols: number, _type: number, data: number[]) => {
        return createMockMat(rows, cols, data);
      }),
      gemm: vi.fn(
        (
          _src1: cv.Mat,
          _src2: cv.Mat,
          _alpha: number,
          _src3: cv.Mat,
          _beta: number,
          dst: cv.Mat
        ) => {
          // Simple mock: just copy some data
          const dstObj = dst as unknown as { data64F: Float64Array };
          for (let i = 0; i < 12; i++) {
            dstObj.data64F[i] = i < 3 ? 500 : i < 6 ? 0 : i < 9 ? 320 : 1;
          }
        }
      ),
      triangulatePoints: vi.fn(
        (
          _P1: cv.Mat,
          _P2: cv.Mat,
          pts1: cv.Mat,
          _pts2: cv.Mat,
          points4D: cv.Mat
        ) => {
          // Generate 3D points based on input 2D points
          const pts1Obj = pts1 as unknown as { data64F: Float64Array; cols: number };
          const numPoints = pts1Obj.cols;
          const points4DObj = points4D as unknown as { data32F: Float32Array };

          for (let i = 0; i < numPoints; i++) {
            // Generate reasonable 3D points (at depth ~5)
            const x2d = pts1Obj.data64F[i];
            const y2d = pts1Obj.data64F[numPoints + i];

            const x = (x2d - 320) / 500 * 5;
            const y = (y2d - 240) / 500 * 5;
            const z = 5;
            const w = 1;

            points4DObj.data32F[i] = x;
            points4DObj.data32F[numPoints + i] = y;
            points4DObj.data32F[numPoints * 2 + i] = z;
            points4DObj.data32F[numPoints * 3 + i] = w;
          }
        }
      ),
    } as unknown as typeof cv;

    triangulator = new Triangulator(mockCv, defaultIntrinsics);
  });

  describe("constructor", () => {
    it("should create with default options", () => {
      expect(triangulator).toBeDefined();
    });

    it("should create with custom options", () => {
      const customTriangulator = new Triangulator(mockCv, defaultIntrinsics, {
        minParallax: 0.02,
        maxReprojectionError: 2.0,
        maxDepth: 50,
        minDepth: 0.5,
      });

      expect(customTriangulator).toBeDefined();
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

  describe("triangulate", () => {
    it("should return empty array for empty points", () => {
      const pose1 = createIdentityPose();
      const pose2 = createTranslatedPose(1, 0, 0);

      const results = triangulator.triangulate([], [], pose1, pose2);

      expect(results).toHaveLength(0);
    });

    it("should return empty array for mismatched point counts", () => {
      const pose1 = createIdentityPose();
      const pose2 = createTranslatedPose(1, 0, 0);

      const points1 = [{ x: 320, y: 240 }];
      const points2 = [{ x: 330, y: 240 }, { x: 340, y: 250 }];

      const results = triangulator.triangulate(points1, points2, pose1, pose2);

      expect(results).toHaveLength(0);
    });

    it("should triangulate points between two views", () => {
      const pose1 = createIdentityPose();
      const pose2 = createTranslatedPose(0.5, 0, 0);

      const points1 = [
        { x: 320, y: 240 },
        { x: 400, y: 300 },
        { x: 200, y: 180 },
      ];
      const points2 = [
        { x: 310, y: 240 },
        { x: 390, y: 300 },
        { x: 190, y: 180 },
      ];

      const results = triangulator.triangulate(points1, points2, pose1, pose2);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.point3D).toBeInstanceOf(THREE.Vector3);
        expect(typeof result.reprojectionError).toBe("number");
        expect(typeof result.parallaxAngle).toBe("number");
        expect(typeof result.isValid).toBe("boolean");
      });
    });

    it("should include point IDs when provided", () => {
      const pose1 = createIdentityPose();
      const pose2 = createTranslatedPose(0.5, 0, 0);

      const points1 = [{ x: 320, y: 240 }];
      const points2 = [{ x: 310, y: 240 }];
      const ids = ["point_0"];

      const results = triangulator.triangulate(
        points1,
        points2,
        pose1,
        pose2,
        ids
      );

      expect(results[0].id).toBe("point_0");
    });

    it("should call triangulatePoints", () => {
      const pose1 = createIdentityPose();
      const pose2 = createTranslatedPose(0.5, 0, 0);

      const points1 = [{ x: 320, y: 240 }];
      const points2 = [{ x: 310, y: 240 }];

      triangulator.triangulate(points1, points2, pose1, pose2);

      expect(mockCv.triangulatePoints).toHaveBeenCalled();
    });

    it("should handle point at infinity", () => {
      // Mock triangulatePoints to return point at infinity
      mockCv.triangulatePoints = vi.fn(
        (
          _P1: cv.Mat,
          _P2: cv.Mat,
          _pts1: cv.Mat,
          _pts2: cv.Mat,
          points4D: cv.Mat
        ) => {
          const points4DObj = points4D as unknown as { data32F: Float32Array };
          points4DObj.data32F[0] = 1;
          points4DObj.data32F[1] = 1;
          points4DObj.data32F[2] = 1;
          points4DObj.data32F[3] = 0; // w = 0 -> point at infinity
        }
      );

      const pose1 = createIdentityPose();
      const pose2 = createTranslatedPose(0.5, 0, 0);

      const points1 = [{ x: 320, y: 240 }];
      const points2 = [{ x: 310, y: 240 }];

      const results = triangulator.triangulate(points1, points2, pose1, pose2);

      expect(results[0].isValid).toBe(false);
      expect(results[0].reprojectionError).toBe(Infinity);
    });
  });

  describe("triangulateSingle", () => {
    it("should triangulate single point", () => {
      const pose1 = createIdentityPose();
      const pose2 = createTranslatedPose(0.5, 0, 0);

      const result = triangulator.triangulateSingle(
        { x: 320, y: 240 },
        { x: 310, y: 240 },
        pose1,
        pose2,
        "single_point"
      );

      expect(result.point3D).toBeInstanceOf(THREE.Vector3);
      expect(result.id).toBe("single_point");
    });

    it("should return invalid result for failed triangulation", () => {
      // Make triangulate return empty array
      mockCv.triangulatePoints = vi.fn();

      const pose1 = createIdentityPose();
      const pose2 = createTranslatedPose(0.5, 0, 0);

      const result = triangulator.triangulateSingle(
        { x: 320, y: 240 },
        { x: 310, y: 240 },
        pose1,
        pose2
      );

      expect(result.isValid).toBe(false);
    });
  });

  describe("filterByQuality", () => {
    it("should filter out invalid results", () => {
      const results = [
        {
          point3D: new THREE.Vector3(0, 0, 5),
          reprojectionError: 1.0,
          parallaxAngle: 0.1,
          isValid: true,
        },
        {
          point3D: new THREE.Vector3(0, 0, 5),
          reprojectionError: 10.0,
          parallaxAngle: 0.001,
          isValid: false,
        },
        {
          point3D: new THREE.Vector3(0, 0, 5),
          reprojectionError: 2.0,
          parallaxAngle: 0.05,
          isValid: true,
        },
      ];

      const filtered = triangulator.filterByQuality(results);

      expect(filtered).toHaveLength(2);
      expect(filtered.every((r) => r.isValid)).toBe(true);
    });

    it("should return empty array when all invalid", () => {
      const results = [
        {
          point3D: new THREE.Vector3(0, 0, 5),
          reprojectionError: 10.0,
          parallaxAngle: 0.001,
          isValid: false,
        },
      ];

      const filtered = triangulator.filterByQuality(results);

      expect(filtered).toHaveLength(0);
    });
  });

  describe("calculateBaseline", () => {
    it("should calculate baseline distance between poses", () => {
      const pose1 = createIdentityPose();
      const pose2 = createTranslatedPose(3, 4, 0);

      const baseline = triangulator.calculateBaseline(pose1, pose2);

      expect(baseline).toBeCloseTo(5, 5); // sqrt(3^2 + 4^2) = 5
    });

    it("should return 0 for same poses", () => {
      const pose1 = createIdentityPose();
      const pose2 = createIdentityPose();

      const baseline = triangulator.calculateBaseline(pose1, pose2);

      expect(baseline).toBe(0);
    });
  });

  describe("hasSufficientBaseline", () => {
    it("should return true when baseline exceeds minimum", () => {
      const pose1 = createIdentityPose();
      const pose2 = createTranslatedPose(0.5, 0, 0);

      const result = triangulator.hasSufficientBaseline(pose1, pose2, 0.1);

      expect(result).toBe(true);
    });

    it("should return false when baseline is too small", () => {
      const pose1 = createIdentityPose();
      const pose2 = createTranslatedPose(0.005, 0, 0);

      const result = triangulator.hasSufficientBaseline(pose1, pose2, 0.1);

      expect(result).toBe(false);
    });

    it("should use default minimum baseline", () => {
      const pose1 = createIdentityPose();
      const pose2 = createTranslatedPose(0.02, 0, 0);

      const result = triangulator.hasSufficientBaseline(pose1, pose2);

      expect(result).toBe(true); // 0.02 > 0.01 (default)
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

      triangulator.updateIntrinsics(newIntrinsics);

      const retrieved = triangulator.getIntrinsics();
      expect(retrieved.fx).toBe(600);
      expect(retrieved.fy).toBe(600);
    });
  });

  describe("updateOptions", () => {
    it("should update minParallax", () => {
      triangulator.updateOptions({ minParallax: 0.05 });
      expect(triangulator).toBeDefined();
    });

    it("should update all options", () => {
      triangulator.updateOptions({
        minParallax: 0.02,
        maxReprojectionError: 2.0,
        maxDepth: 50,
        minDepth: 0.5,
      });

      expect(triangulator).toBeDefined();
    });
  });

  describe("getIntrinsics", () => {
    it("should return copy of intrinsics", () => {
      const intrinsics = triangulator.getIntrinsics();

      expect(intrinsics.fx).toBe(defaultIntrinsics.fx);
      expect(intrinsics.fy).toBe(defaultIntrinsics.fy);
    });
  });

  describe("reset", () => {
    it("should not throw", () => {
      expect(() => triangulator.reset()).not.toThrow();
    });
  });

  describe("dispose", () => {
    it("should clean up resources", () => {
      triangulator.dispose();
      expect(triangulator).toBeDefined();
    });
  });
});

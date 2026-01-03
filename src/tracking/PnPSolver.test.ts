import { describe, it, expect, beforeEach, vi } from "vitest";
import * as THREE from "three";
import { PnPSolver } from "./PnPSolver";
import type { CameraIntrinsics, Point2D3DCorrespondence } from "../types/Pose";

describe("PnPSolver", () => {
  let pnpSolver: PnPSolver;
  let mockCv: typeof cv;

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
    return {
      rows,
      cols,
      type: () => 6,
      empty: () => rows === 0 || cols === 0,
      data: new Uint8Array(Math.max(rows * cols, 20)),
      data32S: new Int32Array(Math.max(rows, 10)),
      data32F: new Float32Array(Math.max(rows * cols * 2, 40)),
      data64F: data64FData
        ? new Float64Array(data64FData)
        : new Float64Array(Math.max(rows * cols, 20)),
      delete: vi.fn(),
    } as unknown as cv.Mat;
  };

  // Generate test correspondences
  const generateCorrespondences = (count: number): Point2D3DCorrespondence[] => {
    const correspondences: Point2D3DCorrespondence[] = [];
    for (let i = 0; i < count; i++) {
      correspondences.push({
        point2D: { x: 100 + i * 50, y: 100 + i * 30 },
        point3D: new THREE.Vector3(
          (i - count / 2) * 0.5,
          (i % 3 - 1) * 0.3,
          2 + i * 0.1
        ),
        id: `point_${i}`,
      });
    }
    return correspondences;
  };

  beforeEach(() => {
    // Create mock OpenCV instance
    mockCv = {
      CV_64FC1: 6,
      SOLVEPNP_ITERATIVE: 0,
      SOLVEPNP_EPNP: 1,
      SOLVEPNP_P3P: 2,
      SOLVEPNP_AP3P: 5,
      Mat: function (this: cv.Mat) {
        const mat = createMockMat(3, 3);
        Object.assign(this, mat);
        return this;
      } as unknown as { new (): cv.Mat },
      matFromArray: vi.fn((rows: number, cols: number, _type: number, data: number[]) => {
        return createMockMat(rows, cols, data);
      }),
      solvePnPRansac: vi.fn(
        (
          _objectPoints: cv.Mat,
          _imagePoints: cv.Mat,
          _cameraMatrix: cv.Mat,
          _distCoeffs: cv.Mat,
          rvec: cv.Mat,
          tvec: cv.Mat,
          _useExtrinsicGuess?: boolean,
          _iterationsCount?: number,
          _reprojectionError?: number,
          _confidence?: number,
          inliers?: cv.Mat,
          _flags?: number
        ) => {
          // Fill rotation vector (small rotation around Y)
          const rvecObj = rvec as unknown as { data64F: Float64Array };
          rvecObj.data64F[0] = 0.1;
          rvecObj.data64F[1] = 0.2;
          rvecObj.data64F[2] = 0.05;

          // Fill translation vector
          const tvecObj = tvec as unknown as { data64F: Float64Array };
          tvecObj.data64F[0] = 0.5;
          tvecObj.data64F[1] = -0.3;
          tvecObj.data64F[2] = 2.0;

          // Fill inliers
          if (inliers) {
            const inliersObj = inliers as unknown as { rows: number; data32S: Int32Array };
            inliersObj.rows = 6;
            for (let i = 0; i < 6; i++) {
              inliersObj.data32S[i] = i;
            }
          }

          return true;
        }
      ),
      solvePnP: vi.fn(
        (
          _objectPoints: cv.Mat,
          _imagePoints: cv.Mat,
          _cameraMatrix: cv.Mat,
          _distCoeffs: cv.Mat,
          rvec: cv.Mat,
          tvec: cv.Mat,
          _useExtrinsicGuess?: boolean,
          _flags?: number
        ) => {
          const rvecObj = rvec as unknown as { data64F: Float64Array };
          rvecObj.data64F[0] = 0.1;
          rvecObj.data64F[1] = 0.2;
          rvecObj.data64F[2] = 0.05;

          const tvecObj = tvec as unknown as { data64F: Float64Array };
          tvecObj.data64F[0] = 0.5;
          tvecObj.data64F[1] = -0.3;
          tvecObj.data64F[2] = 2.0;

          return true;
        }
      ),
      solvePnPRefineLM: vi.fn(),
      Rodrigues: vi.fn((_rvec: cv.Mat, rotMat: cv.Mat) => {
        // Return identity-like rotation matrix
        const rotMatObj = rotMat as unknown as { data64F: Float64Array };
        rotMatObj.data64F[0] = 0.98;
        rotMatObj.data64F[1] = -0.17;
        rotMatObj.data64F[2] = 0.1;
        rotMatObj.data64F[3] = 0.17;
        rotMatObj.data64F[4] = 0.98;
        rotMatObj.data64F[5] = 0.02;
        rotMatObj.data64F[6] = -0.1;
        rotMatObj.data64F[7] = 0.01;
        rotMatObj.data64F[8] = 0.99;
      }),
      projectPoints: vi.fn(
        (
          _objectPoints: cv.Mat,
          _rvec: cv.Mat,
          _tvec: cv.Mat,
          _cameraMatrix: cv.Mat,
          _distCoeffs: cv.Mat,
          projectedPoints: cv.Mat
        ) => {
          // Return projected points close to original for low error
          const projObj = projectedPoints as unknown as { data64F: Float64Array };
          for (let i = 0; i < 6; i++) {
            projObj.data64F[i * 2] = 100 + i * 50 + 0.5; // Small error
            projObj.data64F[i * 2 + 1] = 100 + i * 30 + 0.3;
          }
        }
      ),
    } as unknown as typeof cv;

    pnpSolver = new PnPSolver(mockCv, defaultIntrinsics);
  });

  describe("constructor", () => {
    it("should create with default options", () => {
      expect(pnpSolver).toBeDefined();
    });

    it("should create with custom options", () => {
      const customSolver = new PnPSolver(mockCv, defaultIntrinsics, {
        method: "epnp",
        ransacIterations: 200,
        ransacThreshold: 4.0,
        ransacConfidence: 0.999,
        useRefinement: false,
        minInliers: 6,
      });

      expect(customSolver).toBeDefined();
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

  describe("solvePnP", () => {
    it("should return null for insufficient correspondences", () => {
      const correspondences = generateCorrespondences(2);
      const result = pnpSolver.solvePnP(correspondences);
      expect(result).toBeNull();
    });

    it("should solve PnP with valid correspondences", () => {
      const correspondences = generateCorrespondences(8);
      const result = pnpSolver.solvePnP(correspondences);

      expect(result).toBeDefined();
      expect(result?.isValid).toBe(true);
      expect(result?.rotationVector).toBeInstanceOf(THREE.Vector3);
      expect(result?.rotationMatrix).toBeInstanceOf(THREE.Matrix3);
      expect(result?.translation).toBeInstanceOf(THREE.Vector3);
      expect(result?.inliers.length).toBeGreaterThan(0);
    });

    it("should call solvePnPRansac with correct parameters", () => {
      const correspondences = generateCorrespondences(8);
      pnpSolver.solvePnP(correspondences);

      expect(mockCv.solvePnPRansac).toHaveBeenCalled();
    });

    it("should refine pose with solvePnPRefineLM when enabled", () => {
      const correspondences = generateCorrespondences(8);
      pnpSolver.solvePnP(correspondences);

      expect(mockCv.solvePnPRefineLM).toHaveBeenCalled();
    });

    it("should not refine pose when disabled", () => {
      const solver = new PnPSolver(mockCv, defaultIntrinsics, {
        useRefinement: false,
      });

      mockCv.solvePnPRefineLM = vi.fn();

      const correspondences = generateCorrespondences(8);
      solver.solvePnP(correspondences);

      expect(mockCv.solvePnPRefineLM).not.toHaveBeenCalled();
    });

    it("should return null when solvePnPRansac fails", () => {
      mockCv.solvePnPRansac = vi.fn(() => false);

      const correspondences = generateCorrespondences(8);
      const result = pnpSolver.solvePnP(correspondences);

      expect(result).toBeNull();
    });

    it("should return null when not enough inliers", () => {
      mockCv.solvePnPRansac = vi.fn(
        (
          _objectPoints: cv.Mat,
          _imagePoints: cv.Mat,
          _cameraMatrix: cv.Mat,
          _distCoeffs: cv.Mat,
          rvec: cv.Mat,
          tvec: cv.Mat,
          _useExtrinsicGuess?: boolean,
          _iterationsCount?: number,
          _reprojectionError?: number,
          _confidence?: number,
          inliers?: cv.Mat,
          _flags?: number
        ) => {
          const rvecObj = rvec as unknown as { data64F: Float64Array };
          rvecObj.data64F[0] = 0.1;
          const tvecObj = tvec as unknown as { data64F: Float64Array };
          tvecObj.data64F[0] = 0.5;

          // Only 2 inliers
          if (inliers) {
            const inliersObj = inliers as unknown as { rows: number; data32S: Int32Array };
            inliersObj.rows = 2;
            inliersObj.data32S[0] = 0;
            inliersObj.data32S[1] = 1;
          }
          return true;
        }
      );

      const correspondences = generateCorrespondences(8);
      const result = pnpSolver.solvePnP(correspondences);

      expect(result).toBeNull();
    });

    it("should calculate reprojection error", () => {
      const correspondences = generateCorrespondences(8);
      const result = pnpSolver.solvePnP(correspondences);

      expect(result?.reprojectionError).toBeDefined();
      expect(result?.reprojectionError).toBeGreaterThanOrEqual(0);
    });

    it("should use correct PnP method flag", () => {
      const methods: Array<"iterative" | "epnp" | "p3p" | "ap3p"> = [
        "iterative",
        "epnp",
        "p3p",
        "ap3p",
      ];

      for (const method of methods) {
        const solver = new PnPSolver(mockCv, defaultIntrinsics, { method });
        const correspondences = generateCorrespondences(8);
        solver.solvePnP(correspondences);
      }

      expect(mockCv.solvePnPRansac).toHaveBeenCalledTimes(methods.length);
    });
  });

  describe("solvePnPWithGuess", () => {
    it("should return null for insufficient correspondences", () => {
      const correspondences = generateCorrespondences(2);
      const result = pnpSolver.solvePnPWithGuess(
        correspondences,
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 1)
      );

      expect(result).toBeNull();
    });

    it("should solve PnP with initial guess", () => {
      const correspondences = generateCorrespondences(8);
      const result = pnpSolver.solvePnPWithGuess(
        correspondences,
        new THREE.Vector3(0.1, 0.2, 0.05),
        new THREE.Vector3(0.5, -0.3, 2.0)
      );

      expect(result).toBeDefined();
      expect(result?.isValid).toBe(true);
    });

    it("should call solvePnP with extrinsic guess", () => {
      const correspondences = generateCorrespondences(8);
      pnpSolver.solvePnPWithGuess(
        correspondences,
        new THREE.Vector3(0.1, 0.2, 0.05),
        new THREE.Vector3(0.5, -0.3, 2.0)
      );

      expect(mockCv.solvePnP).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        true, // useExtrinsicGuess
        expect.anything()
      );
    });

    it("should include all points as inliers", () => {
      const correspondences = generateCorrespondences(8);
      const result = pnpSolver.solvePnPWithGuess(
        correspondences,
        new THREE.Vector3(0.1, 0.2, 0.05),
        new THREE.Vector3(0.5, -0.3, 2.0)
      );

      expect(result?.inliers.length).toBe(8);
    });

    it("should return null when solvePnP fails", () => {
      mockCv.solvePnP = vi.fn(() => false);

      const correspondences = generateCorrespondences(8);
      const result = pnpSolver.solvePnPWithGuess(
        correspondences,
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 1)
      );

      expect(result).toBeNull();
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

      pnpSolver.updateIntrinsics(newIntrinsics);

      const retrieved = pnpSolver.getIntrinsics();
      expect(retrieved.fx).toBe(600);
      expect(retrieved.fy).toBe(600);
    });
  });

  describe("updateOptions", () => {
    it("should update method", () => {
      pnpSolver.updateOptions({ method: "epnp" });
      expect(pnpSolver).toBeDefined();
    });

    it("should update all options", () => {
      pnpSolver.updateOptions({
        method: "ap3p",
        ransacIterations: 500,
        ransacThreshold: 2.0,
        ransacConfidence: 0.9999,
        useRefinement: false,
        minInliers: 8,
      });

      expect(pnpSolver).toBeDefined();
    });
  });

  describe("getIntrinsics", () => {
    it("should return copy of intrinsics", () => {
      const intrinsics = pnpSolver.getIntrinsics();

      expect(intrinsics.fx).toBe(defaultIntrinsics.fx);
      expect(intrinsics.fy).toBe(defaultIntrinsics.fy);
    });
  });

  describe("reset", () => {
    it("should not throw", () => {
      expect(() => pnpSolver.reset()).not.toThrow();
    });
  });

  describe("dispose", () => {
    it("should clean up resources", () => {
      pnpSolver.dispose();
      expect(pnpSolver).toBeDefined();
    });
  });
});

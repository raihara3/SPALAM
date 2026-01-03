import * as THREE from "three";
import type {
  CameraIntrinsics,
  Point2D3DCorrespondence,
  PnPResult,
} from "../types/Pose";

/**
 * PnP Solver Options
 */
export interface PnPSolverOptions {
  /** PnP method: "iterative" | "epnp" | "p3p" | "ap3p". Default: "iterative" */
  method?: "iterative" | "epnp" | "p3p" | "ap3p";
  /** Number of RANSAC iterations. Default: 100 */
  ransacIterations?: number;
  /** RANSAC reprojection error threshold in pixels. Default: 8.0 */
  ransacThreshold?: number;
  /** RANSAC confidence level (0-1). Default: 0.99 */
  ransacConfidence?: number;
  /** Use Levenberg-Marquardt refinement. Default: true */
  useRefinement?: boolean;
  /** Minimum inliers for valid result. Default: 4 */
  minInliers?: number;
}

/**
 * PnP Solver
 *
 * Solves the Perspective-n-Point problem to estimate camera pose
 * from 3D-2D point correspondences.
 *
 * Supports multiple methods:
 * - iterative: Iterative method (default)
 * - epnp: Efficient PnP
 * - p3p: 3-point algorithm (requires exactly 4 points for RANSAC)
 * - ap3p: Algebraic P3P
 */
export class PnPSolver {
  private cv: typeof cv;
  private intrinsics: CameraIntrinsics;
  private method: "iterative" | "epnp" | "p3p" | "ap3p";
  private ransacIterations: number;
  private ransacThreshold: number;
  private ransacConfidence: number;
  private useRefinement: boolean;
  private minInliers: number;
  private cameraMatrix: cv.Mat | null = null;
  private distCoeffs: cv.Mat | null = null;

  constructor(
    cvInstance: typeof cv,
    intrinsics: CameraIntrinsics,
    options?: PnPSolverOptions
  ) {
    this.cv = cvInstance;
    this.intrinsics = intrinsics;
    this.method = options?.method ?? "iterative";
    this.ransacIterations = options?.ransacIterations ?? 100;
    this.ransacThreshold = options?.ransacThreshold ?? 8.0;
    this.ransacConfidence = options?.ransacConfidence ?? 0.99;
    this.useRefinement = options?.useRefinement ?? true;
    this.minInliers = options?.minInliers ?? 4;

    this.initializeCameraParameters();
  }

  /**
   * Initialize camera matrix and distortion coefficients
   */
  private initializeCameraParameters(): void {
    if (this.cameraMatrix) {
      this.cameraMatrix.delete();
    }
    if (this.distCoeffs) {
      this.distCoeffs.delete();
    }

    this.cameraMatrix = this.cv.matFromArray(3, 3, this.cv.CV_64FC1, [
      this.intrinsics.fx, 0, this.intrinsics.cx,
      0, this.intrinsics.fy, this.intrinsics.cy,
      0, 0, 1,
    ]);

    // No distortion (assuming undistorted images)
    this.distCoeffs = this.cv.matFromArray(4, 1, this.cv.CV_64FC1, [0, 0, 0, 0]);
  }

  /**
   * Get OpenCV PnP method flag
   */
  private getMethodFlag(): number {
    switch (this.method) {
      case "epnp":
        return this.cv.SOLVEPNP_EPNP;
      case "p3p":
        return this.cv.SOLVEPNP_P3P;
      case "ap3p":
        return this.cv.SOLVEPNP_AP3P;
      case "iterative":
      default:
        return this.cv.SOLVEPNP_ITERATIVE;
    }
  }

  /**
   * Solve PnP problem from 3D-2D correspondences
   *
   * @param correspondences Array of 3D-2D point correspondences
   * @returns PnP result or null if failed
   */
  public solvePnP(correspondences: Point2D3DCorrespondence[]): PnPResult | null {
    if (correspondences.length < this.minInliers) {
      return null;
    }

    const numPoints = correspondences.length;
    const objectPoints = new this.cv.Mat(numPoints, 3, this.cv.CV_64FC1);
    const imagePoints = new this.cv.Mat(numPoints, 2, this.cv.CV_64FC1);
    const rvec = new this.cv.Mat();
    const tvec = new this.cv.Mat();
    const inliersMat = new this.cv.Mat();

    try {
      // Fill point arrays
      for (let i = 0; i < numPoints; i++) {
        const corr = correspondences[i];
        objectPoints.data64F[i * 3] = corr.point3D.x;
        objectPoints.data64F[i * 3 + 1] = corr.point3D.y;
        objectPoints.data64F[i * 3 + 2] = corr.point3D.z;
        imagePoints.data64F[i * 2] = corr.point2D.x;
        imagePoints.data64F[i * 2 + 1] = corr.point2D.y;
      }

      // Solve PnP with RANSAC
      const success = this.cv.solvePnPRansac(
        objectPoints,
        imagePoints,
        this.cameraMatrix!,
        this.distCoeffs!,
        rvec,
        tvec,
        false,
        this.ransacIterations,
        this.ransacThreshold,
        this.ransacConfidence,
        inliersMat,
        this.getMethodFlag()
      );

      if (!success || rvec.empty() || tvec.empty()) {
        return null;
      }

      // Get inlier indices
      const inliers: number[] = [];
      for (let i = 0; i < inliersMat.rows; i++) {
        inliers.push(inliersMat.data32S[i]);
      }

      if (inliers.length < this.minInliers) {
        return null;
      }

      // Refine pose if requested
      if (this.useRefinement && inliers.length >= 4) {
        this.refinePose(
          objectPoints,
          imagePoints,
          rvec,
          tvec,
          inliers
        );
      }

      // Convert rotation vector to matrix
      const rotationMatrix = this.rodriguesRotationToMatrix(rvec);

      // Extract translation
      const translation = new THREE.Vector3(
        tvec.data64F[0],
        tvec.data64F[1],
        tvec.data64F[2]
      );

      // Extract rotation vector
      const rotationVector = new THREE.Vector3(
        rvec.data64F[0],
        rvec.data64F[1],
        rvec.data64F[2]
      );

      // Calculate reprojection error
      const reprojectionError = this.calculateReprojectionError(
        correspondences,
        rvec,
        tvec,
        inliers
      );

      return {
        rotationVector,
        rotationMatrix,
        translation,
        inliers,
        reprojectionError,
        isValid: true,
      };
    } finally {
      objectPoints.delete();
      imagePoints.delete();
      rvec.delete();
      tvec.delete();
      inliersMat.delete();
    }
  }

  /**
   * Refine pose using Levenberg-Marquardt optimization
   */
  private refinePose(
    objectPoints: cv.Mat,
    imagePoints: cv.Mat,
    rvec: cv.Mat,
    tvec: cv.Mat,
    inliers: number[]
  ): void {
    if (inliers.length < 4) {
      return;
    }

    // Create inlier-only point arrays
    const numInliers = inliers.length;
    const inlierObjectPoints = new this.cv.Mat(numInliers, 3, this.cv.CV_64FC1);
    const inlierImagePoints = new this.cv.Mat(numInliers, 2, this.cv.CV_64FC1);

    try {
      for (let i = 0; i < numInliers; i++) {
        const idx = inliers[i];
        inlierObjectPoints.data64F[i * 3] = objectPoints.data64F[idx * 3];
        inlierObjectPoints.data64F[i * 3 + 1] = objectPoints.data64F[idx * 3 + 1];
        inlierObjectPoints.data64F[i * 3 + 2] = objectPoints.data64F[idx * 3 + 2];
        inlierImagePoints.data64F[i * 2] = imagePoints.data64F[idx * 2];
        inlierImagePoints.data64F[i * 2 + 1] = imagePoints.data64F[idx * 2 + 1];
      }

      // Refine using LM
      this.cv.solvePnPRefineLM(
        inlierObjectPoints,
        inlierImagePoints,
        this.cameraMatrix!,
        this.distCoeffs!,
        rvec,
        tvec
      );
    } finally {
      inlierObjectPoints.delete();
      inlierImagePoints.delete();
    }
  }

  /**
   * Convert Rodrigues rotation vector to rotation matrix
   */
  private rodriguesRotationToMatrix(rvec: cv.Mat): THREE.Matrix3 {
    const rotMat = new this.cv.Mat();

    try {
      this.cv.Rodrigues(rvec, rotMat);

      const rotation = new THREE.Matrix3();
      rotation.set(
        rotMat.data64F[0], rotMat.data64F[1], rotMat.data64F[2],
        rotMat.data64F[3], rotMat.data64F[4], rotMat.data64F[5],
        rotMat.data64F[6], rotMat.data64F[7], rotMat.data64F[8]
      );

      return rotation;
    } finally {
      rotMat.delete();
    }
  }

  /**
   * Calculate RMS reprojection error
   */
  private calculateReprojectionError(
    correspondences: Point2D3DCorrespondence[],
    rvec: cv.Mat,
    tvec: cv.Mat,
    inliers: number[]
  ): number {
    if (inliers.length === 0) {
      return Infinity;
    }

    // Create object points for inliers
    const numInliers = inliers.length;
    const objectPoints = new this.cv.Mat(numInliers, 3, this.cv.CV_64FC1);
    const projectedPoints = new this.cv.Mat();

    try {
      for (let i = 0; i < numInliers; i++) {
        const corr = correspondences[inliers[i]];
        objectPoints.data64F[i * 3] = corr.point3D.x;
        objectPoints.data64F[i * 3 + 1] = corr.point3D.y;
        objectPoints.data64F[i * 3 + 2] = corr.point3D.z;
      }

      // Project points
      this.cv.projectPoints(
        objectPoints,
        rvec,
        tvec,
        this.cameraMatrix!,
        this.distCoeffs!,
        projectedPoints
      );

      // Calculate RMS error
      let sumSquaredError = 0;
      for (let i = 0; i < numInliers; i++) {
        const corr = correspondences[inliers[i]];
        const projX = projectedPoints.data64F[i * 2];
        const projY = projectedPoints.data64F[i * 2 + 1];
        const dx = projX - corr.point2D.x;
        const dy = projY - corr.point2D.y;
        sumSquaredError += dx * dx + dy * dy;
      }

      return Math.sqrt(sumSquaredError / numInliers);
    } finally {
      objectPoints.delete();
      projectedPoints.delete();
    }
  }

  /**
   * Solve PnP with initial pose guess
   *
   * @param correspondences 3D-2D correspondences
   * @param initialPose Initial pose estimate
   * @returns Refined PnP result
   */
  public solvePnPWithGuess(
    correspondences: Point2D3DCorrespondence[],
    initialRotation: THREE.Vector3,
    initialTranslation: THREE.Vector3
  ): PnPResult | null {
    if (correspondences.length < this.minInliers) {
      return null;
    }

    const numPoints = correspondences.length;
    const objectPoints = new this.cv.Mat(numPoints, 3, this.cv.CV_64FC1);
    const imagePoints = new this.cv.Mat(numPoints, 2, this.cv.CV_64FC1);
    const rvec = this.cv.matFromArray(3, 1, this.cv.CV_64FC1, [
      initialRotation.x,
      initialRotation.y,
      initialRotation.z,
    ]);
    const tvec = this.cv.matFromArray(3, 1, this.cv.CV_64FC1, [
      initialTranslation.x,
      initialTranslation.y,
      initialTranslation.z,
    ]);

    try {
      // Fill point arrays
      for (let i = 0; i < numPoints; i++) {
        const corr = correspondences[i];
        objectPoints.data64F[i * 3] = corr.point3D.x;
        objectPoints.data64F[i * 3 + 1] = corr.point3D.y;
        objectPoints.data64F[i * 3 + 2] = corr.point3D.z;
        imagePoints.data64F[i * 2] = corr.point2D.x;
        imagePoints.data64F[i * 2 + 1] = corr.point2D.y;
      }

      // Solve PnP with initial guess
      const success = this.cv.solvePnP(
        objectPoints,
        imagePoints,
        this.cameraMatrix!,
        this.distCoeffs!,
        rvec,
        tvec,
        true, // Use extrinsic guess
        this.getMethodFlag()
      );

      if (!success) {
        return null;
      }

      // Refine pose
      if (this.useRefinement) {
        this.cv.solvePnPRefineLM(
          objectPoints,
          imagePoints,
          this.cameraMatrix!,
          this.distCoeffs!,
          rvec,
          tvec
        );
      }

      // Convert rotation vector to matrix
      const rotationMatrix = this.rodriguesRotationToMatrix(rvec);

      // All points are considered inliers for non-RANSAC
      const inliers = Array.from({ length: numPoints }, (_, i) => i);

      // Calculate reprojection error
      const reprojectionError = this.calculateReprojectionError(
        correspondences,
        rvec,
        tvec,
        inliers
      );

      return {
        rotationVector: new THREE.Vector3(rvec.data64F[0], rvec.data64F[1], rvec.data64F[2]),
        rotationMatrix,
        translation: new THREE.Vector3(tvec.data64F[0], tvec.data64F[1], tvec.data64F[2]),
        inliers,
        reprojectionError,
        isValid: true,
      };
    } finally {
      objectPoints.delete();
      imagePoints.delete();
      rvec.delete();
      tvec.delete();
    }
  }

  /**
   * Update camera intrinsics
   */
  public updateIntrinsics(intrinsics: CameraIntrinsics): void {
    this.intrinsics = intrinsics;
    this.initializeCameraParameters();
  }

  /**
   * Update options
   */
  public updateOptions(options: Partial<PnPSolverOptions>): void {
    if (options.method !== undefined) {
      this.method = options.method;
    }
    if (options.ransacIterations !== undefined) {
      this.ransacIterations = options.ransacIterations;
    }
    if (options.ransacThreshold !== undefined) {
      this.ransacThreshold = options.ransacThreshold;
    }
    if (options.ransacConfidence !== undefined) {
      this.ransacConfidence = options.ransacConfidence;
    }
    if (options.useRefinement !== undefined) {
      this.useRefinement = options.useRefinement;
    }
    if (options.minInliers !== undefined) {
      this.minInliers = options.minInliers;
    }
  }

  /**
   * Get current intrinsics
   */
  public getIntrinsics(): CameraIntrinsics {
    return { ...this.intrinsics };
  }

  /**
   * Reset state
   */
  public reset(): void {
    // No stateful data to reset
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    if (this.cameraMatrix) {
      this.cameraMatrix.delete();
      this.cameraMatrix = null;
    }
    if (this.distCoeffs) {
      this.distCoeffs.delete();
      this.distCoeffs = null;
    }
  }
}

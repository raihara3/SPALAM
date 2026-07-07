/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import type {
  CameraPose,
  CameraIntrinsics,
  TriangulationResult,
} from "../types/Pose";

/**
 * Triangulator Options
 */
export interface TriangulatorOptions {
  /** Minimum parallax angle in radians. Default: 0.01 (~0.57 degrees) */
  minParallax?: number;
  /** Maximum reprojection error in pixels. Default: 4.0 */
  maxReprojectionError?: number;
  /** Maximum depth for valid points. Default: 100 */
  maxDepth?: number;
  /** Minimum depth for valid points. Default: 0.1 */
  minDepth?: number;
}

/**
 * Triangulator
 *
 * Triangulates 3D points from 2D point correspondences in two views
 * using OpenCV's triangulatePoints function.
 *
 * The triangulation process:
 * 1. Build projection matrices from camera poses
 * 2. Triangulate using DLT (Direct Linear Transform)
 * 3. Filter by parallax angle, reprojection error, and depth
 */
export class Triangulator {
  private cv: typeof cv;
  private intrinsics: CameraIntrinsics;
  private minParallax: number;
  private maxReprojectionError: number;
  private maxDepth: number;
  private minDepth: number;
  private cameraMatrix: cv.Mat | null = null;

  constructor(
    cvInstance: typeof cv,
    intrinsics: CameraIntrinsics,
    options?: TriangulatorOptions
  ) {
    this.cv = cvInstance;
    this.intrinsics = intrinsics;
    this.minParallax = options?.minParallax ?? 0.01;
    this.maxReprojectionError = options?.maxReprojectionError ?? 4.0;
    this.maxDepth = options?.maxDepth ?? 100;
    this.minDepth = options?.minDepth ?? 0.1;

    this.initializeCameraMatrix();
  }

  /**
   * Initialize camera matrix from intrinsics
   */
  private initializeCameraMatrix(): void {
    if (this.cameraMatrix) {
      this.cameraMatrix.delete();
    }

    this.cameraMatrix = this.cv.matFromArray(3, 3, this.cv.CV_64FC1, [
      this.intrinsics.fx, 0, this.intrinsics.cx,
      0, this.intrinsics.fy, this.intrinsics.cy,
      0, 0, 1,
    ]);
  }

  /**
   * Build projection matrix from camera pose (camera-to-world convention)
   *
   * The pose holds the camera orientation R_wc and camera center C, so the
   * projection extrinsics are R = R_wc^T and t = -R_wc^T * C, giving
   * P = K * [R_wc^T | -R_wc^T * C].
   */
  private buildProjectionMatrix(pose: CameraPose): cv.Mat {
    // THREE.Matrix3.elements is column-major: elements[0,3,6] is row 0.
    // Rows of R_wc^T are the columns of R_wc.
    const R = pose.rotation.elements;
    const C = pose.translation;

    const t = {
      x: -(R[0] * C.x + R[1] * C.y + R[2] * C.z),
      y: -(R[3] * C.x + R[4] * C.y + R[5] * C.z),
      z: -(R[6] * C.x + R[7] * C.y + R[8] * C.z),
    };

    // Create [R_wc^T | t] matrix (3x4)
    const Rt = this.cv.matFromArray(3, 4, this.cv.CV_64FC1, [
      R[0], R[1], R[2], t.x,
      R[3], R[4], R[5], t.y,
      R[6], R[7], R[8], t.z,
    ]);

    // Compute P = K * [R_wc^T | t]
    const P = new this.cv.Mat();
    const emptyOperand = new this.cv.Mat();
    this.cv.gemm(this.cameraMatrix!, Rt, 1, emptyOperand, 0, P);

    emptyOperand.delete();
    Rt.delete();

    return P;
  }

  /**
   * Triangulate 3D points from 2D correspondences
   *
   * @param points1 Points in first image
   * @param points2 Corresponding points in second image
   * @param pose1 Camera pose for first view (typically identity)
   * @param pose2 Camera pose for second view
   * @param ids Optional point IDs
   * @returns Array of triangulation results
   */
  public triangulate(
    points1: Array<{ x: number; y: number }>,
    points2: Array<{ x: number; y: number }>,
    pose1: CameraPose,
    pose2: CameraPose,
    ids?: string[]
  ): TriangulationResult[] {
    if (points1.length === 0 || points1.length !== points2.length) {
      return [];
    }

    const numPoints = points1.length;
    const results: TriangulationResult[] = [];

    // Build projection matrices
    const P1 = this.buildProjectionMatrix(pose1);
    const P2 = this.buildProjectionMatrix(pose2);

    // Create point matrices (2xN format for triangulatePoints)
    const pts1Mat = new this.cv.Mat(2, numPoints, this.cv.CV_64FC1);
    const pts2Mat = new this.cv.Mat(2, numPoints, this.cv.CV_64FC1);
    const points4D = new this.cv.Mat();

    try {
      // Fill point matrices (column-major 2xN)
      for (let i = 0; i < numPoints; i++) {
        pts1Mat.data64F[i] = points1[i].x;
        pts1Mat.data64F[numPoints + i] = points1[i].y;
        pts2Mat.data64F[i] = points2[i].x;
        pts2Mat.data64F[numPoints + i] = points2[i].y;
      }

      // Triangulate
      this.cv.triangulatePoints(P1, P2, pts1Mat, pts2Mat, points4D);

      // Process results
      for (let i = 0; i < numPoints; i++) {
        // Convert from homogeneous coordinates (4xN column-major)
        const x4 = points4D.data32F[i];
        const y4 = points4D.data32F[numPoints + i];
        const z4 = points4D.data32F[numPoints * 2 + i];
        const w4 = points4D.data32F[numPoints * 3 + i];

        if (Math.abs(w4) < 1e-10) {
          // Point at infinity
          results.push({
            point3D: new THREE.Vector3(0, 0, 0),
            reprojectionError: Infinity,
            parallaxAngle: 0,
            isValid: false,
            id: ids?.[i],
          });
          continue;
        }

        // Dehomogenize
        const point3D = new THREE.Vector3(x4 / w4, y4 / w4, z4 / w4);

        // Calculate parallax angle
        const ray1 = point3D.clone().sub(pose1.translation).normalize();
        const ray2 = point3D.clone().sub(pose2.translation).normalize();
        const parallaxAngle = Math.acos(
          Math.max(-1, Math.min(1, ray1.dot(ray2)))
        );

        // Calculate reprojection error
        const reprojError = this.calculateReprojectionError(
          point3D,
          points1[i],
          points2[i],
          pose1,
          pose2
        );

        // Check depth in both cameras
        const depth1 = this.calculateDepth(point3D, pose1);
        const depth2 = this.calculateDepth(point3D, pose2);

        // Validate result
        const isValid =
          parallaxAngle >= this.minParallax &&
          reprojError <= this.maxReprojectionError &&
          depth1 >= this.minDepth &&
          depth1 <= this.maxDepth &&
          depth2 >= this.minDepth &&
          depth2 <= this.maxDepth;

        results.push({
          point3D,
          reprojectionError: reprojError,
          parallaxAngle,
          isValid,
          id: ids?.[i],
        });
      }

      return results;
    } finally {
      P1.delete();
      P2.delete();
      pts1Mat.delete();
      pts2Mat.delete();
      points4D.delete();
    }
  }

  /**
   * Calculate depth of 3D point in camera frame
   */
  private calculateDepth(point3D: THREE.Vector3, pose: CameraPose): number {
    // Transform point to camera frame
    const R = pose.rotation;
    const t = pose.translation;

    // Point in camera frame = R * (P - t) or R * P + t depending on convention
    // Using P_cam = R^T * (P_world - t)
    const relativePoint = point3D.clone().sub(t);
    const Rinv = R.clone().transpose();

    const pointInCamera = new THREE.Vector3(
      Rinv.elements[0] * relativePoint.x +
        Rinv.elements[3] * relativePoint.y +
        Rinv.elements[6] * relativePoint.z,
      Rinv.elements[1] * relativePoint.x +
        Rinv.elements[4] * relativePoint.y +
        Rinv.elements[7] * relativePoint.z,
      Rinv.elements[2] * relativePoint.x +
        Rinv.elements[5] * relativePoint.y +
        Rinv.elements[8] * relativePoint.z
    );

    return pointInCamera.z;
  }

  /**
   * Calculate reprojection error for a 3D point
   */
  private calculateReprojectionError(
    point3D: THREE.Vector3,
    observed1: { x: number; y: number },
    observed2: { x: number; y: number },
    pose1: CameraPose,
    pose2: CameraPose
  ): number {
    // Project to first camera
    const proj1 = this.projectPoint(point3D, pose1);
    const error1 = Math.sqrt(
      Math.pow(proj1.x - observed1.x, 2) + Math.pow(proj1.y - observed1.y, 2)
    );

    // Project to second camera
    const proj2 = this.projectPoint(point3D, pose2);
    const error2 = Math.sqrt(
      Math.pow(proj2.x - observed2.x, 2) + Math.pow(proj2.y - observed2.y, 2)
    );

    // Return average error
    return (error1 + error2) / 2;
  }

  /**
   * Project 3D point to image coordinates
   */
  private projectPoint(
    point3D: THREE.Vector3,
    pose: CameraPose
  ): { x: number; y: number } {
    const R = pose.rotation;
    const t = pose.translation;

    // Transform to camera frame
    const relativePoint = point3D.clone().sub(t);
    const Rinv = R.clone().transpose();

    const x = Rinv.elements[0] * relativePoint.x +
      Rinv.elements[3] * relativePoint.y +
      Rinv.elements[6] * relativePoint.z;
    const y = Rinv.elements[1] * relativePoint.x +
      Rinv.elements[4] * relativePoint.y +
      Rinv.elements[7] * relativePoint.z;
    const z = Rinv.elements[2] * relativePoint.x +
      Rinv.elements[5] * relativePoint.y +
      Rinv.elements[8] * relativePoint.z;

    if (z <= 0) {
      return { x: Infinity, y: Infinity };
    }

    // Project using intrinsics
    const u = this.intrinsics.fx * (x / z) + this.intrinsics.cx;
    const v = this.intrinsics.fy * (y / z) + this.intrinsics.cy;

    return { x: u, y: v };
  }

  /**
   * Filter triangulation results by quality
   *
   * @param results Triangulation results to filter
   * @returns Filtered results (only valid ones)
   */
  public filterByQuality(results: TriangulationResult[]): TriangulationResult[] {
    return results.filter((r) => r.isValid);
  }

  /**
   * Triangulate single point
   *
   * @param point1 Point in first image
   * @param point2 Corresponding point in second image
   * @param pose1 Camera pose for first view
   * @param pose2 Camera pose for second view
   * @param id Optional point ID
   * @returns Triangulation result
   */
  public triangulateSingle(
    point1: { x: number; y: number },
    point2: { x: number; y: number },
    pose1: CameraPose,
    pose2: CameraPose,
    id?: string
  ): TriangulationResult {
    const results = this.triangulate(
      [point1],
      [point2],
      pose1,
      pose2,
      id ? [id] : undefined
    );

    return (
      results[0] ?? {
        point3D: new THREE.Vector3(0, 0, 0),
        reprojectionError: Infinity,
        parallaxAngle: 0,
        isValid: false,
        id,
      }
    );
  }

  /**
   * Calculate baseline distance between two poses
   */
  public calculateBaseline(pose1: CameraPose, pose2: CameraPose): number {
    return pose1.translation.distanceTo(pose2.translation);
  }

  /**
   * Check if baseline is sufficient for triangulation
   *
   * @param pose1 First camera pose
   * @param pose2 Second camera pose
   * @param minBaseline Minimum required baseline
   */
  public hasSufficientBaseline(
    pose1: CameraPose,
    pose2: CameraPose,
    minBaseline: number = 0.01
  ): boolean {
    return this.calculateBaseline(pose1, pose2) >= minBaseline;
  }

  /**
   * Update camera intrinsics
   */
  public updateIntrinsics(intrinsics: CameraIntrinsics): void {
    this.intrinsics = intrinsics;
    this.initializeCameraMatrix();
  }

  /**
   * Update options
   */
  public updateOptions(options: Partial<TriangulatorOptions>): void {
    if (options.minParallax !== undefined) {
      this.minParallax = options.minParallax;
    }
    if (options.maxReprojectionError !== undefined) {
      this.maxReprojectionError = options.maxReprojectionError;
    }
    if (options.maxDepth !== undefined) {
      this.maxDepth = options.maxDepth;
    }
    if (options.minDepth !== undefined) {
      this.minDepth = options.minDepth;
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
  }
}

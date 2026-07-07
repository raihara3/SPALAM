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
 * Two-View Triangulator Options
 */
export interface TwoViewTriangulatorOptions {
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
 * Two-View Triangulator (pure TypeScript)
 *
 * Linear two-view triangulation with the same quality gates as the
 * OpenCV-based Triangulator. Exists because stock OpenCV.js builds do not
 * whitelist cv.triangulatePoints (nor findEssentialMat/recoverPose), so
 * landmark replenishment must not depend on it.
 *
 * Poses use the camera-to-world convention (rotation R_wc, camera center
 * C). For each view, the camera-frame coordinates of a world point P are
 * x_cam = R_wc^T (P - C) = A P + b with A = R_wc^T and b = -R_wc^T C.
 * With normalized image coordinates (u', v'), each view contributes two
 * linear equations in P:
 *
 *   (A_1 - u' A_3) P = u' b_3 - b_1
 *   (A_2 - v' A_3) P = v' b_3 - b_2
 *
 * Two views give four equations for three unknowns, solved via normal
 * equations. This assumes points at finite depth, which the depth gates
 * enforce anyway.
 */
export class TwoViewTriangulator {
  private intrinsics: CameraIntrinsics;
  private readonly minParallax: number;
  private readonly maxReprojectionError: number;
  private readonly maxDepth: number;
  private readonly minDepth: number;

  constructor(
    intrinsics: CameraIntrinsics,
    options?: TwoViewTriangulatorOptions
  ) {
    this.intrinsics = intrinsics;
    this.minParallax = options?.minParallax ?? 0.01;
    this.maxReprojectionError = options?.maxReprojectionError ?? 4.0;
    this.maxDepth = options?.maxDepth ?? 100;
    this.minDepth = options?.minDepth ?? 0.1;
  }

  /**
   * Triangulate 3D points from 2D correspondences in two views
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

    const view1 = this.buildViewEquationBasis(pose1);
    const view2 = this.buildViewEquationBasis(pose2);
    const results: TriangulationResult[] = [];

    for (let i = 0; i < points1.length; i++) {
      const point3D = this.solvePoint(points1[i], points2[i], view1, view2);
      if (!point3D) {
        results.push(this.invalidResult(ids?.[i]));
        continue;
      }

      const depth1 = this.depthInCamera(point3D, view1);
      const depth2 = this.depthInCamera(point3D, view2);

      const ray1 = point3D.clone().sub(pose1.translation).normalize();
      const ray2 = point3D.clone().sub(pose2.translation).normalize();
      const parallaxAngle = Math.acos(
        Math.max(-1, Math.min(1, ray1.dot(ray2)))
      );

      const error1 = this.reprojectionError(point3D, points1[i], view1);
      const error2 = this.reprojectionError(point3D, points2[i], view2);
      const reprojectionError = (error1 + error2) / 2;

      const isValid =
        Number.isFinite(reprojectionError) &&
        parallaxAngle >= this.minParallax &&
        reprojectionError <= this.maxReprojectionError &&
        depth1 >= this.minDepth &&
        depth1 <= this.maxDepth &&
        depth2 >= this.minDepth &&
        depth2 <= this.maxDepth;

      results.push({
        point3D,
        reprojectionError,
        parallaxAngle,
        isValid,
        id: ids?.[i],
      });
    }

    return results;
  }

  /**
   * Update camera intrinsics
   */
  public updateIntrinsics(intrinsics: CameraIntrinsics): void {
    this.intrinsics = intrinsics;
  }

  /**
   * Dispose resources (no OpenCV state; provided for interface parity)
   */
  public dispose(): void {}

  /** Rows of A = R_wc^T and vector b = -R_wc^T C for one view */
  private buildViewEquationBasis(pose: CameraPose): {
    a1: THREE.Vector3;
    a2: THREE.Vector3;
    a3: THREE.Vector3;
    b: THREE.Vector3;
  } {
    // THREE.Matrix3.elements is column-major: rows of R_wc^T are the
    // columns of R_wc
    const R = pose.rotation.elements;
    const a1 = new THREE.Vector3(R[0], R[1], R[2]);
    const a2 = new THREE.Vector3(R[3], R[4], R[5]);
    const a3 = new THREE.Vector3(R[6], R[7], R[8]);
    const C = pose.translation;
    const b = new THREE.Vector3(-a1.dot(C), -a2.dot(C), -a3.dot(C));
    return { a1, a2, a3, b };
  }

  private solvePoint(
    point1: { x: number; y: number },
    point2: { x: number; y: number },
    view1: ReturnType<TwoViewTriangulator["buildViewEquationBasis"]>,
    view2: ReturnType<TwoViewTriangulator["buildViewEquationBasis"]>
  ): THREE.Vector3 | null {
    const { fx, fy, cx, cy } = this.intrinsics;

    // Accumulate normal equations M P = r from the four linear equations
    const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const r = [0, 0, 0];
    const accumulate = (row: THREE.Vector3, value: number) => {
      M[0] += row.x * row.x;
      M[1] += row.x * row.y;
      M[2] += row.x * row.z;
      M[4] += row.y * row.y;
      M[5] += row.y * row.z;
      M[8] += row.z * row.z;
      r[0] += row.x * value;
      r[1] += row.y * value;
      r[2] += row.z * value;
    };

    const addView = (
      view: ReturnType<TwoViewTriangulator["buildViewEquationBasis"]>,
      point: { x: number; y: number }
    ) => {
      const u = (point.x - cx) / fx;
      const v = (point.y - cy) / fy;
      const rowU = view.a1.clone().addScaledVector(view.a3, -u);
      const rowV = view.a2.clone().addScaledVector(view.a3, -v);
      accumulate(rowU, u * view.b.z - view.b.x);
      accumulate(rowV, v * view.b.z - view.b.y);
    };

    addView(view1, point1);
    addView(view2, point2);
    M[3] = M[1];
    M[6] = M[2];
    M[7] = M[5];

    // Solve the symmetric 3x3 system via Cramer's rule
    const det =
      M[0] * (M[4] * M[8] - M[5] * M[7]) -
      M[1] * (M[3] * M[8] - M[5] * M[6]) +
      M[2] * (M[3] * M[7] - M[4] * M[6]);
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
      return null;
    }

    const solveColumn = (column: number) => {
      const A = [...M];
      A[column] = r[0];
      A[column + 3] = r[1];
      A[column + 6] = r[2];
      return (
        (A[0] * (A[4] * A[8] - A[5] * A[7]) -
          A[1] * (A[3] * A[8] - A[5] * A[6]) +
          A[2] * (A[3] * A[7] - A[4] * A[6])) /
        det
      );
    };

    const point = new THREE.Vector3(
      solveColumn(0),
      solveColumn(1),
      solveColumn(2)
    );
    return Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      Number.isFinite(point.z)
      ? point
      : null;
  }

  private depthInCamera(
    point3D: THREE.Vector3,
    view: ReturnType<TwoViewTriangulator["buildViewEquationBasis"]>
  ): number {
    return view.a3.dot(point3D) + view.b.z;
  }

  private reprojectionError(
    point3D: THREE.Vector3,
    observed: { x: number; y: number },
    view: ReturnType<TwoViewTriangulator["buildViewEquationBasis"]>
  ): number {
    const x = view.a1.dot(point3D) + view.b.x;
    const y = view.a2.dot(point3D) + view.b.y;
    const z = view.a3.dot(point3D) + view.b.z;
    if (z <= 0) {
      return Infinity;
    }
    const u = this.intrinsics.fx * (x / z) + this.intrinsics.cx;
    const v = this.intrinsics.fy * (y / z) + this.intrinsics.cy;
    return Math.hypot(u - observed.x, v - observed.y);
  }

  private invalidResult(id?: string): TriangulationResult {
    return {
      point3D: new THREE.Vector3(0, 0, 0),
      reprojectionError: Infinity,
      parallaxAngle: 0,
      isValid: false,
      id,
    };
  }
}

/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import type {
  CameraPose,
  CameraIntrinsics,
  EssentialMatrixResult,
  PoseRecoveryResult,
  FeatureMatch,
} from "../types/Pose";
import type { Feature } from "../types/Feature";

/**
 * Pose Estimator Options
 */
export interface PoseEstimatorOptions {
  /** RANSAC probability (0-1). Default: 0.999 */
  ransacProbability?: number;
  /** RANSAC threshold in pixels. Default: 1.0 */
  ransacThreshold?: number;
  /** Minimum inliers for valid estimation. Default: 8 */
  minInliers?: number;
  /** Maximum RANSAC iterations. Default: 500 */
  maxIterations?: number;
  /** Use 5-point algorithm. Default: true */
  use5Point?: boolean;
}

/**
 * Pose Estimator
 *
 * Estimates relative camera pose from 2D-2D point correspondences using
 * Essential Matrix computation with RANSAC and pose recovery.
 *
 * Pipeline:
 * 1. Normalize points using camera intrinsics
 * 2. Find Essential Matrix with RANSAC (5-point algorithm)
 * 3. Recover rotation and translation from Essential Matrix
 * 4. Select correct pose using cheirality check
 */
export class PoseEstimator {
  private cv: typeof cv;
  private intrinsics: CameraIntrinsics;
  private ransacProbability: number;
  private ransacThreshold: number;
  private minInliers: number;
  private maxIterations: number;
  private use5Point: boolean;
  private cameraMatrix: cv.Mat | null = null;

  constructor(
    cvInstance: typeof cv,
    intrinsics: CameraIntrinsics,
    options?: PoseEstimatorOptions
  ) {
    this.cv = cvInstance;
    this.intrinsics = intrinsics;
    this.ransacProbability = options?.ransacProbability ?? 0.999;
    this.ransacThreshold = options?.ransacThreshold ?? 1.0;
    this.minInliers = options?.minInliers ?? 8;
    this.maxIterations = options?.maxIterations ?? 500;
    this.use5Point = options?.use5Point ?? true;

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
   * Find Essential Matrix from point correspondences
   *
   * @param points1 Points from first image
   * @param points2 Corresponding points from second image
   * @returns Essential matrix result or null if failed
   */
  public findEssentialMatrix(
    points1: Array<{ x: number; y: number }>,
    points2: Array<{ x: number; y: number }>
  ): EssentialMatrixResult | null {
    if (points1.length < 5 || points2.length < 5) {
      return null;
    }

    if (points1.length !== points2.length) {
      return null;
    }

    const numPoints = points1.length;
    const pts1Mat = new this.cv.Mat(numPoints, 1, this.cv.CV_32FC2);
    const pts2Mat = new this.cv.Mat(numPoints, 1, this.cv.CV_32FC2);
    const mask = new this.cv.Mat();

    try {
      // Fill point matrices
      for (let i = 0; i < numPoints; i++) {
        pts1Mat.data32F[i * 2] = points1[i].x;
        pts1Mat.data32F[i * 2 + 1] = points1[i].y;
        pts2Mat.data32F[i * 2] = points2[i].x;
        pts2Mat.data32F[i * 2 + 1] = points2[i].y;
      }

      // Find essential matrix with RANSAC
      const method = this.use5Point ? this.cv.RANSAC : this.cv.LMEDS;
      const essentialMat = this.cv.findEssentialMat(
        pts1Mat,
        pts2Mat,
        this.cameraMatrix!,
        method,
        this.ransacProbability,
        this.ransacThreshold,
        this.maxIterations,
        mask
      );

      if (essentialMat.empty()) {
        return null;
      }

      // Convert to THREE.Matrix3
      const essentialMatrix = new THREE.Matrix3();
      essentialMatrix.set(
        essentialMat.data64F[0], essentialMat.data64F[1], essentialMat.data64F[2],
        essentialMat.data64F[3], essentialMat.data64F[4], essentialMat.data64F[5],
        essentialMat.data64F[6], essentialMat.data64F[7], essentialMat.data64F[8]
      );

      // Count inliers
      const inlierMask: boolean[] = [];
      let inlierCount = 0;
      for (let i = 0; i < numPoints; i++) {
        const isInlier = mask.data[i] !== 0;
        inlierMask.push(isInlier);
        if (isInlier) {
          inlierCount++;
        }
      }

      essentialMat.delete();

      const isValid = inlierCount >= this.minInliers;

      return {
        essentialMatrix,
        inlierMask,
        inlierCount,
        isValid,
      };
    } finally {
      pts1Mat.delete();
      pts2Mat.delete();
      mask.delete();
    }
  }

  /**
   * Recover pose from Essential Matrix
   *
   * @param essentialMatrix Essential matrix
   * @param points1 Points from first image
   * @param points2 Corresponding points from second image
   * @param inlierMask Optional inlier mask from Essential Matrix estimation
   * @returns Pose recovery result or null if failed
   */
  public recoverPose(
    essentialMatrix: THREE.Matrix3,
    points1: Array<{ x: number; y: number }>,
    points2: Array<{ x: number; y: number }>,
    inlierMask?: boolean[]
  ): PoseRecoveryResult | null {
    if (points1.length < 5 || points2.length < 5) {
      return null;
    }

    // Filter by inlier mask if provided
    const filteredPts1: Array<{ x: number; y: number }> = [];
    const filteredPts2: Array<{ x: number; y: number }> = [];

    if (inlierMask) {
      for (let i = 0; i < points1.length; i++) {
        if (inlierMask[i]) {
          filteredPts1.push(points1[i]);
          filteredPts2.push(points2[i]);
        }
      }
    } else {
      filteredPts1.push(...points1);
      filteredPts2.push(...points2);
    }

    if (filteredPts1.length < 5) {
      return null;
    }

    const numPoints = filteredPts1.length;
    const pts1Mat = new this.cv.Mat(numPoints, 1, this.cv.CV_32FC2);
    const pts2Mat = new this.cv.Mat(numPoints, 1, this.cv.CV_32FC2);
    const essentialMat = this.cv.matFromArray(3, 3, this.cv.CV_64FC1,
      essentialMatrix.elements
    );
    const rotationMat = new this.cv.Mat();
    const translationMat = new this.cv.Mat();
    const mask = new this.cv.Mat();

    try {
      // Fill point matrices
      for (let i = 0; i < numPoints; i++) {
        pts1Mat.data32F[i * 2] = filteredPts1[i].x;
        pts1Mat.data32F[i * 2 + 1] = filteredPts1[i].y;
        pts2Mat.data32F[i * 2] = filteredPts2[i].x;
        pts2Mat.data32F[i * 2 + 1] = filteredPts2[i].y;
      }

      // Recover pose (rotation and translation)
      const inFrontCount = this.cv.recoverPose(
        essentialMat,
        pts1Mat,
        pts2Mat,
        this.cameraMatrix!,
        rotationMat,
        translationMat,
        mask
      );

      if (rotationMat.empty() || translationMat.empty()) {
        return null;
      }

      // Convert rotation matrix to THREE.Matrix3
      const rotation = new THREE.Matrix3();
      rotation.set(
        rotationMat.data64F[0], rotationMat.data64F[1], rotationMat.data64F[2],
        rotationMat.data64F[3], rotationMat.data64F[4], rotationMat.data64F[5],
        rotationMat.data64F[6], rotationMat.data64F[7], rotationMat.data64F[8]
      );

      // Convert translation to THREE.Vector3 (unit vector)
      const translation = new THREE.Vector3(
        translationMat.data64F[0],
        translationMat.data64F[1],
        translationMat.data64F[2]
      );

      return {
        rotation,
        translation,
        inFrontCount,
        isValid: inFrontCount >= this.minInliers,
      };
    } finally {
      pts1Mat.delete();
      pts2Mat.delete();
      essentialMat.delete();
      rotationMat.delete();
      translationMat.delete();
      mask.delete();
    }
  }

  /**
   * Estimate relative pose from 2D-2D correspondences
   *
   * Combines Essential Matrix estimation and pose recovery.
   *
   * @param points1 Points from first image
   * @param points2 Corresponding points from second image
   * @param timestamp Timestamp for the pose
   * @returns Camera pose or null if estimation failed
   */
  public estimatePose(
    points1: Array<{ x: number; y: number }>,
    points2: Array<{ x: number; y: number }>,
    timestamp: number
  ): CameraPose | null {
    // Find Essential Matrix
    const essentialResult = this.findEssentialMatrix(points1, points2);
    if (!essentialResult || !essentialResult.isValid) {
      return null;
    }

    // Recover pose
    const poseResult = this.recoverPose(
      essentialResult.essentialMatrix,
      points1,
      points2,
      essentialResult.inlierMask
    );

    if (!poseResult || !poseResult.isValid) {
      return null;
    }

    // Convert rotation matrix to quaternion
    const quaternion = new THREE.Quaternion();
    const rotationMatrix4 = new THREE.Matrix4();
    rotationMatrix4.set(
      poseResult.rotation.elements[0], poseResult.rotation.elements[3], poseResult.rotation.elements[6], 0,
      poseResult.rotation.elements[1], poseResult.rotation.elements[4], poseResult.rotation.elements[7], 0,
      poseResult.rotation.elements[2], poseResult.rotation.elements[5], poseResult.rotation.elements[8], 0,
      0, 0, 0, 1
    );
    quaternion.setFromRotationMatrix(rotationMatrix4);

    // Confidence based on inlier ratio
    const confidence = Math.min(1, essentialResult.inlierCount / points1.length);

    return {
      rotation: poseResult.rotation,
      translation: poseResult.translation,
      quaternion,
      timestamp,
      confidence,
    };
  }

  /**
   * Estimate pose from feature matches
   *
   * @param matches Feature matches
   * @param features1 Features from first frame
   * @param features2 Features from second frame
   * @param timestamp Timestamp for the pose
   * @returns Camera pose or null if estimation failed
   */
  public estimatePoseFromMatches(
    matches: FeatureMatch[],
    features1: Feature[],
    features2: Feature[],
    timestamp: number
  ): CameraPose | null {
    if (matches.length < this.minInliers) {
      return null;
    }

    const points1: Array<{ x: number; y: number }> = [];
    const points2: Array<{ x: number; y: number }> = [];

    for (const match of matches) {
      const feature1 = features1[match.queryIndex];
      const feature2 = features2[match.trainIndex];

      if (feature1 && feature2) {
        points1.push({ x: feature1.x, y: feature1.y });
        points2.push({ x: feature2.x, y: feature2.y });
      }
    }

    return this.estimatePose(points1, points2, timestamp);
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
  public updateOptions(options: Partial<PoseEstimatorOptions>): void {
    if (options.ransacProbability !== undefined) {
      this.ransacProbability = options.ransacProbability;
    }
    if (options.ransacThreshold !== undefined) {
      this.ransacThreshold = options.ransacThreshold;
    }
    if (options.minInliers !== undefined) {
      this.minInliers = options.minInliers;
    }
    if (options.maxIterations !== undefined) {
      this.maxIterations = options.maxIterations;
    }
    if (options.use5Point !== undefined) {
      this.use5Point = options.use5Point;
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

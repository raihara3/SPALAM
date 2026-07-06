/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import type { CameraPose, PnPResult } from "../types/Pose";

/**
 * Convert world-to-camera extrinsics into a camera-to-world CameraPose.
 *
 * OpenCV's recoverPose() and solvePnP() return extrinsics (R, t) such that
 * x_camera = R * x_world + t. The CameraPose convention used throughout
 * SPALAM stores the camera orientation R_wc = R^T and the camera center
 * C = -R^T * t in world coordinates (matching Three.js camera semantics).
 *
 * @param rotation World-to-camera rotation R
 * @param translation World-to-camera translation t
 * @param timestamp Pose timestamp in milliseconds
 * @param confidence Confidence score (0-1)
 */
export function extrinsicsToCameraPose(
  rotation: THREE.Matrix3,
  translation: THREE.Vector3,
  timestamp: number,
  confidence: number
): CameraPose {
  const cameraRotation = rotation.clone().transpose();

  // C = -R^T * t
  const cameraCenter = translation
    .clone()
    .applyMatrix3(cameraRotation)
    .negate();

  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().setFromMatrix3(cameraRotation)
  );

  return {
    rotation: cameraRotation,
    translation: cameraCenter,
    quaternion,
    timestamp,
    confidence,
  };
}

/**
 * Convert a PnP result (world-to-camera extrinsics) into a CameraPose.
 *
 * @param pnpResult Result from PnPSolver
 * @param timestamp Pose timestamp in milliseconds
 * @param confidence Confidence score (0-1), e.g. the PnP inlier ratio
 */
export function pnpResultToCameraPose(
  pnpResult: PnPResult,
  timestamp: number,
  confidence: number
): CameraPose {
  return extrinsicsToCameraPose(
    pnpResult.rotationMatrix,
    pnpResult.translation,
    timestamp,
    confidence
  );
}

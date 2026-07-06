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

/**
 * Convert a CameraPose from the OpenCV basis to the Three.js basis.
 *
 * OpenCV uses x-right / y-down / z-forward while Three.js uses
 * x-right / y-up / z-backward, i.e. the change of basis F = diag(1, -1, -1).
 * The camera center converts as C' = F * C and the orientation as
 * R' = F * R * F.
 *
 * @returns Position and quaternion applicable to a Three.js camera
 */
export function cameraPoseToThreeJs(pose: CameraPose): {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
} {
  const position = new THREE.Vector3(
    pose.translation.x,
    -pose.translation.y,
    -pose.translation.z
  );

  // R' = F * R * F negates every element with exactly one index in {y, z}
  const R = pose.rotation.elements; // column-major
  const convertedRotation = new THREE.Matrix3();
  // prettier-ignore
  convertedRotation.set(
    R[0], -R[3], -R[6],
    -R[1], R[4], R[7],
    -R[2], R[5], R[8]
  );

  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().setFromMatrix3(convertedRotation)
  );

  return { position, quaternion };
}

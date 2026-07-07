/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Parameters for the forward-backward optical flow consistency check
 */
export interface ForwardBackwardCheckParams {
  /** Point positions in the previous frame (forward-flow inputs) */
  previousPoints: Array<{ x: number; y: number }>;
  /** Positions produced by tracking the forward results back to the previous frame */
  backwardPoints: Array<{ x: number; y: number }>;
  /** Forward tracking status per point (1 = success) */
  forwardStatus: ArrayLike<number>;
  /** Backward tracking status per point (1 = success) */
  backwardStatus: ArrayLike<number>;
  /** Maximum allowed round-trip error in pixels */
  threshold: number;
}

/**
 * Compute a keep-mask from the forward-backward optical flow check.
 *
 * A point tracked prev -> curr -> prev should land back on its original
 * position; a large round-trip error indicates the forward track slid to a
 * different structure (occlusion boundary, repeated texture, shadow edge).
 * mask[i] is true when both flow directions succeeded and the round-trip
 * error is within the threshold.
 */
export function computeForwardBackwardMask(
  params: ForwardBackwardCheckParams
): boolean[] {
  const {
    previousPoints,
    backwardPoints,
    forwardStatus,
    backwardStatus,
    threshold,
  } = params;

  const squaredThreshold = threshold * threshold;
  const mask: boolean[] = new Array(previousPoints.length).fill(false);

  for (let i = 0; i < previousPoints.length; i++) {
    if (forwardStatus[i] !== 1 || backwardStatus[i] !== 1) {
      continue;
    }
    const backwardPoint = backwardPoints[i];
    if (!backwardPoint) {
      continue;
    }
    const deltaX = backwardPoint.x - previousPoints[i].x;
    const deltaY = backwardPoint.y - previousPoints[i].y;
    mask[i] = deltaX * deltaX + deltaY * deltaY <= squaredThreshold;
  }

  return mask;
}

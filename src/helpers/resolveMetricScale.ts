/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Parameters for metric scale resolution
 */
export interface ResolveMetricScaleParams {
  /** Depths of triangulated points in the reference camera (arbitrary scale) */
  triangulatedDepths: number[];
  /** Metric depth priors for the same points (e.g. from the depth network) */
  priorDepths: number[];
  /** Minimum valid pairs for a reliable estimate. Default: 10 */
  minSamples?: number;
  /** Lower clamp for the scale. Default: 0.01 */
  minScale?: number;
  /** Upper clamp for the scale. Default: 100 */
  maxScale?: number;
}

/**
 * Result of metric scale resolution
 */
export interface MetricScaleResult {
  /** Scale factor to convert triangulated units into metric units */
  scale: number;
  /** Number of valid depth pairs used */
  sampleCount: number;
  /** Whether the estimate meets the reliability criteria */
  isReliable: boolean;
}

/**
 * Resolve the metric scale of a monocular reconstruction from depth priors.
 *
 * Monocular triangulation is only defined up to scale; this fixes the scale
 * as the median ratio prior/triangulated over all valid pairs. The median
 * makes the estimate robust to outliers in either depth source. This policy
 * is decided at initialization time so that the map scale and anchor depths
 * stay in the same metric frame afterwards.
 */
export function resolveMetricScale(
  params: ResolveMetricScaleParams
): MetricScaleResult {
  const { triangulatedDepths, priorDepths } = params;
  const minSamples = params.minSamples ?? 10;
  const minScale = params.minScale ?? 0.01;
  const maxScale = params.maxScale ?? 100;

  const ratios: number[] = [];
  const pairCount = Math.min(triangulatedDepths.length, priorDepths.length);
  for (let i = 0; i < pairCount; i++) {
    const triangulated = triangulatedDepths[i];
    const prior = priorDepths[i];
    if (
      Number.isFinite(triangulated) &&
      Number.isFinite(prior) &&
      triangulated > 0 &&
      prior > 0
    ) {
      ratios.push(prior / triangulated);
    }
  }

  if (ratios.length === 0) {
    return { scale: 1, sampleCount: 0, isReliable: false };
  }

  ratios.sort((a, b) => a - b);
  const middle = Math.floor(ratios.length / 2);
  const median =
    ratios.length % 2 === 0
      ? (ratios[middle - 1] + ratios[middle]) / 2
      : ratios[middle];

  const isReliable =
    ratios.length >= minSamples && median >= minScale && median <= maxScale;

  return {
    scale: Math.min(Math.max(median, minScale), maxScale),
    sampleCount: ratios.length,
    isReliable,
  };
}

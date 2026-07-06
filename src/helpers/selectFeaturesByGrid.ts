/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Options for grid-based feature selection
 */
export interface GridFeatureSelectionOptions {
  /** Image width in pixels */
  imageWidth: number;
  /** Image height in pixels */
  imageHeight: number;
  /** Number of grid rows */
  rows: number;
  /** Number of grid columns */
  columns: number;
  /** Maximum total number of selected features */
  maxFeatures: number;
  /**
   * Maximum features per grid cell.
   * 0 (or omitted) selects an automatic quota of twice the uniform share,
   * which caps dense clusters while tolerating uneven texture.
   */
  maxFeaturesPerCell?: number;
}

/**
 * Select features with an even spatial distribution using grid bucketing.
 *
 * Pose estimation accuracy depends heavily on the spatial distribution of
 * features: a dense cluster in one corner constrains the pose far less than
 * the same number of features spread across the image. Candidates are
 * expected in quality order (strongest first, as returned by
 * goodFeaturesToTrack); each is accepted while its grid cell and the total
 * budget have capacity.
 */
export function selectFeaturesByGrid<T extends { x: number; y: number }>(
  candidates: T[],
  options: GridFeatureSelectionOptions
): T[] {
  const { imageWidth, imageHeight, rows, columns, maxFeatures } = options;

  if (
    candidates.length === 0 ||
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    rows <= 0 ||
    columns <= 0 ||
    maxFeatures <= 0
  ) {
    return [];
  }

  const cellCount = rows * columns;
  const maxFeaturesPerCell =
    options.maxFeaturesPerCell && options.maxFeaturesPerCell > 0
      ? options.maxFeaturesPerCell
      : Math.ceil(maxFeatures / cellCount) * 2;

  const cellWidth = imageWidth / columns;
  const cellHeight = imageHeight / rows;
  const cellCounts = new Array<number>(cellCount).fill(0);
  const selected: T[] = [];

  for (const candidate of candidates) {
    if (selected.length >= maxFeatures) {
      break;
    }
    if (
      candidate.x < 0 ||
      candidate.x >= imageWidth ||
      candidate.y < 0 ||
      candidate.y >= imageHeight
    ) {
      continue;
    }

    const column = Math.min(Math.floor(candidate.x / cellWidth), columns - 1);
    const row = Math.min(Math.floor(candidate.y / cellHeight), rows - 1);
    const cellIndex = row * columns + column;

    if (cellCounts[cellIndex] >= maxFeaturesPerCell) {
      continue;
    }

    cellCounts[cellIndex]++;
    selected.push(candidate);
  }

  return selected;
}

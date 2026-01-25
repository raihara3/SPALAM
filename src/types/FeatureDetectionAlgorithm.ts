/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 特徴点検出アルゴリズムの種類
 */
export enum FeatureDetectionAlgorithm {
  /** Harris Corner Detection */
  HARRIS = "harris",
  /** Shi-Tomasi Corner Detection (goodFeaturesToTrack) */
  SHI_TOMASI = "shi_tomasi",
  /** FAST Feature Detection */
  FAST = "fast",
  /** ORB (Oriented FAST and Rotated BRIEF) */
  ORB = "orb",
  /** SIFT (Scale-Invariant Feature Transform) */
  SIFT = "sift",
}

/**
 * 特徴点検出アルゴリズムの設定
 */
export interface AlgorithmConfig {
  /** アルゴリズムの種類 */
  algorithm: FeatureDetectionAlgorithm;
  /** アルゴリズム固有のパラメータ */
  params?:
    | HarrisParams
    | ShiTomasiParams
    | FastParams
    | OrbParams
    | SiftParams;
}

/**
 * Harris Corner Detection のパラメータ
 */
export interface HarrisParams {
  /** コーナー検出のためのパラメータ k */
  k: number;
  /** ブロックサイズ */
  blockSize: number;
  /** 閾値 */
  threshold: number;
}

/**
 * Shi-Tomasi Corner Detection のパラメータ
 */
export interface ShiTomasiParams {
  /** 品質レベル */
  qualityLevel: number;
  /** 最小距離 */
  minDistance: number;
  /** ブロックサイズ */
  blockSize: number;
  /** Harris detector を使用するか */
  useHarrisDetector: boolean;
  /** Harris パラメータ k */
  k: number;
}

/**
 * FAST Feature Detection のパラメータ
 */
export interface FastParams {
  /** 閾値 */
  threshold: number;
  /** 非極大値抑制を適用するか */
  nonmaxSuppression: boolean;
  /** FAST detector のタイプ */
  type: number;
}

/**
 * ORB Feature Detection のパラメータ
 */
export interface OrbParams {
  /** 特徴点の最大数 */
  nfeatures: number;
  /** スケールファクター */
  scaleFactor: number;
  /** ピラミッドレベル数 */
  nlevels: number;
  /** エッジ閾値 */
  edgeThreshold: number;
  /** 最初のレベル */
  firstLevel: number;
  /** WTA_K */
  WTA_K: number;
  /** スコアタイプ */
  scoreType: number;
  /** パッチサイズ */
  patchSize: number;
  /** FAST 閾値 */
  fastThreshold: number;
}

/**
 * SIFT Feature Detection のパラメータ
 */
export interface SiftParams {
  /** 特徴点の最大数 */
  nfeatures: number;
  /** オクターブ層数 */
  nOctaveLayers: number;
  /** コントラスト閾値 */
  contrastThreshold: number;
  /** エッジ閾値 */
  edgeThreshold: number;
  /** シグマ */
  sigma: number;
}

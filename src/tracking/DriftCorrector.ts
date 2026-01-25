/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { Feature } from "../types/Feature";

/**
 * 安定特徴点の情報
 */
export interface StableFeature {
  /** 特徴点ID */
  id: string;
  /** 2D位置（画像座標） */
  position2D: { x: number; y: number };
  /** 3D位置（ワールド座標） */
  position3D: THREE.Vector3;
  /** 連続追跡フレーム数 */
  trackedFrames: number;
  /** 信頼度（0-1） */
  confidence: number;
  /** 最終更新タイムスタンプ */
  lastUpdated: number;
}

/**
 * ドリフト補正の設定オプション
 */
export interface DriftCorrectorOptions {
  /** リセット間隔（ミリ秒）デフォルト: 1000 */
  resetIntervalMs?: number;
  /** 安定とみなす最小追跡フレーム数 デフォルト: 10 */
  minTrackedFrames?: number;
  /** 安定特徴点の最大保持数 デフォルト: 50 */
  maxStableFeatures?: number;
  /** 特徴点の有効期限（ミリ秒）デフォルト: 5000 */
  featureExpiryMs?: number;
}

/**
 * ドリフト補正器
 *
 * 安定した特徴点を追跡し、それを基準にIMUのドリフトを補正する
 */
export class DriftCorrector {
  private stableFeatures: Map<string, StableFeature> = new Map();
  private lastResetTimestamp: number = 0;
  private resetIntervalMs: number;
  private minTrackedFrames: number;
  private maxStableFeatures: number;
  private featureExpiryMs: number;

  private referencePosition: THREE.Vector3 | null = null;

  // Reusable objects to prevent GC pressure
  private readonly reusableCentroid: THREE.Vector3 = new THREE.Vector3();
  private readonly reusableTempVector: THREE.Vector3 = new THREE.Vector3();
  private readonly reusablePositionDrift: THREE.Vector3 = new THREE.Vector3();

  constructor(options?: DriftCorrectorOptions) {
    this.resetIntervalMs = options?.resetIntervalMs ?? 1000;
    this.minTrackedFrames = options?.minTrackedFrames ?? 10;
    this.maxStableFeatures = options?.maxStableFeatures ?? 50;
    this.featureExpiryMs = options?.featureExpiryMs ?? 5000;
  }

  /**
   * 特徴点情報を更新
   *
   * @param features 現在フレームの特徴点リスト
   * @param depth3DPoints 3D位置情報（オプション）
   */
  public updateFeatures(
    features: Feature[],
    depth3DPoints?: Map<string, THREE.Vector3>
  ): void {
    const now = Date.now();
    const currentIds = new Set<string>();

    for (const feature of features) {
      currentIds.add(feature.id);

      const existing = this.stableFeatures.get(feature.id);

      if (existing) {
        // 既存の特徴点を更新 - avoid creating new objects
        existing.position2D.x = feature.x;
        existing.position2D.y = feature.y;
        existing.trackedFrames++;
        existing.lastUpdated = now;

        // 3D位置があれば更新 - use copy() instead of clone()
        if (depth3DPoints?.has(feature.id)) {
          existing.position3D.copy(depth3DPoints.get(feature.id)!);
        }

        // 信頼度を計算（追跡フレーム数に基づく）
        existing.confidence = Math.min(
          1.0,
          existing.trackedFrames / (this.minTrackedFrames * 2)
        );
      } else {
        // 新しい特徴点を追加
        const position3D =
          depth3DPoints?.get(feature.id) ?? new THREE.Vector3();

        this.stableFeatures.set(feature.id, {
          id: feature.id,
          position2D: { x: feature.x, y: feature.y },
          position3D: position3D.clone(),
          trackedFrames: 1,
          confidence: 0,
          lastUpdated: now,
        });
      }
    }

    // 見えなくなった特徴点と古い特徴点を削除
    for (const [id, feature] of this.stableFeatures) {
      if (
        !currentIds.has(id) ||
        now - feature.lastUpdated > this.featureExpiryMs
      ) {
        this.stableFeatures.delete(id);
      }
    }

    // 最大数を超えたら、信頼度の低いものから削除
    if (this.stableFeatures.size > this.maxStableFeatures) {
      const sorted = Array.from(this.stableFeatures.values()).sort(
        (a, b) => b.confidence - a.confidence
      );
      const toKeep = new Set(
        sorted.slice(0, this.maxStableFeatures).map((f) => f.id)
      );
      for (const id of this.stableFeatures.keys()) {
        if (!toKeep.has(id)) {
          this.stableFeatures.delete(id);
        }
      }
    }
  }

  /**
   * ドリフト補正が必要か判定
   */
  public shouldCorrect(): boolean {
    const now = Date.now();
    const timeSinceLastReset = now - this.lastResetTimestamp;

    // リセット間隔を超え、かつ安定特徴点が十分にある
    return (
      timeSinceLastReset >= this.resetIntervalMs &&
      this.getStableFeatureCount() >= 3
    );
  }

  /**
   * 安定特徴点の数を取得
   */
  public getStableFeatureCount(): number {
    let count = 0;
    for (const feature of this.stableFeatures.values()) {
      if (feature.trackedFrames >= this.minTrackedFrames) {
        count++;
      }
    }
    return count;
  }

  /**
   * 安定特徴点のリストを取得
   */
  public getStableFeatures(): StableFeature[] {
    return Array.from(this.stableFeatures.values()).filter(
      (f) => f.trackedFrames >= this.minTrackedFrames
    );
  }

  /**
   * 視覚情報から基準姿勢を計算
   *
   * 安定特徴点の重心位置から、平面の向きを推定する
   * Note: Uses reusable centroid vector - caller should not store the returned position
   */
  public computeVisualReference(): {
    position: THREE.Vector3;
    confidence: number;
  } | null {
    const stableFeatures = this.getStableFeatures();

    if (stableFeatures.length < 3) {
      return null;
    }

    // 安定特徴点の3D位置の重心を計算 - reuse centroid vector
    this.reusableCentroid.set(0, 0, 0);
    let totalConfidence = 0;

    for (const feature of stableFeatures) {
      // Avoid clone() - use temp vector for weighted position
      this.reusableTempVector
        .copy(feature.position3D)
        .multiplyScalar(feature.confidence);
      this.reusableCentroid.add(this.reusableTempVector);
      totalConfidence += feature.confidence;
    }

    if (totalConfidence > 0) {
      this.reusableCentroid.divideScalar(totalConfidence);
    }

    const averageConfidence = totalConfidence / stableFeatures.length;

    return {
      position: this.reusableCentroid,
      confidence: averageConfidence,
    };
  }

  /**
   * ドリフト補正を実行
   *
   * @param currentIMUOrientation 現在のIMU姿勢
   * @param visualReference 視覚から計算した基準位置
   * @returns 補正後の姿勢（補正不要ならnull）
   * Note: Returns the same quaternion reference - caller should clone if needed
   */
  public correctDrift(
    currentIMUOrientation: THREE.Quaternion,
    visualReference: { position: THREE.Vector3; confidence: number } | null
  ): THREE.Quaternion | null {
    if (!visualReference || visualReference.confidence < 0.3) {
      return null;
    }

    // 基準位置を更新
    if (!this.referencePosition) {
      this.referencePosition = new THREE.Vector3().copy(visualReference.position);
      this.lastResetTimestamp = Date.now();
      return null;
    }

    // 位置のドリフト量を計算 - reuse vector
    this.reusablePositionDrift
      .copy(visualReference.position)
      .sub(this.referencePosition);

    // ドリフトが大きい場合は基準をリセット
    if (this.reusablePositionDrift.length() > 0.5) {
      this.referencePosition.copy(visualReference.position);
      this.lastResetTimestamp = Date.now();

      // 補正は行わず、新しい基準で次回から補正
      return null;
    }

    this.lastResetTimestamp = Date.now();

    // 現在の姿勢を返す（大きな補正は行わない）
    // 相補フィルタと組み合わせて使用することを想定
    // Note: Return same reference instead of clone - caller should clone if needed
    return currentIMUOrientation;
  }

  /**
   * 平面の中心位置を取得
   *
   * 安定特徴点から平面の中心を計算
   */
  public getPlaneCenterPosition(): THREE.Vector3 | null {
    const reference = this.computeVisualReference();
    return reference?.position ?? null;
  }

  /**
   * 視覚信頼度を取得
   */
  public getVisualConfidence(): number {
    const stableFeatures = this.getStableFeatures();
    if (stableFeatures.length === 0) {
      return 0;
    }

    let totalConfidence = 0;
    for (const feature of stableFeatures) {
      totalConfidence += feature.confidence;
    }

    return totalConfidence / stableFeatures.length;
  }

  /**
   * 強制リセット
   */
  public forceReset(): void {
    this.referencePosition = null;
    this.lastResetTimestamp = Date.now();
  }

  /**
   * 統計情報を取得
   */
  public getStatistics(): {
    totalFeatures: number;
    stableFeatures: number;
    averageConfidence: number;
    timeSinceLastReset: number;
  } {
    const stableFeatures = this.getStableFeatures();

    return {
      totalFeatures: this.stableFeatures.size,
      stableFeatures: stableFeatures.length,
      averageConfidence: this.getVisualConfidence(),
      timeSinceLastReset: Date.now() - this.lastResetTimestamp,
    };
  }

  /**
   * リソース解放
   */
  public dispose(): void {
    this.stableFeatures.clear();
    this.referencePosition = null;
  }
}

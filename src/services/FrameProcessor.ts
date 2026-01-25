/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { FeatureDetector } from "../FeatureDetector";
import { DepthEstimation } from "../DepthEstimation";
import { Feature } from "../types";

/**
 * フレーム処理結果
 */
export interface FrameProcessingResult {
  features: Feature[];
  centerFeature: Feature | null;
  depthMap: Float32Array | null;
  timestamp: number;
}

/**
 * フレームプロセッサー
 * ビデオフレームから特徴点検出と深度推定を実行
 */
export class FrameProcessor {
  private featureDetector: FeatureDetector | null = null;
  private depthEstimation: DepthEstimation | null = null;
  private isInitialized: boolean = false;
  private depthEstimationEnabled: boolean = true;

  constructor() {}

  /**
   * 初期化
   */
  public async initialize(
    cvInstance: typeof cv,
    video: HTMLVideoElement,
    showFeatures: boolean = true,
    showDepth: boolean = true
  ): Promise<void> {
    // 特徴点検出器の初期化
    this.featureDetector = new FeatureDetector({
      cv: cvInstance,
      video,
      showFeatures,
    });

    // 深度推定の初期化
    try {
      this.depthEstimation = new DepthEstimation({
        canvas: this.featureDetector.canvas,
        context: this.featureDetector.ctx,
        showDepth,
      });

      console.log("Loading depth estimation model...");
      await this.depthEstimation.loadModel();
      console.log("Depth estimation model loaded successfully");
    } catch (error) {
      // 深度推定が失敗してもSPALAMは継続（特徴点検出は利用可能）
      this.depthEstimation = null;

      // エラータイプ別の処理
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("not supported on mobile devices") ||
        errorMessage.includes("WASM depth estimation failed") ||
        errorMessage.includes("Model download failed") ||
        errorMessage.includes("CDN returned HTML")
      ) {
        // モバイルやネットワーク問題の場合は警告レベルで出力
        console.warn(
          "Depth estimation disabled, using fallback depth calculation:",
          errorMessage
        );
        // エラーを再スローしない
      } else if (errorMessage.includes("timeout")) {
        console.warn(
          "Model loading timeout - using fallback depth calculation:",
          errorMessage
        );
        // タイムアウトの場合も継続
      } else {
        // その他の予期しないエラーの場合のみエラーレベルで出力
        console.error("Depth estimation failed to initialize:", error);
        console.warn(
          "SPALAM will continue without AI depth estimation, using fallback depth calculation"
        );
        // その他の予期しないエラーの場合は再スロー
        throw new Error(`Depth estimation unavailable: ${errorMessage}`);
      }
    }

    this.isInitialized = true;
  }

  /**
   * 初期化済みかチェック
   */
  public isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * フレームを処理
   */
  public async processFrame(): Promise<FrameProcessingResult | null> {
    if (!this.isInitialized || !this.featureDetector) {
      console.error("FrameProcessor is not initialized");
      return null;
    }

    // 特徴点検出を実行
    this.featureDetector.render();

    // 追跡された特徴点を取得
    const features = this.featureDetector.getTrackedFeaturePoints();
    const centerFeature = this.featureDetector.centerFeature;

    // 深度マップを取得（深度推定が有効かつ利用可能な場合のみ）
    let depthMap = null;
    if (this.depthEstimation && this.depthEstimationEnabled) {
      try {
        depthMap = await this.depthEstimation.getDepthMap();
      } catch (error) {
        console.warn("Depth map generation failed:", error);
        // 深度推定エラーでもフレーム処理は継続
      }
    }

    return {
      features,
      centerFeature,
      depthMap: depthMap || null,
      timestamp: Date.now(),
    };
  }

  /**
   * 特徴点検出のみを実行（深度推定なし）
   */
  public renderFeatures(): void {
    if (this.featureDetector) {
      this.featureDetector.render();
    }
  }

  /**
   * キャンバスの幅を取得（スケール後）
   */
  public getCanvasWidth(): number {
    return this.featureDetector?.canvas.width || 0;
  }

  /**
   * キャンバスの高さを取得（スケール後）
   */
  public getCanvasHeight(): number {
    return this.featureDetector?.canvas.height || 0;
  }

  /**
   * オリジナルビデオの幅を取得（スケール前）
   */
  public getOriginalWidth(): number {
    return this.featureDetector?.getOriginalWidth() || 0;
  }

  /**
   * オリジナルビデオの高さを取得（スケール前）
   */
  public getOriginalHeight(): number {
    return this.featureDetector?.getOriginalHeight() || 0;
  }

  /**
   * 追跡中の特徴点を取得（座標はオリジナルビデオサイズにスケール済み）
   */
  public getTrackedFeatures(): Feature[] {
    return this.featureDetector?.getTrackedFeaturePoints() || [];
  }

  /**
   * 特徴点を取得（getTrackedFeaturesのエイリアス）
   */
  public getFeatures(): Feature[] {
    return this.getTrackedFeatures();
  }

  /**
   * 中心特徴点を取得（座標はオリジナルビデオサイズにスケール済み）
   */
  public getCenterFeature(): Feature | null {
    return this.featureDetector?.getCenterFeatureScaled() || null;
  }

  /**
   * 現在の深度マップを取得
   */
  public async getDepthMap(): Promise<Float32Array | null> {
    if (!this.depthEstimation) {
      return null;
    }
    const depthMap = await this.depthEstimation.getDepthMap();
    return depthMap || null;
  }

  /**
   * 特徴点が失われているかどうかを返す
   */
  public hasLostFeatures(): boolean {
    return this.featureDetector?.hasLostFeatures() ?? false;
  }

  /**
   * 再検出を許可する（外部から呼び出し）
   */
  public allowRedetection(): void {
    this.featureDetector?.allowRedetection();
  }

  /**
   * 再配置時のターゲット座標を設定
   * 設定された座標に最も近い特徴点がcenterFeatureとして選択される
   * @param x スクリーンX座標（ピクセル）
   * @param y スクリーンY座標（ピクセル）
   */
  public setTargetPosition(x: number, y: number): void {
    this.featureDetector?.setTargetPosition(x, y);
  }

  /**
   * 特徴点描画の有効/無効を設定
   */
  public setDrawFeaturesEnabled(enabled: boolean): void {
    this.featureDetector?.setDrawFeaturesEnabled(enabled);
  }

  /**
   * 特徴点描画が有効かどうかを取得
   */
  public isDrawFeaturesEnabled(): boolean {
    return this.featureDetector?.isDrawFeaturesEnabled() ?? false;
  }

  /**
   * 特徴点描画のスケールを設定
   */
  public setFeatureScale(scale: number): void {
    this.featureDetector?.setScale(scale);
  }

  /**
   * 深度推定の有効/無効を設定
   * 平面検出完了後は無効にすることでCPU/メモリ使用量を削減できる
   */
  public setDepthEstimationEnabled(enabled: boolean): void {
    this.depthEstimationEnabled = enabled;
    if (!enabled) {
      console.log("Depth estimation disabled to save resources");
    }
  }

  /**
   * 深度推定が有効かどうかを取得
   */
  public isDepthEstimationEnabled(): boolean {
    return this.depthEstimationEnabled;
  }

  /**
   * リセット
   */
  public reset(): void {
    this.featureDetector?.reset();
  }

  /**
   * 処理を停止
   */
  public stop(): void {
    this.reset();
  }

  /**
   * クリーンアップ
   */
  public dispose(): void {
    this.reset();
    this.isInitialized = false;
    this.featureDetector = null;
    this.depthEstimation = null;
  }
}

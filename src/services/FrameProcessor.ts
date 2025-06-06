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

  constructor() {}

  /**
   * 初期化
   */
  public async initialize(
    cv: any,
    video: HTMLVideoElement,
    showFeatures: boolean = true,
    showDepth: boolean = true
  ): Promise<void> {
    // 特徴点検出器の初期化
    this.featureDetector = new FeatureDetector({
      cv,
      video,
      showFeatures,
    });

    // 深度推定の初期化
    this.depthEstimation = new DepthEstimation({
      canvas: this.featureDetector.canvas,
      context: this.featureDetector.ctx,
      showDepth,
    });

    await this.depthEstimation.loadModel();
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
    if (!this.isInitialized || !this.featureDetector || !this.depthEstimation) {
      console.error("FrameProcessor is not initialized");
      return null;
    }

    // 特徴点検出を実行
    this.featureDetector.render();

    // 追跡された特徴点を取得
    const features = this.featureDetector.getTrackedFeaturePoints();
    const centerFeature = this.featureDetector.centerFeature;

    // 深度マップを取得（非同期で取得しても、次のフレームで使用）
    const depthMap = await this.depthEstimation.getDepthMap();

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
   * キャンバスの幅を取得
   */
  public getCanvasWidth(): number {
    return this.featureDetector?.canvas.width || 0;
  }

  /**
   * キャンバスの高さを取得
   */
  public getCanvasHeight(): number {
    return this.featureDetector?.canvas.height || 0;
  }

  /**
   * 追跡中の特徴点を取得
   */
  public getTrackedFeatures(): Feature[] {
    return this.featureDetector?.trackedFeatures || [];
  }

  /**
   * 特徴点を取得（getTrackedFeaturesのエイリアス）
   */
  public getFeatures(): Feature[] {
    return this.getTrackedFeatures();
  }

  /**
   * 中心特徴点を取得
   */
  public getCenterFeature(): Feature | null {
    return this.featureDetector?.centerFeature || null;
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

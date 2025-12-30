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

    // 深度マップを取得（深度推定が利用可能な場合のみ）
    let depthMap = null;
    if (this.depthEstimation) {
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

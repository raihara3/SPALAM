import { AutoModel, AutoProcessor, RawImage } from "@huggingface/transformers";
import {
  DepthEstimationModel,
  InferenceEngine,
  DepthMapResult,
} from "../types/DepthEstimationModel";
import { DepthEstimationConfig } from "../config/types";
import type {
  DepthModel,
  DepthProcessor,
  DepthTensor,
} from "../types/Transformers";

/**
 * 深度推定サービス
 * 複数のモデルと推論エンジンをサポート
 */
export class DepthEstimationService {
  private config: DepthEstimationConfig;
  private models: Map<string, DepthModel> = new Map();
  private processors: Map<string, DepthProcessor> = new Map();
  private currentModelId: string;
  private isProcessing: boolean = false;

  // キャッシュ
  private frameCache: Map<string, DepthMapResult> = new Map();
  // private lastFrameHash: string = "";

  // パフォーマンス計測
  private frameCount: number = 0;
  private totalInferenceTime: number = 0;

  constructor(config: DepthEstimationConfig) {
    this.config = config;
    this.currentModelId = config.modelId;
  }

  /**
   * モデルを読み込み
   */
  async loadModel(modelId?: string): Promise<void> {
    const targetModelId = modelId || this.config.modelId;

    // 既に読み込み済みの場合はスキップ
    if (this.models.has(targetModelId)) {
      this.currentModelId = targetModelId;
      return;
    }

    try {
      // エンジン設定を決定
      const engineConfig = this.getEngineConfig();

      // モデルとプロセッサを読み込み
      const model = await AutoModel.from_pretrained(
        targetModelId,
        engineConfig
      );
      const processor = await AutoProcessor.from_pretrained(targetModelId, {});

      // 入力サイズを設定
      const inputSize = this.getInputSizeForModel(targetModelId);
      // 入力サイズを設定（プロセッサの構造に依存）
      try {
        const typedProcessor = processor as unknown as DepthProcessor;
        if (typedProcessor.feature_extractor) {
          typedProcessor.feature_extractor.size = {
            width: inputSize,
            height: inputSize,
          };
        }
      } catch (e) {
        console.log("Could not set processor input size:", e);
      }

      // 保存
      this.models.set(targetModelId, model as unknown as DepthModel);
      this.processors.set(
        targetModelId,
        processor as unknown as DepthProcessor
      );
      this.currentModelId = targetModelId;

      console.log(`Loaded depth estimation model: ${targetModelId}`);
    } catch (error) {
      console.error(`Failed to load model ${targetModelId}:`, error);
      throw error;
    }
  }

  /**
   * エンジン設定を取得
   */
  private getEngineConfig(): Record<string, unknown> {
    const pipeline = this.config.pipeline;

    if (!pipeline?.engine) {
      // デフォルト設定
      return {
        device: this.config.device || "webgpu",
        dtype: "fp32",
      };
    }

    const engine = pipeline.engine.engine;
    const precision = pipeline.engine.precision || "fp32";

    switch (engine) {
      case InferenceEngine.WEBGPU:
        return {
          device: "webgpu",
          dtype: precision === "fp16" ? "fp16" : "fp32",
          ...pipeline.engine.engineOptions,
        };

      case InferenceEngine.WEBGL:
        return {
          device: "webgl",
          dtype: "fp32",
          ...pipeline.engine.engineOptions,
        };

      case InferenceEngine.WASM:
        return {
          device: "wasm",
          dtype: "fp32",
          ...pipeline.engine.engineOptions,
        };

      case InferenceEngine.ONNX:
        return {
          device: "onnx",
          dtype: precision,
          ...pipeline.engine.engineOptions,
        };

      default:
        return {
          device: this.config.device || "webgpu",
          dtype: "fp32",
        };
    }
  }

  /**
   * モデルに応じた入力サイズを取得
   */
  private getInputSizeForModel(modelId: string): number {
    const modelConfig = this.config.pipeline?.model;
    if (modelConfig?.inputSize) {
      return modelConfig.inputSize;
    }

    // モデル別のデフォルトサイズ
    switch (modelId) {
      case DepthEstimationModel.DEPTH_ANYTHING_V2_SMALL:
      case DepthEstimationModel.DEPTH_ANYTHING_V2_BASE:
      case DepthEstimationModel.DEPTH_ANYTHING_V2_LARGE:
        return 504;

      case DepthEstimationModel.MIDAS_SMALL:
        return 256;

      case DepthEstimationModel.MIDAS_DPT_HYBRID:
      case DepthEstimationModel.MIDAS_DPT_LARGE:
        return 384;

      case DepthEstimationModel.ZOE_DEPTH:
        return 512;

      default:
        return this.config.inputSize || 504;
    }
  }

  /**
   * 深度マップを推定
   */
  async estimateDepth(
    imageData: ImageData,
    useCache: boolean = true
  ): Promise<DepthMapResult | null> {
    if (this.isProcessing) {
      console.warn("Depth estimation already in progress");
      return null;
    }

    // キャッシュチェック
    if (useCache && this.config.cache?.enableFrameCache) {
      const hash = this.computeImageHash(imageData);
      const cached = this.frameCache.get(hash);

      if (cached && this.isCacheValid(cached)) {
        return cached;
      }
    }

    // フレームスキップチェック
    if (this.shouldSkipFrame()) {
      return null;
    }

    this.isProcessing = true;
    const startTime = performance.now();

    try {
      const model = this.models.get(this.currentModelId);
      const processor = this.processors.get(this.currentModelId);

      if (!model || !processor) {
        throw new Error("Model not loaded");
      }

      // 画像を準備
      const image = new RawImage(
        imageData.data,
        imageData.width,
        imageData.height,
        4
      );

      // 推論実行
      const inputs = await processor(image);
      const { predicted_depth } = await model(inputs);

      // 結果を処理
      const result = this.processDepthOutput(
        predicted_depth,
        imageData.width,
        imageData.height,
        performance.now() - startTime
      );

      // 後処理
      if (this.config.pipeline?.postProcessing) {
        this.applyPostProcessing(result);
      }

      // キャッシュに保存
      if (useCache && this.config.cache?.enableFrameCache) {
        this.updateCache(imageData, result);
      }

      // パフォーマンス統計を更新
      this.updatePerformanceStats(result.inferenceTime || 0);

      return result;
    } catch (error) {
      console.error("Depth estimation failed:", error);
      return null;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 深度出力を処理
   */
  private processDepthOutput(
    predicted_depth: DepthTensor,
    _originalWidth: number,
    _originalHeight: number,
    inferenceTime: number
  ): DepthMapResult {
    const depthData = predicted_depth.data as Float32Array;
    const [, height, width] = predicted_depth.dims;

    // 最小値と最大値を計算
    let minDepth = Infinity;
    let maxDepth = -Infinity;

    for (let i = 0; i < depthData.length; i++) {
      const value = depthData[i];
      if (value < minDepth) minDepth = value;
      if (value > maxDepth) maxDepth = value;
    }

    return {
      data: depthData,
      width,
      height,
      minDepth,
      maxDepth,
      timestamp: Date.now(),
      inferenceTime,
    };
  }

  /**
   * 後処理を適用
   */
  private applyPostProcessing(result: DepthMapResult): void {
    const postProcessing = this.config.pipeline?.postProcessing;
    if (!postProcessing) return;

    if (postProcessing.gaussianBlur) {
      this.applyGaussianBlur(result);
    }

    if (postProcessing.bilateralFilter) {
      this.applyBilateralFilter(result);
    }

    if (postProcessing.temporalSmoothing) {
      this.applyTemporalSmoothing(result);
    }
  }

  /**
   * ガウシアンブラーを適用
   */
  private applyGaussianBlur(result: DepthMapResult): void {
    // 簡易的な3x3ガウシアンフィルタ
    const kernel = [
      [1 / 16, 2 / 16, 1 / 16],
      [2 / 16, 4 / 16, 2 / 16],
      [1 / 16, 2 / 16, 1 / 16],
    ];

    const { data, width, height } = result;
    const output = new Float32Array(data.length);

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let sum = 0;

        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = (y + ky) * width + (x + kx);
            sum += data[idx] * kernel[ky + 1][kx + 1];
          }
        }

        output[y * width + x] = sum;
      }
    }

    // エッジ部分はコピー
    for (let x = 0; x < width; x++) {
      output[x] = data[x];
      output[(height - 1) * width + x] = data[(height - 1) * width + x];
    }
    for (let y = 0; y < height; y++) {
      output[y * width] = data[y * width];
      output[y * width + width - 1] = data[y * width + width - 1];
    }

    result.data = output;
  }

  /**
   * バイラテラルフィルタを適用（簡易版）
   */
  private applyBilateralFilter(result: DepthMapResult): void {
    const { data, width, height } = result;
    const output = new Float32Array(data.length);
    const spatialSigma = 2.0;
    const depthSigma = 0.1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const centerIdx = y * width + x;
        const centerDepth = data[centerIdx];

        let weightSum = 0;
        let valueSum = 0;

        // 5x5ウィンドウ
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const ny = y + dy;
            const nx = x + dx;

            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              const idx = ny * width + nx;
              const depth = data[idx];

              // 空間的重み
              const spatialDist = Math.sqrt(dx * dx + dy * dy);
              const spatialWeight = Math.exp(
                -(spatialDist * spatialDist) / (2 * spatialSigma * spatialSigma)
              );

              // 深度差による重み
              const depthDiff = Math.abs(depth - centerDepth);
              const depthWeight = Math.exp(
                -(depthDiff * depthDiff) / (2 * depthSigma * depthSigma)
              );

              const weight = spatialWeight * depthWeight;
              weightSum += weight;
              valueSum += depth * weight;
            }
          }
        }

        output[centerIdx] = valueSum / weightSum;
      }
    }

    result.data = output;
  }

  /**
   * 時間的平滑化を適用
   */
  private previousDepthMap: Float32Array | null = null;
  private applyTemporalSmoothing(result: DepthMapResult): void {
    if (!this.previousDepthMap) {
      this.previousDepthMap = new Float32Array(result.data);
      return;
    }

    const alpha = 0.7; // 現在フレームの重み
    const { data } = result;

    for (let i = 0; i < data.length; i++) {
      data[i] = alpha * data[i] + (1 - alpha) * this.previousDepthMap[i];
    }

    this.previousDepthMap = new Float32Array(data);
  }

  /**
   * 画像のハッシュを計算（簡易版）
   */
  private computeImageHash(imageData: ImageData): string {
    // 単純なサンプリングベースのハッシュ
    const step = Math.floor(imageData.data.length / 1000);
    let hash = "";

    for (let i = 0; i < imageData.data.length; i += step) {
      hash += imageData.data[i].toString(16);
    }

    return hash;
  }

  /**
   * キャッシュが有効かチェック
   */
  private isCacheValid(cached: DepthMapResult): boolean {
    const ttl = this.config.cache?.cacheTTL || 1000;
    return Date.now() - cached.timestamp < ttl;
  }

  /**
   * キャッシュを更新
   */
  private updateCache(imageData: ImageData, result: DepthMapResult): void {
    const hash = this.computeImageHash(imageData);
    this.frameCache.set(hash, result);

    // キャッシュサイズ制限
    const maxSize = this.config.cache?.cacheSize || 10;
    if (this.frameCache.size > maxSize) {
      const firstKey = this.frameCache.keys().next().value;
      if (firstKey) {
        this.frameCache.delete(firstKey);
      }
    }
  }

  /**
   * フレームをスキップすべきかチェック
   */
  private shouldSkipFrame(): boolean {
    const skipFrames = this.config.performance?.skipFrames || 0;
    if (skipFrames === 0) return false;

    this.frameCount++;
    return this.frameCount % (skipFrames + 1) !== 0;
  }

  /**
   * パフォーマンス統計を更新
   */
  private updatePerformanceStats(inferenceTime: number): void {
    this.totalInferenceTime += inferenceTime;

    // 適応的品質調整
    if (this.config.performance?.adaptiveQuality) {
      const avgInferenceTime = this.totalInferenceTime / this.frameCount;
      const targetFPS = this.config.performance.maxFPS || 30;
      const targetFrameTime = 1000 / targetFPS;

      if (avgInferenceTime > targetFrameTime) {
        // 品質を下げる必要がある
        console.log(
          `Performance warning: avg inference time ${avgInferenceTime}ms exceeds target ${targetFrameTime}ms`
        );
      }
    }
  }

  /**
   * モデルを切り替え
   */
  async switchModel(modelId: string): Promise<void> {
    await this.loadModel(modelId);
    this.clearCache();
  }

  /**
   * キャッシュをクリア
   */
  clearCache(): void {
    this.frameCache.clear();
    this.previousDepthMap = null;
  }

  /**
   * 利用可能なモデルを取得
   */
  getAvailableModels(): string[] {
    const models =
      this.config.availableModels || Object.values(DepthEstimationModel);
    return models.map((m) => m.toString());
  }

  /**
   * 現在のモデルIDを取得
   */
  getCurrentModelId(): string {
    return this.currentModelId;
  }

  /**
   * パフォーマンス統計を取得
   */
  getPerformanceStats(): {
    averageInferenceTime: number;
    totalFrames: number;
  } {
    return {
      averageInferenceTime:
        this.frameCount > 0 ? this.totalInferenceTime / this.frameCount : 0,
      totalFrames: this.frameCount,
    };
  }

  /**
   * 設定を更新
   */
  updateConfig(config: Partial<DepthEstimationConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

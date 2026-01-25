/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Web Worker for depth estimation
 * 深度推定をメインスレッドから分離してパフォーマンスを向上
 */

import { AutoModel, AutoProcessor, RawImage } from "@huggingface/transformers";
import { DepthMapResult } from "../types/DepthEstimationModel";
import { DepthEstimationConfig } from "../config/types";
import type {
  DepthModel,
  DepthProcessor,
  DepthTensor,
} from "../types/Transformers";

/**
 * Workerに送信するメッセージの型
 */
export interface DepthEstimationMessage {
  type: "init" | "estimate" | "switchModel" | "terminate";
  payload?: {
    config?: DepthEstimationConfig;
    imageData?: ImageData;
    modelId?: string;
  };
  id?: string;
}

/**
 * Workerから返されるメッセージの型
 */
export interface DepthEstimationResponse {
  type: "result" | "error" | "ready" | "modelLoaded";
  payload?: {
    result?: DepthMapResult;
    error?: string;
    modelId?: string;
  };
  id?: string;
}

/**
 * 深度推定Workerハンドラ
 */
class DepthEstimationWorkerHandler {
  private config: DepthEstimationConfig | null = null;
  private model: DepthModel | null = null;
  private processor: DepthProcessor | null = null;
  // private currentModelId: string | null = null;
  private isInitialized = false;

  constructor() {
    console.log("DepthEstimationWorker initialized");
  }

  /**
   * メッセージ処理
   */
  public async handleMessage(
    event: MessageEvent<DepthEstimationMessage>
  ): Promise<void> {
    const { type, payload, id } = event.data;

    try {
      switch (type) {
        case "init":
          await this.handleInit(payload?.config);
          this.postMessage({ type: "ready", id });
          break;

        case "estimate":
          await this.handleEstimate(payload?.imageData, id);
          break;

        case "switchModel":
          await this.handleSwitchModel(payload?.modelId);
          this.postMessage({
            type: "modelLoaded",
            payload: { modelId: payload?.modelId },
            id,
          });
          break;

        case "terminate":
          this.handleTerminate();
          break;

        default:
          throw new Error(`Unknown message type: ${type}`);
      }
    } catch (error) {
      this.postMessage({
        type: "error",
        payload: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
        id,
      });
    }
  }

  /**
   * 初期化処理
   */
  private async handleInit(config?: DepthEstimationConfig): Promise<void> {
    if (!config) {
      throw new Error("Configuration is required for initialization");
    }

    this.config = config;
    await this.loadModel(config.modelId);
    this.isInitialized = true;
  }

  /**
   * モデル読み込み
   */
  private async loadModel(modelId: string): Promise<void> {
    try {
      // モデルとプロセッサを読み込み
      this.model = (await AutoModel.from_pretrained(modelId, {
        device: this.config?.device || "webgpu",
        dtype: "fp32",
      })) as unknown as DepthModel;

      this.processor = (await AutoProcessor.from_pretrained(
        modelId,
        {}
      )) as unknown as DepthProcessor;

      // 入力サイズを設定
      const inputSize = this.config?.inputSize || 504;
      if (this.processor?.feature_extractor) {
        this.processor.feature_extractor.size = {
          width: inputSize,
          height: inputSize,
        };
      }

      // this.currentModelId = modelId;
      console.log(`Worker loaded model: ${modelId}`);
    } catch (error) {
      console.error("Failed to load model in worker:", error);
      throw error;
    }
  }

  /**
   * 深度推定処理
   */
  private async handleEstimate(
    imageData?: ImageData,
    id?: string
  ): Promise<void> {
    if (!this.isInitialized || !this.model || !this.processor) {
      throw new Error("Worker is not initialized");
    }

    if (!imageData) {
      throw new Error("Image data is required");
    }

    const startTime = performance.now();

    try {
      // 画像を準備
      const image = new RawImage(
        imageData.data,
        imageData.width,
        imageData.height,
        4
      );

      // 推論実行
      const inputs = await this.processor(image);
      const { predicted_depth } = await this.model(inputs);

      // 結果を処理
      const result = this.processDepthOutput(
        predicted_depth,
        imageData.width,
        imageData.height,
        performance.now() - startTime
      );

      this.postMessage({
        type: "result",
        payload: { result },
        id,
      });
    } catch (error) {
      throw new Error(`Depth estimation failed: ${error}`);
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
   * モデル切り替え処理
   */
  private async handleSwitchModel(modelId?: string): Promise<void> {
    if (!modelId) {
      throw new Error("Model ID is required");
    }

    await this.loadModel(modelId);
  }

  /**
   * 終了処理
   */
  private handleTerminate(): void {
    this.model = null;
    this.processor = null;
    this.isInitialized = false;
    self.close();
  }

  /**
   * メッセージを送信
   */
  private postMessage(message: DepthEstimationResponse): void {
    self.postMessage(message);
  }
}

// Worker内でのイベントリスナー設定
if (typeof self !== "undefined") {
  const handler = new DepthEstimationWorkerHandler();
  self.addEventListener("message", async (event) => {
    await handler.handleMessage(event);
  });
}

export { DepthEstimationWorkerHandler };

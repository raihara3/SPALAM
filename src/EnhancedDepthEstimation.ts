import { DepthEstimationService } from "./services/DepthEstimationService";
import { DepthEstimationConfig } from "./config/types";
import {
  DepthMapResult,
  DepthEstimationModel,
} from "./types/DepthEstimationModel";
import {
  DepthEstimationMessage,
  DepthEstimationResponse,
} from "./workers/DepthEstimationWorker";

/**
 * 拡張深度推定クラス
 * 複数モデル、並列処理、キャッシュ機能を統合
 */
export class EnhancedDepthEstimation {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  depthCanvas: HTMLCanvasElement;
  depthContext: CanvasRenderingContext2D | null = null;

  private config: DepthEstimationConfig;
  private service: DepthEstimationService;
  private workers: Worker[] = [];
  private workerPool: Worker[] = [];
  private currentWorkerIndex = 0;
  private pendingRequests: Map<
    string,
    (result: DepthMapResult | null) => void
  > = new Map();

  // 状態管理
  // private isProcessing: boolean = false;
  private currentDepthMap: DepthMapResult | null = null;

  // パフォーマンス監視
  private frameRequestTime: number = 0;
  private adaptiveQualityLevel: number = 1.0;

  constructor({
    canvas,
    context,
    config,
  }: {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    config: DepthEstimationConfig;
  }) {
    this.canvas = canvas;
    this.context = context;
    this.config = config;

    // 深度表示用キャンバスを初期化
    this.depthCanvas = document.createElement("canvas");
    this.depthCanvas.id = "enhancedDepthCanvas";
    this.depthCanvas.width = canvas.width;
    this.depthCanvas.height = canvas.height;
    this.depthContext = this.depthCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    if (config.showDepth) {
      document.body.appendChild(this.depthCanvas);
    }

    // サービスを初期化
    this.service = new DepthEstimationService(config);

    // Web Worker プールを初期化
    if (config.pipeline?.parallel?.useWorker) {
      this.initializeWorkerPool();
    }
  }

  /**
   * Worker プールを初期化
   */
  private async initializeWorkerPool(): Promise<void> {
    const numWorkers = this.config.pipeline?.parallel?.numWorkers || 2;

    for (let i = 0; i < numWorkers; i++) {
      try {
        const worker = await this.createWorker();
        this.workers.push(worker);
        this.workerPool.push(worker);
      } catch (error) {
        console.warn(`Failed to create worker ${i}:`, error);
      }
    }
  }

  /**
   * Worker を作成
   */
  private async createWorker(): Promise<Worker> {
    // Worker スクリプトを動的生成
    const workerBlob = new Blob(
      [
        `
      importScripts('https://cdn.jsdelivr.net/npm/@huggingface/transformers');

      // Worker コードをここに注入
      // 現時点ではメインスレッドにフォールバック
      `,
      ],
      { type: "application/javascript" }
    );

    const workerUrl = URL.createObjectURL(workerBlob);
    const worker = new Worker(workerUrl);

    // イベントハンドラを設定
    worker.onmessage = (event: MessageEvent<DepthEstimationResponse>) => {
      this.handleWorkerMessage(event.data);
    };

    worker.onerror = (error) => {
      console.error("Depth estimation worker error:", error);
    };

    // 初期化
    const initMessage: DepthEstimationMessage = {
      type: "init",
      payload: { config: this.config },
    };
    worker.postMessage(initMessage);

    return new Promise((resolve) => {
      const handler = (event: MessageEvent<DepthEstimationResponse>) => {
        if (event.data.type === "ready") {
          worker.removeEventListener("message", handler);
          resolve(worker);
        }
      };
      worker.addEventListener("message", handler);
    });
  }

  /**
   * Worker メッセージを処理
   */
  private handleWorkerMessage(message: DepthEstimationResponse): void {
    const { type, payload, id } = message;

    switch (type) {
      case "result":
        if (id && payload?.result) {
          const callback = this.pendingRequests.get(id);
          if (callback) {
            callback(payload.result);
            this.pendingRequests.delete(id);
          }
        }
        break;

      case "error":
        console.error("Worker error:", payload?.error);
        if (id) {
          const callback = this.pendingRequests.get(id);
          if (callback) {
            callback(null);
            this.pendingRequests.delete(id);
          }
        }
        break;
    }
  }

  /**
   * モデルを読み込み
   */
  async loadModel(modelId?: string): Promise<void> {
    await this.service.loadModel(modelId);

    // Worker にもモデル切り替えを通知
    for (const worker of this.workers) {
      const message: DepthEstimationMessage = {
        type: "switchModel",
        payload: { modelId: modelId || this.config.modelId },
      };
      worker.postMessage(message);
    }
  }

  /**
   * 深度マップを取得
   */
  async getDepthMap(): Promise<DepthMapResult | null> {
    // 適応的品質調整
    if (this.config.performance?.adaptiveQuality) {
      this.adjustQualityLevel();
    }

    // フレームスキップチェック
    if (this.shouldSkipFrame()) {
      return this.currentDepthMap;
    }

    const imageData = this.context.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height
    );

    // 品質調整を適用
    const adjustedImageData = this.applyQualityAdjustment(imageData);

    try {
      let result: DepthMapResult | null;

      if (this.workerPool.length > 0) {
        // Worker を使用して並列処理
        result = await this.estimateDepthWithWorker(adjustedImageData);
      } else {
        // メインスレッドで処理
        result = await this.service.estimateDepth(adjustedImageData);
      }

      if (result) {
        this.currentDepthMap = result;
        this.renderDepthMap(result);
      }

      return result;
    } catch (error) {
      console.error("Depth estimation failed:", error);
      return null;
    }
  }

  /**
   * Worker を使用して深度推定
   */
  private async estimateDepthWithWorker(
    imageData: ImageData
  ): Promise<DepthMapResult | null> {
    return new Promise((resolve) => {
      // ラウンドロビンでWorkerを選択
      const worker = this.workerPool[this.currentWorkerIndex];
      this.currentWorkerIndex =
        (this.currentWorkerIndex + 1) % this.workerPool.length;

      const requestId = `depth_${Date.now()}_${Math.random()}`;
      this.pendingRequests.set(requestId, resolve);

      const message: DepthEstimationMessage = {
        type: "estimate",
        payload: { imageData },
        id: requestId,
      };

      worker.postMessage(message);

      // タイムアウト設定
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          resolve(null);
        }
      }, 5000);
    });
  }

  /**
   * 深度マップをレンダリング
   */
  private renderDepthMap(result: DepthMapResult): void {
    if (!this.depthContext) return;

    const { data, width, height, minDepth, maxDepth } = result;
    const range = maxDepth - minDepth;

    // カラーマップを作成
    const imageData = new Uint8ClampedArray(4 * data.length);

    for (let i = 0; i < data.length; i++) {
      const normalizedDepth = (data[i] - minDepth) / range;
      const color = this.getDepthColor(normalizedDepth);

      const offset = 4 * i;
      imageData[offset] = color.r;
      imageData[offset + 1] = color.g;
      imageData[offset + 2] = color.b;
      imageData[offset + 3] = 255;
    }

    // 一時キャンバスに描画
    const outPixelData = new ImageData(imageData, width, height);
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext("2d")!;
    tempCtx.putImageData(outPixelData, 0, 0);

    // メインキャンバスにスケーリングして描画
    this.depthContext.clearRect(
      0,
      0,
      this.depthCanvas.width,
      this.depthCanvas.height
    );
    this.depthContext.drawImage(
      tempCanvas,
      0,
      0,
      width,
      height,
      0,
      0,
      this.depthCanvas.width,
      this.depthCanvas.height
    );
  }

  /**
   * 深度値から色を取得（改良版カラーマップ）
   */
  private getDepthColor(normalizedDepth: number): {
    r: number;
    g: number;
    b: number;
  } {
    // Viridis風のカラーマップ
    const t = normalizedDepth;

    if (t < 0.25) {
      // 紫から青
      const s = t * 4;
      return {
        r: Math.floor(68 * (1 - s) + 49 * s),
        g: Math.floor(1 * (1 - s) + 54 * s),
        b: Math.floor(84 * (1 - s) + 142 * s),
      };
    } else if (t < 0.5) {
      // 青から緑
      const s = (t - 0.25) * 4;
      return {
        r: Math.floor(49 * (1 - s) + 31 * s),
        g: Math.floor(54 * (1 - s) + 161 * s),
        b: Math.floor(142 * (1 - s) + 152 * s),
      };
    } else if (t < 0.75) {
      // 緑から黄
      const s = (t - 0.5) * 4;
      return {
        r: Math.floor(31 * (1 - s) + 170 * s),
        g: Math.floor(161 * (1 - s) + 220 * s),
        b: Math.floor(152 * (1 - s) + 50 * s),
      };
    } else {
      // 黄から白
      const s = (t - 0.75) * 4;
      return {
        r: Math.floor(170 * (1 - s) + 253 * s),
        g: Math.floor(220 * (1 - s) + 231 * s),
        b: Math.floor(50 * (1 - s) + 36 * s),
      };
    }
  }

  /**
   * フレームをスキップすべきかチェック
   */
  private shouldSkipFrame(): boolean {
    const now = performance.now();
    const timeSinceLastRequest = now - this.frameRequestTime;
    const targetFrameTime = 1000 / (this.config.performance?.maxFPS || 30);

    if (timeSinceLastRequest < targetFrameTime) {
      return true;
    }

    this.frameRequestTime = now;
    return false;
  }

  /**
   * 品質レベルを調整
   */
  private adjustQualityLevel(): void {
    const stats = this.service.getPerformanceStats();
    const targetFPS = this.config.performance?.maxFPS || 30;
    const targetFrameTime = 1000 / targetFPS;

    if (stats.averageInferenceTime > targetFrameTime * 0.8) {
      // 品質を下げる
      this.adaptiveQualityLevel = Math.max(
        0.5,
        this.adaptiveQualityLevel - 0.1
      );
    } else if (stats.averageInferenceTime < targetFrameTime * 0.5) {
      // 品質を上げる
      this.adaptiveQualityLevel = Math.min(
        1.0,
        this.adaptiveQualityLevel + 0.05
      );
    }
  }

  /**
   * 品質調整を適用
   */
  private applyQualityAdjustment(imageData: ImageData): ImageData {
    if (this.adaptiveQualityLevel >= 1.0) {
      return imageData;
    }

    // 画像を縮小
    const scale = this.adaptiveQualityLevel;
    const newWidth = Math.floor(imageData.width * scale);
    const newHeight = Math.floor(imageData.height * scale);

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = newWidth;
    tempCanvas.height = newHeight;
    const tempCtx = tempCanvas.getContext("2d")!;

    // 元の画像を縮小して描画
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = imageData.width;
    sourceCanvas.height = imageData.height;
    const sourceCtx = sourceCanvas.getContext("2d")!;
    sourceCtx.putImageData(imageData, 0, 0);

    tempCtx.drawImage(sourceCanvas, 0, 0, newWidth, newHeight);

    return tempCtx.getImageData(0, 0, newWidth, newHeight);
  }

  /**
   * モデルを切り替え
   */
  async switchModel(modelId: DepthEstimationModel | string): Promise<void> {
    await this.service.switchModel(modelId);
  }

  /**
   * 利用可能なモデルを取得
   */
  getAvailableModels(): string[] {
    return this.service.getAvailableModels();
  }

  /**
   * 現在のモデルを取得
   */
  getCurrentModel(): string {
    return this.service.getCurrentModelId();
  }

  /**
   * パフォーマンス統計を取得
   */
  getPerformanceStats(): {
    averageInferenceTime: number;
    totalFrames: number;
    adaptiveQualityLevel: number;
  } {
    return {
      ...this.service.getPerformanceStats(),
      adaptiveQualityLevel: this.adaptiveQualityLevel,
    };
  }

  /**
   * 設定を更新
   */
  updateConfig(config: Partial<DepthEstimationConfig>): void {
    this.config = { ...this.config, ...config };
    this.service.updateConfig(config);
  }

  /**
   * リソースをクリーンアップ
   */
  dispose(): void {
    // Worker を終了
    for (const worker of this.workers) {
      const message: DepthEstimationMessage = { type: "terminate" };
      worker.postMessage(message);
      worker.terminate();
    }

    this.workers = [];
    this.workerPool = [];
    this.pendingRequests.clear();
  }
}

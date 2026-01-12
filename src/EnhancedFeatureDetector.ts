import { Feature } from "./types";
import { FeatureDetectorConfig } from "./config/types";
import { FeatureDetectionService } from "./services/FeatureDetectionService";
import {
  FeatureDetectionMessage,
  FeatureDetectionResponse,
} from "./workers/FeatureDetectionWorker";

/**
 * 拡張された特徴点検出器
 * 複数のアルゴリズムとWeb Worker対応を統合
 */
export class EnhancedFeatureDetector {
  readonly cv: typeof cv;
  readonly video: HTMLVideoElement;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  private config: FeatureDetectorConfig;
  private detectionService: FeatureDetectionService;
  private worker?: Worker;
  private workerReady = false;

  private prevGray: cv.Mat | null = null;
  private prevFeatures: Feature[] = [];
  // private nextFeatureId: number = 0;

  trackedFeatures: Feature[] = [];
  centerFeature: Feature | null = null;

  constructor({
    cv: cvInstance,
    video,
    canvas = null,
    config,
  }: {
    cv: typeof cv;
    video: HTMLVideoElement;
    canvas?: HTMLCanvasElement | null;
    config: FeatureDetectorConfig;
  }) {
    this.cv = cvInstance;
    this.video = video;
    this.config = config;

    this.canvas = canvas || document.createElement("canvas");
    this.canvas.id = "enhancedFeatureCanvas";
    this.canvas.width = video.videoWidth;
    this.canvas.height = video.videoHeight;

    this.ctx = this.canvas.getContext("2d")!;

    if (config.showFeatures) {
      document.body.appendChild(this.canvas);
    }

    // 特徴点検出サービスの初期化
    this.detectionService = new FeatureDetectionService(cv, config);

    // Web Worker の初期化
    if (config.useWebWorker && typeof Worker !== "undefined") {
      this.initializeWorker();
    }
  }

  /**
   * Web Worker の初期化
   */
  private async initializeWorker(): Promise<void> {
    try {
      // Worker スクリプトの動的生成
      const workerBlob = new Blob(
        [
          `
        importScripts('https://docs.opencv.org/4.x/opencv.js');

        // Worker code would be injected here
        // For now, fallback to main thread
        `,
        ],
        { type: "application/javascript" }
      );

      const workerUrl = URL.createObjectURL(workerBlob);
      this.worker = new Worker(workerUrl);

      this.worker.onmessage = (
        event: MessageEvent<FeatureDetectionResponse>
      ) => {
        this.handleWorkerMessage(event.data);
      };

      this.worker.onerror = (error) => {
        console.warn("Feature detection worker error:", error);
        this.worker = undefined;
        this.workerReady = false;
      };

      // 初期化メッセージを送信
      const initMessage: FeatureDetectionMessage = {
        type: "init",
        payload: { config: this.config },
      };
      this.worker.postMessage(initMessage);
    } catch (error) {
      console.warn("Failed to initialize feature detection worker:", error);
      this.worker = undefined;
      this.workerReady = false;
    }
  }

  /**
   * Worker からのメッセージ処理
   */
  private handleWorkerMessage(message: FeatureDetectionResponse): void {
    switch (message.type) {
      case "ready":
        this.workerReady = true;
        break;

      case "result":
        if (message.payload?.features) {
          this.handleDetectionResult(message.payload.features);
        }
        break;

      case "error":
        console.error("Worker error:", message.payload?.error);
        // フォールバックとしてメインスレッドで処理
        this.fallbackToMainThread();
        break;
    }
  }

  /**
   * 検出結果の処理
   */
  private handleDetectionResult(features: Feature[]): void {
    this.trackedFeatures = features;
    this.drawFeatures(features);
  }

  /**
   * メインスレッドでの処理にフォールバック
   */
  private fallbackToMainThread(): void {
    this.worker = undefined;
    this.workerReady = false;
  }

  public render(): void {
    this.ctx.drawImage(this.video, 0, 0);
    const features = this.detectAndTrackFeatures();
    this.drawFeatures(features);
  }

  /**
   * 特徴点検出とトラッキング
   */
  private detectAndTrackFeatures(): Feature[] {
    const W = this.canvas.width;
    const H = this.canvas.height;

    // マスクを作成
    const mask = this.cv.Mat.zeros(H, W, this.cv.CV_8UC1);
    const roi = this.config.roi;
    const roiX = Math.floor(W * roi.xOffset);
    const roiY = Math.floor(H * roi.yOffset);
    const roiW = Math.floor(W * roi.width);
    const roiH = Math.floor(H * roi.height);
    mask
      .roi(new this.cv.Rect(roiX, roiY, roiW, roiH))
      .setTo(new this.cv.Scalar(255));

    // グレースケール画像を作成
    const src = this.cv.imread(this.canvas);
    const gray = new this.cv.Mat();
    this.cv.cvtColor(src, gray, this.cv.COLOR_RGBA2GRAY);

    try {
      // 初回検出
      if (!this.prevGray) {
        const features = this.detectNewFeatures(gray, mask);
        this.prevFeatures = features;
        this.prevGray = gray.clone();
        return features;
      }

      // オプティカルフローでトラッキング
      const trackedFeatures = this.trackFeatures(gray);

      // 新しい特徴点が必要な場合は追加検出
      if (trackedFeatures.length < this.config.maxCorners * 0.5) {
        const newFeatures = this.detectNewFeatures(gray, mask);
        trackedFeatures.push(...newFeatures);
      }

      // フレーム更新
      this.prevGray.delete();
      this.prevGray = gray.clone();
      this.prevFeatures = trackedFeatures;
      this.trackedFeatures = trackedFeatures;

      return trackedFeatures;
    } finally {
      src.delete();
      gray.delete();
      mask.delete();
    }
  }

  /**
   * 新しい特徴点の検出
   */
  private detectNewFeatures(gray: cv.Mat, mask: cv.Mat): Feature[] {
    if (this.config.useWebWorker && this.worker && this.workerReady) {
      // Web Worker で非同期検出
      const imageData = this.ctx.getImageData(
        0,
        0,
        this.canvas.width,
        this.canvas.height
      );
      const message: FeatureDetectionMessage = {
        type: "detect",
        payload: { imageData },
      };
      // Use Transferable to avoid memory copy (zero-copy transfer)
      this.worker.postMessage(message, [imageData.data.buffer]);

      // 非同期なので、前回の結果を返す
      return this.prevFeatures;
    } else {
      // メインスレッドで同期検出
      return this.detectionService.detectFeatures(gray, mask);
    }
  }

  /** Forward-Backward error threshold in pixels */
  private readonly forwardBackwardThreshold = 1.0;

  /** Motion consistency threshold (standard deviations from median) */
  private readonly motionConsistencyThreshold = 2.0;

  /**
   * 特徴点のトラッキング（Forward-Backward Check + 動きの整合性チェック付き）
   */
  private trackFeatures(gray: cv.Mat): Feature[] {
    if (this.prevFeatures.length === 0 || !this.prevGray) return [];

    const prevPoints = new this.cv.Mat(
      this.prevFeatures.length,
      1,
      this.cv.CV_32FC2
    );
    for (let i = 0; i < this.prevFeatures.length; i++) {
      prevPoints.data32F[i * 2] = this.prevFeatures[i].x;
      prevPoints.data32F[i * 2 + 1] = this.prevFeatures[i].y;
    }

    // Forward: prev -> current
    const nextPoints = new this.cv.Mat();
    const statusForward = new this.cv.Mat();
    const errForward = new this.cv.Mat();

    this.cv.calcOpticalFlowPyrLK(
      this.prevGray,
      gray,
      prevPoints,
      nextPoints,
      statusForward,
      errForward
    );

    // Backward: current -> prev (for Forward-Backward Check)
    const backPoints = new this.cv.Mat();
    const statusBackward = new this.cv.Mat();
    const errBackward = new this.cv.Mat();

    this.cv.calcOpticalFlowPyrLK(
      gray,
      this.prevGray,
      nextPoints,
      backPoints,
      statusBackward,
      errBackward
    );

    // First pass: Forward-Backward Check
    const candidates: Array<{
      feature: Feature;
      newX: number;
      newY: number;
      motionX: number;
      motionY: number;
    }> = [];

    for (let i = 0; i < statusForward.rows; i++) {
      if (statusForward.data[i] !== 1) continue;
      if (statusBackward.data[i] !== 1) continue;

      const origX = prevPoints.data32F[i * 2];
      const origY = prevPoints.data32F[i * 2 + 1];
      const backX = backPoints.data32F[i * 2];
      const backY = backPoints.data32F[i * 2 + 1];

      const fbError = Math.sqrt(
        (origX - backX) * (origX - backX) + (origY - backY) * (origY - backY)
      );

      if (fbError > this.forwardBackwardThreshold) continue;

      const newX = nextPoints.data32F[i * 2];
      const newY = nextPoints.data32F[i * 2 + 1];

      candidates.push({
        feature: this.prevFeatures[i],
        newX,
        newY,
        motionX: newX - origX,
        motionY: newY - origY,
      });
    }

    prevPoints.delete();
    nextPoints.delete();
    statusForward.delete();
    errForward.delete();
    backPoints.delete();
    statusBackward.delete();
    errBackward.delete();

    // Second pass: Motion consistency check
    if (candidates.length < 3) {
      // Not enough points for consistency check
      return candidates.map((c) => ({
        ...c.feature,
        x: c.newX,
        y: c.newY,
        trackingCount: c.feature.trackingCount + 1,
      }));
    }

    // Calculate median motion vector
    const motionsX = candidates.map((c) => c.motionX).sort((a, b) => a - b);
    const motionsY = candidates.map((c) => c.motionY).sort((a, b) => a - b);
    const medianX = motionsX[Math.floor(motionsX.length / 2)];
    const medianY = motionsY[Math.floor(motionsY.length / 2)];

    // Calculate MAD (Median Absolute Deviation) for robust outlier detection
    const deviations = candidates.map((c) =>
      Math.sqrt(
        (c.motionX - medianX) * (c.motionX - medianX) +
          (c.motionY - medianY) * (c.motionY - medianY)
      )
    );
    const sortedDeviations = [...deviations].sort((a, b) => a - b);
    const mad = sortedDeviations[Math.floor(sortedDeviations.length / 2)];

    // Filter out outliers (motion too different from median)
    const threshold = Math.max(mad * this.motionConsistencyThreshold, 2.0);

    const trackedFeatures: Feature[] = [];
    for (let i = 0; i < candidates.length; i++) {
      if (deviations[i] <= threshold) {
        const c = candidates[i];
        trackedFeatures.push({
          ...c.feature,
          x: c.newX,
          y: c.newY,
          trackingCount: c.feature.trackingCount + 1,
        });
      }
    }

    return trackedFeatures;
  }

  /**
   * 特徴点の描画
   */
  private drawFeatures(features: Feature[]): void {
    if (features.length > 0) {
      this.findNearestStableFeature(features);
    }

    features.forEach((feature) => {
      const isCenter =
        this.centerFeature && feature.id === this.centerFeature.id;
      const isStable = feature.trackingCount >= this.config.minTrackingCount;

      this.ctx.beginPath();
      this.ctx.arc(feature.x, feature.y, isCenter ? 5 : 3, 0, 2 * Math.PI);

      if (isCenter) {
        this.ctx.fillStyle = "#FFFF00"; // 黄色: 中心特徴点
      } else if (isStable) {
        this.ctx.fillStyle = "#00FF00"; // 緑色: 安定した特徴点
      } else {
        this.ctx.fillStyle = "#FF0000"; // 赤色: 通常の特徴点
      }

      this.ctx.fill();

      // スコア表示（デバッグ用）
      if (feature.score && this.config.showFeatures) {
        this.ctx.fillStyle = "#FFFFFF";
        this.ctx.font = "10px Arial";
        this.ctx.fillText(
          feature.score.toFixed(2),
          feature.x + 5,
          feature.y - 5
        );
      }
    });
  }

  /**
   * 画面中央に最も近い安定した特徴点を見つける
   */
  private findNearestStableFeature(features: Feature[]): Feature | null {
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;
    let nearestFeature: Feature | null = null;
    let minDistance = Infinity;

    // 現在の中心特徴点が有効な場合は継続使用
    if (this.centerFeature) {
      const currentFeature = features.find(
        (f) => f.id === this.centerFeature!.id && this.isFeatureValid(f)
      );
      if (currentFeature) {
        this.centerFeature = currentFeature;
        return currentFeature;
      }
    }

    // 新しい中心特徴点を探す
    features.forEach((feature) => {
      if (!this.isFeatureValid(feature)) return;

      const distance = Math.sqrt(
        Math.pow(feature.x - centerX, 2) + Math.pow(feature.y - centerY, 2)
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestFeature = feature;
      }
    });

    this.centerFeature = nearestFeature;
    return nearestFeature;
  }

  /**
   * 特徴点の有効性チェック
   */
  private isFeatureValid(feature: Feature): boolean {
    return (
      feature.x >= 0 &&
      feature.x <= this.canvas.width &&
      feature.y >= 0 &&
      feature.y <= this.canvas.height &&
      feature.trackingCount >= this.config.minTrackingCount &&
      feature.x > this.canvas.width * 0.1 &&
      feature.x < this.canvas.width * 0.9 &&
      feature.y > this.canvas.height * 0.1 &&
      feature.y < this.canvas.height * 0.9
    );
  }

  public getTrackedFeaturePoints(): Feature[] {
    return this.trackedFeatures.filter(
      (feature) => feature.trackingCount >= this.config.minTrackingCount
    );
  }

  public reset(): void {
    if (this.prevGray) {
      this.prevGray.delete();
      this.prevGray = null;
    }
    this.prevFeatures = [];
    this.trackedFeatures = [];
    this.centerFeature = null;
  }

  /**
   * 設定の更新
   */
  public updateConfig(config: Partial<FeatureDetectorConfig>): void {
    this.config = { ...this.config, ...config };
    this.detectionService.updateConfig(this.config);

    if (this.worker && this.workerReady) {
      const updateMessage: FeatureDetectionMessage = {
        type: "init",
        payload: { config: this.config },
      };
      this.worker.postMessage(updateMessage);
    }
  }

  /**
   * リソースのクリーンアップ
   */
  public dispose(): void {
    this.reset();

    if (this.worker) {
      const terminateMessage: FeatureDetectionMessage = {
        type: "terminate",
      };
      this.worker.postMessage(terminateMessage);
      this.worker.terminate();
      this.worker = undefined;
    }
  }

  // private generateFeatureId(): string {
  //   return `enhanced_feature_${this.nextFeatureId++}`;
  // }
}

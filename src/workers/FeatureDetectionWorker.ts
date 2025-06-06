/**
 * Web Worker for feature detection
 * 特徴点検出をメインスレッドから分離してパフォーマンスを向上
 */

import { Feature } from "../types/Feature";
import {
  FeatureDetectionAlgorithm,
  AlgorithmConfig,
} from "../types/FeatureDetectionAlgorithm";
import { FeatureDetectorConfig } from "../config/types";

// Worker内で利用可能なOpenCVのタイプ
declare const cv: any;

/**
 * Workerに送信するメッセージの型
 */
export interface FeatureDetectionMessage {
  type: "detect" | "init" | "terminate";
  payload?: {
    imageData?: ImageData;
    config?: FeatureDetectorConfig;
    mask?: any;
  };
}

/**
 * Workerから返されるメッセージの型
 */
export interface FeatureDetectionResponse {
  type: "result" | "error" | "ready";
  payload?: {
    features?: Feature[];
    error?: string;
  };
}

/**
 * Web Workerでの特徴点検出処理
 */
class FeatureDetectionWorkerHandler {
  private config: FeatureDetectorConfig | null = null;
  private isInitialized = false;
  private nextFeatureId = 0;

  constructor() {
    // OpenCVの初期化を待つ
    if (typeof cv !== "undefined" && cv.onRuntimeInitialized) {
      cv.onRuntimeInitialized = () => {
        this.isInitialized = true;
        this.postMessage({ type: "ready" });
      };
    } else {
      // OpenCVが既に読み込まれている場合
      this.isInitialized = true;
      this.postMessage({ type: "ready" });
    }
  }

  /**
   * メッセージ処理
   */
  public handleMessage(event: MessageEvent<FeatureDetectionMessage>): void {
    const { type, payload } = event.data;

    try {
      switch (type) {
        case "init":
          this.handleInit(payload?.config);
          break;

        case "detect":
          this.handleDetect(payload?.imageData, payload?.mask);
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
      });
    }
  }

  /**
   * 初期化処理
   */
  private handleInit(config?: FeatureDetectorConfig): void {
    if (!config) {
      throw new Error("Configuration is required for initialization");
    }

    this.config = config;
    this.postMessage({ type: "ready" });
  }

  /**
   * 特徴点検出処理
   */
  private handleDetect(imageData?: ImageData, _maskData?: any): void {
    if (!this.isInitialized) {
      throw new Error("Worker is not initialized");
    }

    if (!this.config) {
      throw new Error("Configuration is not set");
    }

    if (!imageData) {
      throw new Error("Image data is required");
    }

    // ImageDataからOpenCV Matに変換
    const image = cv.matFromImageData(imageData);
    const gray = new cv.Mat();
    cv.cvtColor(image, gray, cv.COLOR_RGBA2GRAY);

    // マスクの作成
    const mask = this.createMask(gray.rows, gray.cols);

    try {
      // 特徴点検出
      const features = this.detectFeatures(gray, mask);

      this.postMessage({
        type: "result",
        payload: { features },
      });
    } finally {
      // メモリクリーンアップ
      image.delete();
      gray.delete();
      mask.delete();
    }
  }

  /**
   * マスクを作成
   */
  private createMask(height: number, width: number): any {
    const mask = new cv.Mat.zeros(height, width, cv.CV_8UC1);
    const roi = this.config!.roi;

    const roiX = Math.floor(width * roi.xOffset);
    const roiY = Math.floor(height * roi.yOffset);
    const roiW = Math.floor(width * roi.width);
    const roiH = Math.floor(height * roi.height);

    mask.roi(new cv.Rect(roiX, roiY, roiW, roiH)).setTo(new cv.Scalar(255));

    return mask;
  }

  /**
   * 特徴点検出
   */
  private detectFeatures(image: any, mask: any): Feature[] {
    const allFeatures: Feature[][] = [];
    const algorithmWeights: number[] = [];

    // 各アルゴリズムで特徴点検出を実行
    for (const algorithmConfig of this.config!.algorithms) {
      try {
        const features = this.detectWithAlgorithm(image, mask, algorithmConfig);
        allFeatures.push(features);

        const weight =
          this.config!.algorithmWeights?.[algorithmConfig.algorithm] || 1.0;
        algorithmWeights.push(weight);
      } catch (error) {
        console.warn(
          `Failed to detect features with ${algorithmConfig.algorithm}:`,
          error
        );
        allFeatures.push([]);
        algorithmWeights.push(0);
      }
    }

    // 結果を統合
    return this.mergeFeatures(allFeatures, algorithmWeights);
  }

  /**
   * 指定されたアルゴリズムで特徴点検出
   */
  private detectWithAlgorithm(
    image: any,
    mask: any,
    algorithmConfig: AlgorithmConfig
  ): Feature[] {
    switch (algorithmConfig.algorithm) {
      case FeatureDetectionAlgorithm.SHI_TOMASI:
        return this.detectShiTomasiFeatures(image, mask);

      case FeatureDetectionAlgorithm.FAST:
        return this.detectFastFeatures(image, mask);

      case FeatureDetectionAlgorithm.ORB:
        return this.detectOrbFeatures(image, mask);

      default:
        throw new Error(`Unsupported algorithm: ${algorithmConfig.algorithm}`);
    }
  }

  /**
   * Shi-Tomasi特徴点検出
   */
  private detectShiTomasiFeatures(image: any, mask: any): Feature[] {
    const params = this.config!.algorithmParams.shiTomasi!;
    const points = new cv.Mat();

    cv.goodFeaturesToTrack(
      image,
      points,
      this.config!.maxCorners,
      params.qualityLevel,
      params.minDistance,
      mask,
      params.blockSize,
      params.useHarrisDetector,
      params.k
    );

    const features: Feature[] = [];
    for (let i = 0; i < points.rows; i++) {
      features.push({
        x: points.data32F[i * 2],
        y: points.data32F[i * 2 + 1],
        trackingCount: 1,
        id: this.generateFeatureId(),
      });
    }

    points.delete();
    return features;
  }

  /**
   * FAST特徴点検出
   */
  private detectFastFeatures(image: any, mask: any): Feature[] {
    const params = this.config!.algorithmParams.fast!;
    const keypoints = new cv.KeyPointVector();
    const detector = new cv.FastFeatureDetector_create(
      params.threshold,
      params.nonmaxSuppression,
      params.type
    );

    detector.detect(image, keypoints, mask);

    const features: Feature[] = [];
    for (let i = 0; i < keypoints.size(); i++) {
      const kp = keypoints.get(i);
      features.push({
        x: kp.pt.x,
        y: kp.pt.y,
        trackingCount: 1,
        id: this.generateFeatureId(),
        score: kp.response,
      });
    }

    detector.delete();
    keypoints.delete();
    return features;
  }

  /**
   * ORB特徴点検出
   */
  private detectOrbFeatures(image: any, mask: any): Feature[] {
    const params = this.config!.algorithmParams.orb!;
    const keypoints = new cv.KeyPointVector();
    const descriptors = new cv.Mat();

    const detector = new cv.ORB_create(
      params.nfeatures,
      params.scaleFactor,
      params.nlevels,
      params.edgeThreshold,
      params.firstLevel,
      params.WTA_K,
      params.scoreType,
      params.patchSize,
      params.fastThreshold
    );

    detector.detectAndCompute(image, mask, keypoints, descriptors);

    const features: Feature[] = [];
    for (let i = 0; i < keypoints.size(); i++) {
      const kp = keypoints.get(i);
      features.push({
        x: kp.pt.x,
        y: kp.pt.y,
        trackingCount: 1,
        id: this.generateFeatureId(),
        score: kp.response,
        angle: kp.angle,
        octave: kp.octave,
      });
    }

    detector.delete();
    keypoints.delete();
    descriptors.delete();
    return features;
  }

  /**
   * 複数アルゴリズムの結果を統合
   */
  private mergeFeatures(
    featureSets: Feature[][],
    _weights: number[]
  ): Feature[] {
    if (featureSets.length === 0) return [];
    if (featureSets.length === 1) return featureSets[0];

    // 簡単な和集合統合（Worker内では軽量な処理を優先）
    const allFeatures: Feature[] = [];
    const distanceThreshold = this.config!.minDistance;

    for (const features of featureSets) {
      for (const feature of features) {
        const isDuplicate = allFeatures.some((existing) => {
          const distance = Math.sqrt(
            Math.pow(existing.x - feature.x, 2) +
              Math.pow(existing.y - feature.y, 2)
          );
          return distance < distanceThreshold;
        });

        if (!isDuplicate) {
          allFeatures.push(feature);
        }
      }
    }

    // スコア順にソートして制限
    allFeatures.sort((a, b) => (b.score || 0) - (a.score || 0));
    return allFeatures.slice(0, this.config!.maxCorners);
  }

  /**
   * 特徴点IDを生成
   */
  private generateFeatureId(): string {
    return `worker_feature_${this.nextFeatureId++}`;
  }

  /**
   * 終了処理
   */
  private handleTerminate(): void {
    // クリーンアップ処理
    this.isInitialized = false;
    this.config = null;
    self.close();
  }

  /**
   * メッセージを送信
   */
  private postMessage(message: FeatureDetectionResponse): void {
    self.postMessage(message);
  }
}

// Worker内でのイベントリスナー設定
if (typeof self !== "undefined") {
  const handler = new FeatureDetectionWorkerHandler();
  self.addEventListener("message", (event) => {
    handler.handleMessage(event);
  });
}

export { FeatureDetectionWorkerHandler };

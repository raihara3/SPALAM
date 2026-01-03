import { Feature } from "../types";
import {
  FeatureDetectionAlgorithm,
  AlgorithmConfig,
} from "../types/FeatureDetectionAlgorithm";
import { FeatureDetectorConfig } from "../config/types";

/**
 * 特徴点検出サービス
 * 複数のアルゴリズムによる特徴点検出を統合管理
 */
export class FeatureDetectionService {
  private cv: typeof cv;
  private config: FeatureDetectorConfig;
  private nextFeatureId: number = 0;
  private currentDescriptors: cv.Mat | null = null;

  constructor(cvInstance: typeof cv, config: FeatureDetectorConfig) {
    this.cv = cvInstance;
    this.config = config;
  }

  /**
   * 設定されたアルゴリズムで特徴点を検出
   */
  public detectFeatures(image: cv.Mat, mask: cv.Mat): Feature[] {
    const allFeatures: Feature[][] = [];
    const algorithmWeights: number[] = [];

    // 各アルゴリズムで特徴点検出を実行
    for (const algorithmConfig of this.config.algorithms) {
      try {
        const features = this.detectWithAlgorithm(image, mask, algorithmConfig);
        allFeatures.push(features);

        // 重みを取得
        const weight =
          this.config.algorithmWeights?.[algorithmConfig.algorithm] || 1.0;
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

    // 複数アルゴリズムの結果を統合
    return this.mergeFeatures(allFeatures, algorithmWeights);
  }

  /**
   * 指定されたアルゴリズムで特徴点検出
   */
  private detectWithAlgorithm(
    image: cv.Mat,
    mask: cv.Mat,
    algorithmConfig: AlgorithmConfig
  ): Feature[] {
    switch (algorithmConfig.algorithm) {
      case FeatureDetectionAlgorithm.HARRIS:
        return this.detectHarrisFeatures(image, mask);

      case FeatureDetectionAlgorithm.SHI_TOMASI:
        return this.detectShiTomasiFeatures(image, mask);

      case FeatureDetectionAlgorithm.FAST:
        return this.detectFastFeatures(image, mask);

      case FeatureDetectionAlgorithm.ORB:
        return this.detectOrbFeatures(image, mask);

      case FeatureDetectionAlgorithm.SIFT:
        return this.detectSiftFeatures(image, mask);

      default:
        throw new Error(`Unsupported algorithm: ${algorithmConfig.algorithm}`);
    }
  }

  /**
   * Harris Corner Detection
   */
  private detectHarrisFeatures(image: cv.Mat, _mask: cv.Mat): Feature[] {
    const params = this.config.algorithmParams.harris!;
    const corners = new this.cv.Mat();

    this.cv.cornerHarris(image, corners, params.blockSize, 3, params.k);

    // 非極大値抑制と閾値処理
    const features: Feature[] = [];
    const data = corners.data32F;
    const { rows, cols } = corners;

    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const idx = y * cols + x;
        const value = data[idx];

        if (value > params.threshold) {
          // 近傍で最大値かチェック
          let isMaximum = true;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const neighborIdx = (y + dy) * cols + (x + dx);
              if (data[neighborIdx] >= value) {
                isMaximum = false;
                break;
              }
            }
            if (!isMaximum) break;
          }

          if (isMaximum) {
            features.push({
              x,
              y,
              trackingCount: 1,
              id: this.generateFeatureId(),
              score: value,
            });
          }
        }
      }
    }

    corners.delete();
    return this.limitAndSortFeatures(features);
  }

  /**
   * Shi-Tomasi Corner Detection (goodFeaturesToTrack)
   */
  private detectShiTomasiFeatures(image: cv.Mat, mask: cv.Mat): Feature[] {
    const params = this.config.algorithmParams.shiTomasi!;
    const points = new this.cv.Mat();

    this.cv.goodFeaturesToTrack(
      image,
      points,
      this.config.maxCorners,
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
   * FAST Feature Detection
   */
  private detectFastFeatures(image: cv.Mat, mask: cv.Mat): Feature[] {
    const params = this.config.algorithmParams.fast!;
    const keypoints = new this.cv.KeyPointVector();
    const detector = this.cv.FastFeatureDetector_create(
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
    return this.limitAndSortFeatures(features);
  }

  /**
   * ORB Feature Detection
   */
  private detectOrbFeatures(image: cv.Mat, mask: cv.Mat): Feature[] {
    const params = this.config.algorithmParams.orb!;
    const keypoints = new this.cv.KeyPointVector();
    const descriptors = new this.cv.Mat();

    const detector = this.cv.ORB_create(
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

    // Store descriptors for pose estimation (caller manages lifecycle)
    this.disposeDescriptors();
    this.currentDescriptors = descriptors;

    return this.limitAndSortFeatures(features);
  }

  /**
   * SIFT Feature Detection
   */
  private detectSiftFeatures(image: cv.Mat, mask: cv.Mat): Feature[] {
    const params = this.config.algorithmParams.sift!;
    const keypoints = new this.cv.KeyPointVector();
    const descriptors = new this.cv.Mat();

    const detector = this.cv.SIFT_create(
      params.nfeatures,
      params.nOctaveLayers,
      params.contrastThreshold,
      params.edgeThreshold,
      params.sigma
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
        size: kp.size,
      });
    }

    detector.delete();
    keypoints.delete();

    // Store descriptors for pose estimation (caller manages lifecycle)
    this.disposeDescriptors();
    this.currentDescriptors = descriptors;

    return this.limitAndSortFeatures(features);
  }

  /**
   * 複数アルゴリズムの特徴点を統合
   */
  private mergeFeatures(
    featureSets: Feature[][],
    weights: number[]
  ): Feature[] {
    if (featureSets.length === 0) return [];
    if (featureSets.length === 1) return featureSets[0];

    switch (this.config.mergeStrategy) {
      case "union":
        return this.mergeUnion(featureSets);

      case "intersection":
        return this.mergeIntersection(featureSets);

      case "weighted":
        return this.mergeWeighted(featureSets, weights);

      default:
        return this.mergeUnion(featureSets);
    }
  }

  /**
   * 和集合による統合
   */
  private mergeUnion(featureSets: Feature[][]): Feature[] {
    const allFeatures: Feature[] = [];
    const distanceThreshold = this.config.minDistance;

    for (const features of featureSets) {
      for (const feature of features) {
        // 既存の特徴点と重複していないかチェック
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

    return this.limitAndSortFeatures(allFeatures);
  }

  /**
   * 積集合による統合（近接する特徴点のみ）
   */
  private mergeIntersection(featureSets: Feature[][]): Feature[] {
    if (featureSets.length === 0) return [];

    const firstSet = featureSets[0];
    const commonFeatures: Feature[] = [];
    const distanceThreshold = this.config.minDistance * 2;

    for (const feature of firstSet) {
      let isCommon = true;

      for (let i = 1; i < featureSets.length; i++) {
        const hasNearby = featureSets[i].some((other) => {
          const distance = Math.sqrt(
            Math.pow(other.x - feature.x, 2) + Math.pow(other.y - feature.y, 2)
          );
          return distance < distanceThreshold;
        });

        if (!hasNearby) {
          isCommon = false;
          break;
        }
      }

      if (isCommon) {
        commonFeatures.push(feature);
      }
    }

    return commonFeatures;
  }

  /**
   * 重み付き統合
   */
  private mergeWeighted(
    featureSets: Feature[][],
    weights: number[]
  ): Feature[] {
    const mergedFeatures: Feature[] = [];
    const distanceThreshold = this.config.minDistance;

    // 重み付きスコアで特徴点を評価
    for (let i = 0; i < featureSets.length; i++) {
      const features = featureSets[i];
      const weight = weights[i];

      for (const feature of features) {
        const weightedScore = (feature.score || 1.0) * weight;

        // 近接する既存特徴点を検索
        const nearbyIndex = mergedFeatures.findIndex((existing) => {
          const distance = Math.sqrt(
            Math.pow(existing.x - feature.x, 2) +
              Math.pow(existing.y - feature.y, 2)
          );
          return distance < distanceThreshold;
        });

        if (nearbyIndex >= 0) {
          // 既存の特徴点とスコアを比較
          const existingScore = mergedFeatures[nearbyIndex].score || 1.0;
          if (weightedScore > existingScore) {
            mergedFeatures[nearbyIndex] = {
              ...feature,
              score: weightedScore,
            };
          }
        } else {
          // 新しい特徴点として追加
          mergedFeatures.push({
            ...feature,
            score: weightedScore,
          });
        }
      }
    }

    return this.limitAndSortFeatures(mergedFeatures);
  }

  /**
   * 特徴点を制限し、スコア順にソート
   */
  private limitAndSortFeatures(features: Feature[]): Feature[] {
    // スコア順にソート（高い順）
    features.sort((a, b) => (b.score || 0) - (a.score || 0));

    // 最大数に制限
    return features.slice(0, this.config.maxCorners);
  }

  /**
   * 特徴点IDを生成
   */
  private generateFeatureId(): string {
    return `feature_${this.nextFeatureId++}`;
  }

  /**
   * 設定を更新
   */
  public updateConfig(config: FeatureDetectorConfig): void {
    this.config = config;
  }

  /**
   * Get current descriptors for pose estimation
   * Caller should NOT delete the returned Mat
   */
  public getDescriptors(): cv.Mat | null {
    return this.currentDescriptors;
  }

  /**
   * Dispose stored descriptors
   * Call when descriptors are no longer needed
   */
  public disposeDescriptors(): void {
    if (this.currentDescriptors) {
      this.currentDescriptors.delete();
      this.currentDescriptors = null;
    }
  }
}

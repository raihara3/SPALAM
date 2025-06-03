/**
 * SPALAM設定型定義
 */

/**
 * 特徴点検出の設定
 */
export interface FeatureDetectorConfig {
  /** 最大特徴点数 */
  maxCorners: number;
  /** 特徴点の質（小さいほど高品質） */
  qualityLevel: number;
  /** 特徴点間の最小距離 */
  minDistance: number;
  /** 特徴点検出のための近傍領域のサイズ（奇数） */
  blockSize: number;
  /** Harrisコーナー検出器を使用するか */
  useHarrisDetector: boolean;
  /** Harrisコーナー検出器のパラメータ（通常0.04-0.06） */
  k: number;
  /** 特徴点表示を有効にするか */
  showFeatures: boolean;
  /** 安定した特徴点と判定するための最小追跡フレーム数 */
  minTrackingCount: number;
  /** ROI（関心領域）の設定 */
  roi: {
    /** X座標のオフセット（画像幅に対する比率） */
    xOffset: number;
    /** Y座標のオフセット（画像高さに対する比率） */
    yOffset: number;
    /** 幅（画像幅に対する比率） */
    width: number;
    /** 高さ（画像高さに対する比率） */
    height: number;
  };
}

/**
 * 深度推定の設定
 */
export interface DepthEstimationConfig {
  /** 使用するモデルID */
  modelId: string;
  /** 推論デバイス */
  device: "cpu" | "webgpu";
  /** 深度マップ表示を有効にするか */
  showDepth: boolean;
  /** モデル入力サイズ */
  inputSize: number;
}

/**
 * 平面推定の設定
 */
export interface PlaneEstimationConfig {
  /** RANSACの反復回数 */
  ransacIterations: number;
  /** RANSACのインライア判定閾値 */
  ransacThreshold: number;
  /** 平滑化の反復回数 */
  smoothingIterations: number;
  /** 深度フィルタのデルタ値 */
  depthFilterDelta: number;
  /** 重み付き平面フィッティングの設定 */
  weights: {
    /** 再投影誤差の重みパラメータ */
    reprojectionSigma: number;
    /** 最小重み */
    minWeight: number;
    /** 追跡安定性の最大フレーム数 */
    maxTrackingFrames: number;
  };
}

/**
 * ARレンダリングの設定
 */
export interface ARRendererConfig {
  /** カメラの視野角 */
  fov: number;
  /** ニアクリップ面 */
  near: number;
  /** ファークリップ面 */
  far: number;
  /** 平面メッシュの設定 */
  planeMesh: {
    /** 色 */
    color: number;
    /** 不透明度 */
    opacity: number;
  };
  /** 凸包メッシュの設定 */
  hullMesh: {
    /** 色 */
    color: number;
    /** 不透明度 */
    opacity: number;
  };
}

/**
 * SPALAM全体の設定
 */
export interface SPALAMConfig {
  /** 特徴点検出の設定 */
  features: FeatureDetectorConfig;
  /** 深度推定の設定 */
  depth: DepthEstimationConfig;
  /** 平面推定の設定 */
  plane: PlaneEstimationConfig;
  /** ARレンダリングの設定 */
  renderer: ARRendererConfig;
}

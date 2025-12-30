/**
 * 深度推定モデルの種類
 */
export enum DepthEstimationModel {
  /** Depth Anything V2 Small */
  DEPTH_ANYTHING_V2_SMALL = "onnx-community/depth-anything-v2-small",
  /** Depth Anything V2 Base */
  DEPTH_ANYTHING_V2_BASE = "onnx-community/depth-anything-v2-base",
  /** Depth Anything V2 Large */
  DEPTH_ANYTHING_V2_LARGE = "onnx-community/depth-anything-v2-large",
  /** MiDaS Small */
  MIDAS_SMALL = "isl-org/MiDaS-small",
  /** MiDaS DPT Hybrid */
  MIDAS_DPT_HYBRID = "Intel/dpt-hybrid-midas",
  /** MiDaS DPT Large */
  MIDAS_DPT_LARGE = "Intel/dpt-large",
  /** ZoeDepth */
  ZOE_DEPTH = "Intel/zoedepth-nyu-kitti",
}

/**
 * 推論エンジンの種類
 */
export enum InferenceEngine {
  /** WebGPU (高速、GPU必須) */
  WEBGPU = "webgpu",
  /** WebGL (互換性重視) */
  WEBGL = "webgl",
  /** WASM (CPU、互換性最優先) */
  WASM = "wasm",
  /** ONNX Runtime Web */
  ONNX = "onnx",
}

/**
 * モデル設定
 */
export interface ModelConfig {
  /** モデルID */
  modelId: DepthEstimationModel | string;
  /** 入力サイズ */
  inputSize: number;
  /** 正規化パラメータ */
  normalization?: {
    mean: number[];
    std: number[];
  };
  /** モデル固有の設定 */
  modelSpecific?: Record<string, unknown>;
}

/**
 * エンジン設定
 */
export interface EngineConfig {
  /** 推論エンジン */
  engine: InferenceEngine;
  /** デバイス設定 */
  device?: "cpu" | "gpu" | "auto";
  /** 精度設定 */
  precision?: "fp32" | "fp16" | "int8";
  /** エンジン固有の設定 */
  engineOptions?: Record<string, unknown>;
}

/**
 * 深度推定パイプライン設定
 */
export interface DepthPipelineConfig {
  /** モデル設定 */
  model: ModelConfig;
  /** エンジン設定 */
  engine: EngineConfig;
  /** バッチサイズ */
  batchSize?: number;
  /** 並列処理設定 */
  parallel?: {
    /** Web Worker を使用するか */
    useWorker: boolean;
    /** ワーカー数 */
    numWorkers?: number;
  };
  /** 後処理設定 */
  postProcessing?: {
    /** ガウシアンブラー */
    gaussianBlur?: boolean;
    /** バイラテラルフィルタ */
    bilateralFilter?: boolean;
    /** 時間的平滑化 */
    temporalSmoothing?: boolean;
  };
}

/**
 * 深度マップ結果
 */
export interface DepthMapResult {
  /** 深度データ */
  data: Float32Array;
  /** 幅 */
  width: number;
  /** 高さ */
  height: number;
  /** 最小深度値 */
  minDepth: number;
  /** 最大深度値 */
  maxDepth: number;
  /** タイムスタンプ */
  timestamp: number;
  /** 推論時間（ミリ秒） */
  inferenceTime?: number;
}

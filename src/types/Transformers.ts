/**
 * Hugging Face Transformers types for depth estimation
 */

/**
 * Model output tensor with depth prediction
 */
export interface DepthTensor {
  /** Raw depth data as Float32Array */
  data: Float32Array;
  /** Tensor dimensions [batch_size, height, width] */
  dims: [number, number, number];
}

/**
 * Model inference result containing predicted depth
 */
export interface DepthModelOutput {
  /** Predicted depth tensor */
  predicted_depth: DepthTensor;
}

/**
 * Feature extractor configuration
 */
export interface FeatureExtractorConfig {
  /** Image size configuration */
  size?: {
    width: number;
    height: number;
  };
}

/**
 * Processor with feature extractor
 */
export interface DepthProcessor {
  /** Feature extractor with size settings */
  feature_extractor: FeatureExtractorConfig;
  /** Process image for model input */
  (image: unknown): Promise<unknown>;
}

/**
 * Depth estimation model interface
 */
export interface DepthModel {
  /** Run inference on processed inputs */
  (inputs: unknown): Promise<DepthModelOutput>;
}

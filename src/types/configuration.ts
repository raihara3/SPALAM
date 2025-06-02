export interface SPALAMConfig {
  camera: CameraConfig;
  featureDetection: FeatureDetectionConfig;
  depthEstimation: DepthEstimationConfig;
  planeEstimation: PlaneEstimationConfig;
  rendering: RenderingConfig;
}

export interface CameraConfig {
  facingMode: "user" | "environment";
  resolution: {
    width: number;
    height: number;
  };
}

export interface FeatureDetectionConfig {
  maxCorners: number;
  qualityLevel: number;
  minDistance: number;
  blockSize: number;
  useHarrisDetector: boolean;
  k: number;
  trackingFrames: number;
  roiEnabled: boolean;
  roiSize: { width: number; height: number };
}

export interface DepthEstimationConfig {
  modelId: string;
  device: "webgpu" | "cpu";
  dtype: "fp16" | "fp32";
  size: number;
  showDepth: boolean;
}

export interface PlaneEstimationConfig {
  maxFittingCount: number;
  depthFilterThreshold: number;
  ransac: RANSACConfig;
  weightedFitting: WeightedFittingConfig;
}

export interface RANSACConfig {
  maxIterations: number;
  threshold: number;
  minInliers: number;
  maxAttempts: number;
}

export interface WeightedFittingConfig {
  reprojectionSigma: number;
  trackingFrameWeight: number;
  minWeight: number;
  enableGradientWeight: boolean;
}

export interface RenderingConfig {
  width: number;
  height: number;
  planeMaterial: {
    color: number;
    opacity: number;
    transparent: boolean;
  };
  shapeMaterial: {
    color: number;
    opacity: number;
    transparent: boolean;
  };
  camera: {
    fov: number;
    near: number;
    far: number;
  };
}

export const DEFAULT_CONFIG: SPALAMConfig = {
  camera: {
    facingMode: "environment",
    resolution: { width: 640, height: 480 },
  },
  featureDetection: {
    maxCorners: 800,
    qualityLevel: 0.001,
    minDistance: 5,
    blockSize: 3,
    useHarrisDetector: false,
    k: 0.04,
    trackingFrames: 3,
    roiEnabled: true,
    roiSize: { width: 0.5, height: 0.5 },
  },
  depthEstimation: {
    modelId: "onnx-community/depth-anything-v2-small",
    device: "webgpu",
    dtype: "fp16",
    size: 504,
    showDepth: false,
  },
  planeEstimation: {
    maxFittingCount: 3,
    depthFilterThreshold: 0.5,
    ransac: {
      maxIterations: 100,
      threshold: 0.1,
      minInliers: 3,
      maxAttempts: 3,
    },
    weightedFitting: {
      reprojectionSigma: 0.5,
      trackingFrameWeight: 5,
      minWeight: 0.1,
      enableGradientWeight: true,
    },
  },
  rendering: {
    width: 640,
    height: 480,
    planeMaterial: {
      color: 0x8888ff,
      opacity: 0.3,
      transparent: true,
    },
    shapeMaterial: {
      color: 0x44ff44,
      opacity: 0.5,
      transparent: true,
    },
    camera: {
      fov: 75,
      near: 0.1,
      far: 1000,
    },
  },
};

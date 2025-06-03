import { SPALAMConfig } from "./types";

/**
 * SPALAMのデフォルト設定
 */
export const defaultConfig: SPALAMConfig = {
  features: {
    maxCorners: 800,
    qualityLevel: 0.001,
    minDistance: 5,
    blockSize: 3,
    useHarrisDetector: false,
    k: 0.04,
    showFeatures: true,
    minTrackingCount: 5,
    roi: {
      xOffset: 0.25,
      yOffset: 0.25,
      width: 0.5,
      height: 0.5,
    },
  },
  depth: {
    modelId: "onnx-community/depth-anything-v2-small",
    device: "webgpu",
    showDepth: true,
    inputSize: 504,
  },
  plane: {
    ransacIterations: 100,
    ransacThreshold: 0.1,
    smoothingIterations: 3,
    depthFilterDelta: 0.025,
    weights: {
      reprojectionSigma: 0.5,
      minWeight: 0.1,
      maxTrackingFrames: 5,
    },
  },
  renderer: {
    fov: 75,
    near: 0.1,
    far: 1000,
    planeMesh: {
      color: 0x8888ff,
      opacity: 0.3,
    },
    hullMesh: {
      color: 0x44ff44,
      opacity: 0.5,
    },
  },
};

/**
 * 部分的な設定をデフォルト設定とマージ
 */
export function mergeWithDefaults(
  config?: Partial<SPALAMConfig>
): SPALAMConfig {
  if (!config) return defaultConfig;

  return {
    features: {
      ...defaultConfig.features,
      ...(config.features || {}),
      roi: {
        ...defaultConfig.features.roi,
        ...(config.features?.roi || {}),
      },
    },
    depth: {
      ...defaultConfig.depth,
      ...(config.depth || {}),
    },
    plane: {
      ...defaultConfig.plane,
      ...(config.plane || {}),
      weights: {
        ...defaultConfig.plane.weights,
        ...(config.plane?.weights || {}),
      },
    },
    renderer: {
      ...defaultConfig.renderer,
      ...(config.renderer || {}),
      planeMesh: {
        ...defaultConfig.renderer.planeMesh,
        ...(config.renderer?.planeMesh || {}),
      },
      hullMesh: {
        ...defaultConfig.renderer.hullMesh,
        ...(config.renderer?.hullMesh || {}),
      },
    },
  };
}

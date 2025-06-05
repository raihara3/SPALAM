import { SPALAMConfig } from "./types";
import { FeatureDetectionAlgorithm } from "../types/FeatureDetectionAlgorithm";

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
    algorithms: [
      { algorithm: FeatureDetectionAlgorithm.SHI_TOMASI }
    ],
    algorithmParams: {
      harris: {
        k: 0.04,
        blockSize: 3,
        threshold: 0.01
      },
      shiTomasi: {
        qualityLevel: 0.001,
        minDistance: 5,
        blockSize: 3,
        useHarrisDetector: false,
        k: 0.04
      },
      fast: {
        threshold: 50,
        nonmaxSuppression: true,
        type: 2 // TYPE_9_16
      },
      orb: {
        nfeatures: 500,
        scaleFactor: 1.2,
        nlevels: 8,
        edgeThreshold: 31,
        firstLevel: 0,
        WTA_K: 2,
        scoreType: 0, // HARRIS_SCORE
        patchSize: 31,
        fastThreshold: 20
      },
      sift: {
        nfeatures: 0,
        nOctaveLayers: 3,
        contrastThreshold: 0.04,
        edgeThreshold: 10,
        sigma: 1.6
      }
    },
    useWebWorker: false,
    mergeStrategy: "union",
    algorithmWeights: {
      [FeatureDetectionAlgorithm.HARRIS]: 1.0,
      [FeatureDetectionAlgorithm.SHI_TOMASI]: 1.0,
      [FeatureDetectionAlgorithm.FAST]: 0.8,
      [FeatureDetectionAlgorithm.ORB]: 0.9,
      [FeatureDetectionAlgorithm.SIFT]: 1.2
    } as Record<FeatureDetectionAlgorithm, number>
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
      algorithms: config.features?.algorithms || defaultConfig.features.algorithms,
      algorithmParams: {
        ...defaultConfig.features.algorithmParams,
        ...(config.features?.algorithmParams || {}),
      },
      algorithmWeights: {
        ...defaultConfig.features.algorithmWeights,
        ...(config.features?.algorithmWeights || {}),
      } as Record<FeatureDetectionAlgorithm, number>,
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

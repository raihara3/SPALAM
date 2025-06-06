import { SPALAMConfig } from "./types";
import { FeatureDetectionAlgorithm } from "../types/FeatureDetectionAlgorithm";
import { DepthEstimationModel, InferenceEngine } from "../types/DepthEstimationModel";
import { RenderingMode, ShadowMapType } from "../types/RenderingTypes";

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
    availableModels: [
      DepthEstimationModel.DEPTH_ANYTHING_V2_SMALL,
      DepthEstimationModel.DEPTH_ANYTHING_V2_BASE,
      DepthEstimationModel.MIDAS_SMALL
    ],
    pipeline: {
      model: {
        modelId: DepthEstimationModel.DEPTH_ANYTHING_V2_SMALL,
        inputSize: 504
      },
      engine: {
        engine: InferenceEngine.WEBGPU,
        device: "gpu",
        precision: "fp32"
      },
      parallel: {
        useWorker: false,
        numWorkers: 2
      },
      postProcessing: {
        gaussianBlur: false,
        bilateralFilter: true,
        temporalSmoothing: true
      }
    },
    cache: {
      enableFrameCache: true,
      cacheSize: 5,
      cacheTTL: 100
    },
    performance: {
      skipFrames: 0,
      maxFPS: 30,
      adaptiveQuality: true
    }
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
    advanced: {
      rendering: {
        mode: RenderingMode.STANDARD,
        antialias: true,
        pixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
        clearColor: 0x000000,
        clearAlpha: 0,
        shadows: {
          enabled: true,
          type: ShadowMapType.PCF_SOFT,
          resolution: 2048
        },
        postProcessing: {
          enabled: false,
          effects: []
        },
        performance: {
          enableLOD: true,
          frustumCulling: true,
          occlusionCulling: false,
          enableInstancing: true
        }
      },
      lights: {
        ambient: {
          enabled: true,
          color: 0xffffff,
          intensity: 0.6
        },
        directional: {
          enabled: true,
          color: 0xffffff,
          intensity: 0.8,
          position: { x: 5, y: 5, z: 5 },
          castShadow: true
        },
        points: [],
        spots: []
      },
      camera: {
        fov: 75,
        near: 0.1,
        far: 1000,
        position: { x: 0, y: 0, z: 3 },
        lookAt: { x: 0, y: 0, z: 0 },
        controls: {
          enableOrbit: false,
          enablePan: false,
          enableZoom: false,
          autoRotate: false,
          autoRotateSpeed: 2,
          enableDamping: true,
          dampingFactor: 0.05
        }
      },
      animation: {
        enabled: true,
        default: {
          rotation: {
            enabled: false,
            speed: { x: 0, y: 0.01, z: 0 }
          },
          float: {
            enabled: false,
            amplitude: 0.1,
            frequency: 1
          },
          pulse: {
            enabled: false,
            minScale: 0.9,
            maxScale: 1.1,
            speed: 2
          }
        },
        custom: []
      },
      enableInteraction: false,
      enablePerformanceMonitor: false
    }
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
      pipeline: {
        ...defaultConfig.depth.pipeline,
        ...(config.depth?.pipeline || {}),
        model: config.depth?.pipeline?.model || defaultConfig.depth.pipeline!.model,
        engine: config.depth?.pipeline?.engine || defaultConfig.depth.pipeline!.engine,
        parallel: config.depth?.pipeline?.parallel || defaultConfig.depth.pipeline?.parallel,
        postProcessing: {
          ...defaultConfig.depth.pipeline?.postProcessing,
          ...(config.depth?.pipeline?.postProcessing || {}),
        },
      },
      cache: config.depth?.cache || defaultConfig.depth.cache,
      performance: config.depth?.performance || defaultConfig.depth.performance,
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
      advanced: config.renderer?.advanced || defaultConfig.renderer.advanced,
    },
  };
}

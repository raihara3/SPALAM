// Main API class
export { SPALAM } from "./core/SPALAM";

// Core engine classes
export { PlaneEstimator } from "./core/PlaneEstimator";
export { Renderer } from "./core/Renderer";

// Processor classes (advanced usage)
export { FeatureTracker } from "./processors/FeatureTracker";
export { DepthProcessor } from "./processors/DepthProcessor";
export { GeometryProcessor } from "./processors/GeometryProcessor";

// Geometry utilities
export { PlaneGeometry } from "./geometry/PlaneGeometry";
export { CoordinateTransforms } from "./geometry/CoordinateTransforms";

// Math utilities
export { RANSAC } from "./math/RANSAC";
export { PlaneRANSAC } from "./math/PlaneRANSAC";

// Utility classes
export { EventEmitter } from "./utils/EventEmitter";
export { Camera } from "./utils/Camera";

// Type definitions
export type {
  Point2D,
  Point3D,
  Feature,
  PlaneModel,
  PlaneEstimationResult,
  CameraParameters,
  FeatureTrackingState,
  EstimationState,
} from "./types/core";

export type {
  SPALAMConfig,
  CameraConfig,
  FeatureDetectionConfig,
  DepthEstimationConfig,
  PlaneEstimationConfig,
  RenderingConfig,
  RANSACConfig,
  WeightedFittingConfig,
} from "./types/configuration";

export type {
  ConvexHullResult,
  PlaneProjectionParams,
  RANSACResult,
  ModelFitter,
  PlaneModelFitter,
  WeightedPoint,
  BoundingBox2D,
  CoordinateTransform,
} from "./types/geometry";

// Default configuration
export { DEFAULT_CONFIG } from "./types/configuration";

// Re-export legacy types for backward compatibility
export type { Feature as LegacyFeature } from "./types/Feature";
export type { Point2D as LegacyPoint2D, Point3D as LegacyPoint3D } from "./types/Point";
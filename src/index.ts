/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

export { SPALAM } from "./SPALAM";
export { FeatureDetector } from "./FeatureDetector";
export { DepthEstimation } from "./DepthEstimation";
export { ARRenderer } from "./ARRenderer";

// Tracking (IMU integration, visual-inertial fusion, 6DoF camera tracking)
export * from "./tracking";

export type { Feature } from "./types/Feature";
export type { PlaneModel } from "./types/Plane";
export type { Point3D, Point2D } from "./types/Point";
export type {
  DeviceOrientationData,
  DeviceMotionData,
  DeviceMotionTrackerState,
  DeviceMotionTrackerEvent,
  IMUInitializationState,
  IMUInitializationResult,
  DriftStatistics,
} from "./types/DeviceMotion";

export * from "./helpers/backProjectPoints";
export * from "./helpers/computeConvexHull2D";
export * from "./helpers/fitPlaneRANSAC";
export * from "./helpers/liftHull2DTo3D";
export * from "./helpers/projectInliersToPlane2D";
export * from "./helpers/sampleDepthAtFeaturePoints";
export * from "./helpers/weightedPlaneFit2D";

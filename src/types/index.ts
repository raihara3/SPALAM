export * from "./core";
export * from "./configuration";
export type { RANSACConfig, ConvexHullResult, PlaneProjectionParams, RANSACResult, ModelFitter, PlaneModelFitter, WeightedPoint, BoundingBox2D, CoordinateTransform } from "./geometry";

// Re-export legacy types for backward compatibility
export type { Feature as LegacyFeature } from "./Feature";
export type { Point2D as LegacyPoint2D, Point3D as LegacyPoint3D } from "./Point";

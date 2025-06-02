import * as THREE from "three";
import { Point2D, Point3D, PlaneModel } from "./core";

export interface RANSACConfig {
  maxIterations: number;
  threshold: number;
  minInliers: number;
  maxAttempts: number;
}

export interface ConvexHullResult {
  hull2D: Point2D[];
  hull3D: Point3D[];
}

export interface PlaneProjectionParams {
  P0: Point3D;
  uVec: THREE.Vector3;
  vVec: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface RANSACResult<TModel> {
  model: TModel | null;
  inliers: Point3D[];
  outliers: Point3D[];
  score: number;
  iterations: number;
}

export interface ModelFitter<TModel, TData> {
  fit(data: TData[]): TModel | null;
  score(model: TModel, data: TData[]): number;
  isInlier(model: TModel, point: TData, threshold: number): boolean;
}

export interface PlaneModelFitter extends ModelFitter<PlaneModel, Point3D> {
  fit(points: Point3D[]): PlaneModel | null;
  score(model: PlaneModel, points: Point3D[]): number;
  isInlier(model: PlaneModel, point: Point3D, threshold: number): boolean;
}

export interface WeightedPoint extends Point3D {
  weight: number;
}

export interface BoundingBox2D {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
  width: number;
  height: number;
  centerU: number;
  centerV: number;
}

export interface CoordinateTransform {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale: THREE.Vector3;
}
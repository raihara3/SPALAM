import * as THREE from "three";

export interface Point2D {
  u: number;
  v: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
  id?: string;
}

export interface Feature extends Point2D {
  x: number;
  y: number;
  trackingCount: number;
  id: string;
  confidence?: number;
}

export interface PlaneModel {
  a: number;
  b: number;
  c: number;
  d: number;
  confidence?: number;
}

export interface PlaneEstimationResult {
  plane: PlaneModel;
  hull2D: Point2D[];
  hull3D: Point3D[];
  confidence: number;
  P0: Point3D;
  uVec: THREE.Vector3;
  vVec: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface CameraParameters {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

export interface FeatureTrackingState {
  prevGray: any;
  prevFeatures: Feature[];
  trackedFeatures: Feature[];
  centerFeature: Feature | null;
  nextFeatureId: number;
}

export interface EstimationState {
  fittingCount: number;
  fittingResults: Array<{
    hull2D: Point2D[];
    hull3D: Point3D[];
    P0: Point3D;
    uVec: THREE.Vector3;
    vVec: THREE.Vector3;
    normal: THREE.Vector3;
  }>;
  maxFittingCount: number;
}
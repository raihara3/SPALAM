import * as THREE from "three";
import type { Point2D, Point3D } from "./Point";

/**
 * SPALAM state
 */
export enum SPALAMState {
  IDLE = "IDLE",
  INITIALIZING = "INITIALIZING",
  DETECTING_FEATURES = "DETECTING_FEATURES",
  FITTING_PLANE = "FITTING_PLANE",
  PLANE_DETECTED = "PLANE_DETECTED",
  ERROR = "ERROR",
}

/**
 * State change event
 */
export interface StateChangeEvent {
  previousState: SPALAMState;
  currentState: SPALAMState;
  timestamp: number;
  data?: unknown;
}

/**
 * State change listener
 */
export type StateChangeListener = (event: StateChangeEvent) => void;

/**
 * Plane fitting result
 */
export interface PlaneFittingResult {
  hull2D: Point2D[];
  hull3D: Point3D[];
  P0: Point3D;
  uVec: THREE.Vector3;
  vVec: THREE.Vector3;
  normal: THREE.Vector3;
}

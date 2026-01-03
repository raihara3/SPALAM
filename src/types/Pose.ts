import * as THREE from "three";
import type { Feature } from "./Feature";

/**
 * Camera pose (extrinsic parameters) representing position and orientation
 */
export interface CameraPose {
  /** Rotation matrix (3x3) */
  rotation: THREE.Matrix3;
  /** Translation vector in world coordinates */
  translation: THREE.Vector3;
  /** Rotation as quaternion (derived from rotation matrix) */
  quaternion: THREE.Quaternion;
  /** Frame timestamp in milliseconds */
  timestamp: number;
  /** Confidence score (0-1), higher is better */
  confidence: number;
}

/**
 * Feature match between two frames
 */
export interface FeatureMatch {
  /** Index in query (first) descriptor set */
  queryIndex: number;
  /** Index in train (second) descriptor set */
  trainIndex: number;
  /** Match distance (lower is better, Hamming distance for ORB) */
  distance: number;
  /** Query feature ID (optional) */
  queryId?: string;
  /** Train feature ID (optional) */
  trainId?: string;
}

/**
 * 2D-3D point correspondence for PnP solving
 */
export interface Point2D3DCorrespondence {
  /** 2D image point in pixel coordinates */
  point2D: { x: number; y: number };
  /** 3D world point */
  point3D: THREE.Vector3;
  /** Feature ID for tracking */
  id: string;
  /** Optional weight for weighted PnP (0-1) */
  weight?: number;
}

/**
 * Result from triangulation of a single point
 */
export interface TriangulationResult {
  /** Triangulated 3D point in world coordinates */
  point3D: THREE.Vector3;
  /** Reprojection error in pixels (average of both views) */
  reprojectionError: number;
  /** Parallax angle in radians between the two views */
  parallaxAngle: number;
  /** Whether this point passes quality checks */
  isValid: boolean;
  /** Feature ID for tracking */
  id?: string;
}

/**
 * Keyframe for bundle adjustment and relocalization
 */
export interface Keyframe {
  /** Unique keyframe ID */
  id: number;
  /** Camera pose at this keyframe */
  pose: CameraPose;
  /** Observed feature points */
  features: Feature[];
  /** Feature descriptors (cv.Mat reference, caller manages lifecycle) */
  descriptors: cv.Mat | null;
  /** Timestamp in milliseconds */
  timestamp: number;
  /** Number of tracked map points visible in this keyframe */
  trackedMapPointCount?: number;
}

/**
 * 3D map point tracked across multiple keyframes
 */
export interface MapPoint {
  /** Unique point ID */
  id: string;
  /** 3D position in world coordinates */
  position: THREE.Vector3;
  /** Observations: keyframe ID -> feature index in that keyframe */
  observations: Map<number, number>;
  /** Total number of observations */
  observationCount: number;
  /** Whether this point is valid (not outlier) */
  isValid: boolean;
  /** Representative descriptor (from best observation) */
  descriptor?: Uint8Array;
  /** Normal direction (average viewing direction) */
  normal?: THREE.Vector3;
}

/**
 * Result from Essential Matrix estimation
 */
export interface EssentialMatrixResult {
  /** Essential matrix (3x3) */
  essentialMatrix: THREE.Matrix3;
  /** Inlier mask (true = inlier) */
  inlierMask: boolean[];
  /** Number of inliers */
  inlierCount: number;
  /** Whether the result is valid (enough inliers) */
  isValid: boolean;
}

/**
 * Result from pose recovery (from Essential Matrix)
 */
export interface PoseRecoveryResult {
  /** Recovered rotation matrix */
  rotation: THREE.Matrix3;
  /** Recovered translation (unit vector, scale unknown) */
  translation: THREE.Vector3;
  /** Number of points in front of both cameras (cheirality check) */
  inFrontCount: number;
  /** Whether the result is valid */
  isValid: boolean;
}

/**
 * Result from PnP solving
 */
export interface PnPResult {
  /** Rotation vector (Rodrigues representation) */
  rotationVector: THREE.Vector3;
  /** Rotation matrix (3x3) */
  rotationMatrix: THREE.Matrix3;
  /** Translation vector */
  translation: THREE.Vector3;
  /** Indices of inlier correspondences */
  inliers: number[];
  /** RMS reprojection error in pixels */
  reprojectionError: number;
  /** Whether the result is valid */
  isValid: boolean;
}

/**
 * Result from bundle adjustment optimization
 */
export interface BundleAdjustmentResult {
  /** Optimized keyframe poses (keyframe ID -> pose) */
  optimizedPoses: Map<number, CameraPose>;
  /** Optimized map point positions (point ID -> position) */
  optimizedPoints: Map<string, THREE.Vector3>;
  /** Final cost (sum of squared reprojection errors) */
  finalCost: number;
  /** Initial cost before optimization */
  initialCost: number;
  /** Number of iterations performed */
  iterations: number;
  /** Whether optimization converged */
  converged: boolean;
}

/**
 * Motion prediction for a feature point
 */
export interface MotionPrediction {
  /** Predicted 2D position in next frame */
  predictedPosition: { x: number; y: number };
  /** Search region bounds for matching */
  searchRegion: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  /** Prediction confidence (0-1) */
  confidence: number;
}

/**
 * Camera intrinsic parameters
 */
export interface CameraIntrinsics {
  /** Focal length in x direction (pixels) */
  fx: number;
  /** Focal length in y direction (pixels) */
  fy: number;
  /** Principal point x coordinate (pixels) */
  cx: number;
  /** Principal point y coordinate (pixels) */
  cy: number;
  /** Image width in pixels */
  width?: number;
  /** Image height in pixels */
  height?: number;
}

/**
 * Tracking state for pose estimation
 */
export type TrackingState =
  | "uninitialized"
  | "initializing"
  | "tracking"
  | "lost"
  | "relocalizing";

/**
 * Statistics from pose estimation
 */
export interface PoseEstimationStatistics {
  /** Current tracking state */
  trackingState: TrackingState;
  /** Number of tracked features */
  trackedFeatureCount: number;
  /** Number of matched features */
  matchedFeatureCount: number;
  /** Number of map points */
  mapPointCount: number;
  /** Number of keyframes */
  keyframeCount: number;
  /** Average reprojection error in pixels */
  averageReprojectionError: number;
  /** Processing time in milliseconds */
  processingTimeMs: number;
}

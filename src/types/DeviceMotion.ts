import * as THREE from "three";

/**
 * DeviceOrientation APIから取得される姿勢データ
 */
export interface DeviceOrientationData {
  /** Z軸回りの回転（コンパス方向）: 0-360度 */
  alpha: number;
  /** X軸回りの回転（前後の傾き）: -180〜180度 */
  beta: number;
  /** Y軸回りの回転（左右の傾き）: -90〜90度 */
  gamma: number;
  /** タイムスタンプ（ミリ秒） */
  timestamp: number;
  /** データが絶対方向を示すか */
  absolute: boolean;
}

/**
 * DeviceMotion APIから取得される加速度データ
 */
export interface DeviceMotionData {
  /** 重力を含む加速度（m/s²） */
  accelerationIncludingGravity: THREE.Vector3;
  /** 重力を除いた加速度（m/s²） */
  acceleration: THREE.Vector3 | null;
  /** 回転速度（rad/s） */
  rotationRate: RotationRate;
  /** サンプリング間隔（ミリ秒） */
  interval: number;
  /** タイムスタンプ（ミリ秒） */
  timestamp: number;
}

/**
 * 回転速度データ
 */
export interface RotationRate {
  /** X軸回りの回転速度（rad/s） */
  alpha: number;
  /** Y軸回りの回転速度（rad/s） */
  beta: number;
  /** Z軸回りの回転速度（rad/s） */
  gamma: number;
}

/**
 * IMU初期化用のサンプルデータ
 */
export interface MotionSample {
  acceleration: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  timestamp: number;
}

/**
 * IMU初期化状態
 */
export enum IMUInitializationState {
  NOT_STARTED = "NOT_STARTED",
  COLLECTING_SAMPLES = "COLLECTING_SAMPLES",
  CALIBRATING = "CALIBRATING",
  READY = "READY",
  FAILED = "FAILED",
}

/**
 * IMU初期化結果
 */
export interface IMUInitializationResult {
  success: boolean;
  gravityVector: THREE.Vector3 | null;
  initialOrientation: THREE.Quaternion | null;
  calibrationQuality: number;
  errorMessage?: string;
}

/**
 * デバイスモーショントラッカーの状態
 */
export enum DeviceMotionTrackerState {
  UNINITIALIZED = "UNINITIALIZED",
  REQUESTING_PERMISSION = "REQUESTING_PERMISSION",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  INITIALIZING = "INITIALIZING",
  TRACKING = "TRACKING",
  ERROR = "ERROR",
}

/**
 * デバイスモーショントラッカーのイベント
 */
export interface DeviceMotionTrackerEvent {
  type: "stateChange" | "orientationUpdate" | "motionUpdate" | "error";
  state?: DeviceMotionTrackerState;
  orientation?: DeviceOrientationData;
  motion?: DeviceMotionData;
  error?: Error;
  timestamp: number;
}

/**
 * デバイスモーショントラッカーのリスナー
 */
export type DeviceMotionTrackerListener = (
  event: DeviceMotionTrackerEvent
) => void;

/**
 * ドリフト計測データ
 */
export interface DriftMeasurement {
  elapsedTime: number;
  positionDrift: THREE.Vector3;
  orientationDrift: THREE.Quaternion;
  timestamp: number;
}

/**
 * ドリフト統計
 */
export interface DriftStatistics {
  measurements: DriftMeasurement[];
  averagePositionDriftRate: number;
  averageOrientationDriftRate: number;
  maxPositionDrift: number;
  maxOrientationDrift: number;
}

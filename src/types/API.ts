/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import type { Point2D, Point3D } from "./Point";
import type { SPALAMConfig } from "../config/types";
import type { StateChangeEvent } from "./State";
import type { DeviceMotionTrackerEvent } from "./DeviceMotion";

/**
 * SPALAMイベント型定義
 */
export interface SPALAMEvents {
  /** フレーム処理完了時に発火 */
  "frame:processed": (data: FrameData) => void;
  /** 平面検出完了時に発火 */
  "plane:detected": (plane: PlaneData) => void;
  /** 状態変更時に発火 */
  "state:changed": (event: StateChangeEvent) => void;
  /** IMU状態変更時に発火 */
  "imu:stateChange": (event: DeviceMotionTrackerEvent) => void;
  /** エラー発生時に発火 */
  error: (error: Error) => void;
}

/**
 * フレームデータ
 */
export interface FrameData {
  /** 検出された特徴点配列 */
  features: Feature[];
  /** 中心特徴点 */
  centerFeature: Feature | null;
  /** 深度マップ */
  depthMap: ImageData | null;
  /** タイムスタンプ */
  timestamp: number;
}

/**
 * 特徴点データ
 */
export interface Feature {
  /** 2D座標 */
  point: Point2D;
  /** 追跡品質スコア */
  quality: number;
  /** 追跡フレーム数 */
  trackingCount: number;
  /** 一意識別子 */
  id: string;
}

/**
 * 平面データ
 */
export interface PlaneData {
  /** 3D空間での位置 */
  position: THREE.Vector3;
  /** 法線ベクトル */
  normal: THREE.Vector3;
  /** 2D凸包の点群 */
  hull2D: Point2D[];
  /** 3D凸包の点群 */
  hull3D: Point3D[];
  /** 信頼度スコア (0.0-1.0) */
  confidence: number;
  /** 平面のサイズ */
  size: {
    width: number;
    height: number;
  };
  /** 検出時刻 */
  detectedAt: number;
}

/**
 * SPALAM開始オプション
 */
export interface SPALAMStartOptions {
  /** 使用するビデオ要素（省略時はカメラを使用） */
  video?: HTMLVideoElement | null;
  /** カメラ制約設定 */
  cameraConstraints?: MediaStreamConstraints;
  /** 自動レンダリング開始（デフォルト: true） */
  autoRender?: boolean;
}

/**
 * SPALAM設定ビルダー用の型
 */
export interface SPALAMBuilderConfig {
  features?: Partial<SPALAMConfig["features"]>;
  depth?: Partial<SPALAMConfig["depth"]>;
  plane?: Partial<SPALAMConfig["plane"]>;
}

/**
 * デバイス種別
 */
export type DeviceType = "cpu" | "webgpu";

/**
 * SPALAM状態
 */
export enum SPALAMStateEnum {
  IDLE = "idle",
  INITIALIZING = "initializing",
  DETECTING_FEATURES = "detecting_features",
  FITTING_PLANE = "fitting_plane",
  PLANE_DETECTED = "plane_detected",
  ERROR = "error",
}

/**
 * パフォーマンス統計
 */
export interface PerformanceStats {
  /** フレームレート */
  fps: number;
  /** 特徴点検出時間（ms） */
  featureDetectionTime: number;
  /** 深度推定時間（ms） */
  depthEstimationTime: number;
  /** 平面フィッティング時間（ms） */
  planeFittingTime: number;
  /** 使用メモリ（MB） */
  memoryUsage: number;
}

/**
 * カメラ情報
 */
export interface CameraInfo {
  /** カメラ内部パラメータ */
  intrinsics: {
    fx: number;
    fy: number;
    cx: number;
    cy: number;
  };
  /** 歪み係数 */
  distortion: {
    k1: number;
    k2: number;
    p1: number;
    p2: number;
    k3?: number;
  };
  /** 解像度 */
  resolution: {
    width: number;
    height: number;
  };
}

/**
 * エラー種別
 */
export enum SPALAMErrorType {
  CAMERA_ACCESS_DENIED = "camera_access_denied",
  WEBGPU_NOT_SUPPORTED = "webgpu_not_supported",
  MODEL_LOAD_FAILED = "model_load_failed",
  OPENCV_INIT_FAILED = "opencv_init_failed",
  FEATURE_DETECTION_FAILED = "feature_detection_failed",
  DEPTH_ESTIMATION_FAILED = "depth_estimation_failed",
  PLANE_FITTING_FAILED = "plane_fitting_failed",
  UNKNOWN = "unknown",
}

/**
 * SPALAMエラークラス
 */
export class SPALAMError extends Error {
  public readonly type: SPALAMErrorType;
  public readonly originalError?: Error;

  constructor(type: SPALAMErrorType, message: string, originalError?: Error) {
    super(message);
    this.name = "SPALAMError";
    this.type = type;
    this.originalError = originalError;
  }
}

/**
 * ログレベル
 */
export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

/**
 * ログ設定
 */
export interface LogConfig {
  level: LogLevel;
  enabled: boolean;
  timestamp: boolean;
}

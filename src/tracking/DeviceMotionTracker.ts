import * as THREE from "three";
import {
  DeviceOrientationData,
  DeviceMotionData,
  RotationRate,
  DeviceMotionTrackerState,
  DeviceMotionTrackerEvent,
  DeviceMotionTrackerListener,
  DriftMeasurement,
  DriftStatistics,
} from "../types/DeviceMotion";
import { PoseRepresentation } from "./PoseRepresentation";
import { IMUInitializer } from "./IMUInitializer";

/**
 * iOS Safari向けの型拡張
 */
interface DeviceOrientationEventStatic {
  new (type: string, eventInitDict?: DeviceOrientationEventInit): DeviceOrientationEvent;
  prototype: DeviceOrientationEvent;
  requestPermission?: () => Promise<"granted" | "denied">;
}

interface DeviceMotionEventStatic {
  new (type: string, eventInitDict?: DeviceMotionEventInit): DeviceMotionEvent;
  prototype: DeviceMotionEvent;
  requestPermission?: () => Promise<"granted" | "denied">;
}

declare const DeviceOrientationEvent: DeviceOrientationEventStatic;
declare const DeviceMotionEvent: DeviceMotionEventStatic;

/**
 * デバイスモーショントラッカー
 * IMU（加速度計・ジャイロスコープ）を利用した姿勢推定を行う
 */
export class DeviceMotionTracker {
  private state: DeviceMotionTrackerState =
    DeviceMotionTrackerState.UNINITIALIZED;
  private listeners: Set<DeviceMotionTrackerListener> = new Set();

  private orientation: DeviceOrientationData | null = null;
  private motion: DeviceMotionData | null = null;
  private currentQuaternion: THREE.Quaternion = new THREE.Quaternion();

  private poseRepresentation: PoseRepresentation;
  private imuInitializer: IMUInitializer;

  private driftMeasurements: DriftMeasurement[] = [];
  private referenceQuaternion: THREE.Quaternion | null = null;
  private referenceTimestamp: number = 0;
  private readonly maxDriftMeasurements: number = 100;

  private boundHandleOrientation: (event: DeviceOrientationEvent) => void;
  private boundHandleMotion: (event: DeviceMotionEvent) => void;

  constructor() {
    this.poseRepresentation = new PoseRepresentation();
    this.imuInitializer = new IMUInitializer();

    this.boundHandleOrientation = this.handleDeviceOrientation.bind(this);
    this.boundHandleMotion = this.handleDeviceMotion.bind(this);
  }

  /**
   * 現在の状態を取得
   */
  public getState(): DeviceMotionTrackerState {
    return this.state;
  }

  /**
   * イベントリスナーを追加
   */
  public addListener(listener: DeviceMotionTrackerListener): void {
    this.listeners.add(listener);
  }

  /**
   * イベントリスナーを削除
   */
  public removeListener(listener: DeviceMotionTrackerListener): void {
    this.listeners.delete(listener);
  }

  /**
   * 初期化（権限要求含む）
   */
  public async initialize(): Promise<boolean> {
    if (!this.isSecureContext()) {
      this.setState(DeviceMotionTrackerState.ERROR);
      this.emitError(new Error("Sensor APIs require a secure context (HTTPS)"));
      return false;
    }

    if (!this.isSensorApiAvailable()) {
      this.setState(DeviceMotionTrackerState.ERROR);
      this.emitError(new Error("DeviceOrientation/DeviceMotion API not available"));
      return false;
    }

    this.setState(DeviceMotionTrackerState.REQUESTING_PERMISSION);

    const permissionGranted = await this.requestPermission();
    if (!permissionGranted) {
      this.setState(DeviceMotionTrackerState.PERMISSION_DENIED);
      return false;
    }

    this.setState(DeviceMotionTrackerState.INITIALIZING);
    this.startListening();

    return true;
  }

  /**
   * セキュアコンテキストかチェック
   */
  private isSecureContext(): boolean {
    if (typeof window === "undefined") return false;
    return window.isSecureContext || window.location.hostname === "localhost";
  }

  /**
   * センサーAPIが利用可能かチェック
   */
  private isSensorApiAvailable(): boolean {
    return (
      typeof window !== "undefined" &&
      "DeviceOrientationEvent" in window &&
      "DeviceMotionEvent" in window
    );
  }

  /**
   * 権限を要求（iOS Safari対応）
   */
  private async requestPermission(): Promise<boolean> {
    try {
      if (
        typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function"
      ) {
        const orientationPermission =
          await DeviceOrientationEvent.requestPermission();
        if (orientationPermission !== "granted") {
          return false;
        }
      }

      if (
        typeof DeviceMotionEvent !== "undefined" &&
        typeof DeviceMotionEvent.requestPermission === "function"
      ) {
        const motionPermission = await DeviceMotionEvent.requestPermission();
        if (motionPermission !== "granted") {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error("Permission request failed:", error);
      return false;
    }
  }

  /**
   * センサーイベントのリッスンを開始
   */
  private startListening(): void {
    window.addEventListener(
      "deviceorientation",
      this.boundHandleOrientation,
      true
    );
    window.addEventListener("devicemotion", this.boundHandleMotion, true);
  }

  /**
   * センサーイベントのリッスンを停止
   */
  private stopListening(): void {
    window.removeEventListener(
      "deviceorientation",
      this.boundHandleOrientation,
      true
    );
    window.removeEventListener("devicemotion", this.boundHandleMotion, true);
  }

  /**
   * DeviceOrientationイベントハンドラー
   */
  private handleDeviceOrientation(event: DeviceOrientationEvent): void {
    if (
      event.alpha === null ||
      event.beta === null ||
      event.gamma === null
    ) {
      return;
    }

    this.orientation = {
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
      timestamp: Date.now(),
      absolute: event.absolute || false,
    };

    this.currentQuaternion = this.poseRepresentation.orientationToQuaternion(
      this.orientation
    );

    if (this.state === DeviceMotionTrackerState.INITIALIZING) {
      if (this.imuInitializer.isReady()) {
        this.setState(DeviceMotionTrackerState.TRACKING);
        this.startDriftMeasurement();
      }
    }

    this.emitOrientationUpdate();
  }

  /**
   * DeviceMotionイベントハンドラー
   */
  private handleDeviceMotion(event: DeviceMotionEvent): void {
    const acceleration = event.accelerationIncludingGravity;
    const linearAcceleration = event.acceleration;
    const rotationRate = event.rotationRate;

    if (!acceleration) return;

    const accelerationVector = new THREE.Vector3(
      acceleration.x ?? 0,
      acceleration.y ?? 0,
      acceleration.z ?? 0
    );

    const linearAccelerationVector = linearAcceleration
      ? new THREE.Vector3(
          linearAcceleration.x ?? 0,
          linearAcceleration.y ?? 0,
          linearAcceleration.z ?? 0
        )
      : null;

    const rotationRateData: RotationRate = {
      alpha: rotationRate?.alpha ?? 0,
      beta: rotationRate?.beta ?? 0,
      gamma: rotationRate?.gamma ?? 0,
    };

    this.motion = {
      accelerationIncludingGravity: accelerationVector,
      acceleration: linearAccelerationVector,
      rotationRate: rotationRateData,
      interval: event.interval ?? 16,
      timestamp: Date.now(),
    };

    if (this.state === DeviceMotionTrackerState.INITIALIZING) {
      const angularVelocity = new THREE.Vector3(
        rotationRateData.alpha,
        rotationRateData.beta,
        rotationRateData.gamma
      );
      this.imuInitializer.addSample(accelerationVector, angularVelocity);
    }

    this.emitMotionUpdate();
  }

  /**
   * 現在の姿勢を取得（クォータニオン）
   * INITIALIZING状態以降であれば姿勢データを返す
   */
  public getOrientation(): THREE.Quaternion | null {
    // UNINITIALIZED, REQUESTING_PERMISSION, PERMISSION_DENIED, ERROR の場合はnull
    if (
      this.state === DeviceMotionTrackerState.UNINITIALIZED ||
      this.state === DeviceMotionTrackerState.REQUESTING_PERMISSION ||
      this.state === DeviceMotionTrackerState.PERMISSION_DENIED ||
      this.state === DeviceMotionTrackerState.ERROR
    ) {
      return null;
    }
    return this.currentQuaternion.clone();
  }

  /**
   * 現在の回転行列を取得
   */
  public getRotationMatrix(): THREE.Matrix4 | null {
    const orientation = this.getOrientation();
    if (!orientation) return null;
    return this.poseRepresentation.quaternionToMatrix4(orientation);
  }

  /**
   * 重力除去済み加速度を取得
   */
  public getLinearAcceleration(): THREE.Vector3 | null {
    if (!this.motion?.acceleration) return null;
    return this.motion.acceleration.clone();
  }

  /**
   * 角速度を取得
   */
  public getAngularVelocity(): THREE.Vector3 | null {
    if (!this.motion) return null;
    return new THREE.Vector3(
      this.motion.rotationRate.alpha,
      this.motion.rotationRate.beta,
      this.motion.rotationRate.gamma
    );
  }

  /**
   * 重力ベクトルを取得
   *
   * デバイスの加速度センサーから重力方向を推定する。
   * 静止時または等速運動時に最も正確な値を返す。
   */
  public getGravityVector(): THREE.Vector3 | null {
    if (!this.motion) return null;

    const acceleration = this.motion.accelerationIncludingGravity;
    const linearAcceleration = this.motion.acceleration;

    if (linearAcceleration) {
      // 線形加速度がある場合、重力 = 総加速度 - 線形加速度
      return new THREE.Vector3(
        acceleration.x - linearAcceleration.x,
        acceleration.y - linearAcceleration.y,
        acceleration.z - linearAcceleration.z
      ).normalize();
    }

    // 線形加速度がない場合、総加速度を正規化して返す
    // （静止時は総加速度 ≈ 重力）
    return acceleration.clone().normalize();
  }

  /**
   * デバイス座標系のベクトルをワールド座標系に変換
   */
  public deviceToWorld(deviceVector: THREE.Vector3): THREE.Vector3 {
    const orientation = this.getOrientation();
    if (!orientation) return deviceVector.clone();
    return this.poseRepresentation.deviceToWorld(deviceVector, orientation);
  }

  /**
   * IMU初期化器を取得
   */
  public getIMUInitializer(): IMUInitializer {
    return this.imuInitializer;
  }

  /**
   * ドリフト計測を開始
   */
  private startDriftMeasurement(): void {
    this.referenceQuaternion = this.currentQuaternion.clone();
    this.referenceTimestamp = Date.now();
    this.driftMeasurements = [];
  }

  /**
   * 現在のドリフトを記録
   */
  public recordDrift(): void {
    if (
      !this.referenceQuaternion ||
      this.state !== DeviceMotionTrackerState.TRACKING
    ) {
      return;
    }

    const elapsedTime = (Date.now() - this.referenceTimestamp) / 1000;

    const orientationDrift = this.currentQuaternion
      .clone()
      .multiply(this.referenceQuaternion.clone().invert());

    const measurement: DriftMeasurement = {
      elapsedTime,
      positionDrift: new THREE.Vector3(),
      orientationDrift,
      timestamp: Date.now(),
    };

    this.driftMeasurements.push(measurement);

    if (this.driftMeasurements.length > this.maxDriftMeasurements) {
      this.driftMeasurements.shift();
    }
  }

  /**
   * ドリフト統計を取得
   */
  public getDriftStatistics(): DriftStatistics {
    if (this.driftMeasurements.length === 0) {
      return {
        measurements: [],
        averagePositionDriftRate: 0,
        averageOrientationDriftRate: 0,
        maxPositionDrift: 0,
        maxOrientationDrift: 0,
      };
    }

    let maxOrientationDrift = 0;
    let totalOrientationDrift = 0;

    for (const measurement of this.driftMeasurements) {
      const angle =
        2 *
        Math.acos(
          Math.min(1, Math.abs(measurement.orientationDrift.w))
        );
      totalOrientationDrift += angle;
      maxOrientationDrift = Math.max(maxOrientationDrift, angle);
    }

    const lastMeasurement =
      this.driftMeasurements[this.driftMeasurements.length - 1];
    const averageOrientationDriftRate =
      lastMeasurement.elapsedTime > 0
        ? totalOrientationDrift / lastMeasurement.elapsedTime
        : 0;

    return {
      measurements: [...this.driftMeasurements],
      averagePositionDriftRate: 0,
      averageOrientationDriftRate,
      maxPositionDrift: 0,
      maxOrientationDrift,
    };
  }

  /**
   * ドリフト計測をリセット
   */
  public resetDriftMeasurement(): void {
    this.startDriftMeasurement();
  }

  /**
   * 状態を変更
   */
  private setState(newState: DeviceMotionTrackerState): void {
    if (this.state === newState) return;

    this.state = newState;
    this.emit({
      type: "stateChange",
      state: newState,
      timestamp: Date.now(),
    });
  }

  /**
   * 姿勢更新イベントを発行
   */
  private emitOrientationUpdate(): void {
    if (!this.orientation) return;
    this.emit({
      type: "orientationUpdate",
      orientation: { ...this.orientation },
      timestamp: Date.now(),
    });
  }

  /**
   * モーション更新イベントを発行
   */
  private emitMotionUpdate(): void {
    if (!this.motion) return;
    this.emit({
      type: "motionUpdate",
      motion: {
        ...this.motion,
        accelerationIncludingGravity:
          this.motion.accelerationIncludingGravity.clone(),
        acceleration: this.motion.acceleration?.clone() ?? null,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * エラーイベントを発行
   */
  private emitError(error: Error): void {
    this.emit({
      type: "error",
      error,
      timestamp: Date.now(),
    });
  }

  /**
   * イベントを発行
   */
  private emit(event: DeviceMotionTrackerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Error in DeviceMotionTracker listener:", error);
      }
    }
  }

  /**
   * トラッキングが有効かどうか
   * INITIALIZING または TRACKING 状態であればtrue
   */
  public isTracking(): boolean {
    return (
      this.state === DeviceMotionTrackerState.INITIALIZING ||
      this.state === DeviceMotionTrackerState.TRACKING
    );
  }

  /**
   * 初期化完了を待機
   */
  public waitForInitialization(timeoutMilliseconds: number = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.state === DeviceMotionTrackerState.TRACKING) {
        resolve(true);
        return;
      }

      if (
        this.state === DeviceMotionTrackerState.PERMISSION_DENIED ||
        this.state === DeviceMotionTrackerState.ERROR
      ) {
        resolve(false);
        return;
      }

      const timeout = setTimeout(() => {
        this.removeListener(listener);
        resolve(false);
      }, timeoutMilliseconds);

      const listener: DeviceMotionTrackerListener = (event) => {
        if (event.type === "stateChange") {
          if (event.state === DeviceMotionTrackerState.TRACKING) {
            clearTimeout(timeout);
            this.removeListener(listener);
            resolve(true);
          } else if (
            event.state === DeviceMotionTrackerState.PERMISSION_DENIED ||
            event.state === DeviceMotionTrackerState.ERROR
          ) {
            clearTimeout(timeout);
            this.removeListener(listener);
            resolve(false);
          }
        }
      };

      this.addListener(listener);
    });
  }

  /**
   * リソース解放
   */
  public dispose(): void {
    this.stopListening();
    this.poseRepresentation.dispose();
    this.listeners.clear();
    this.orientation = null;
    this.motion = null;
    this.state = DeviceMotionTrackerState.UNINITIALIZED;
  }
}

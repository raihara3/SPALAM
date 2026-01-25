/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import {
  MotionSample,
  IMUInitializationState,
  IMUInitializationResult,
} from "../types/DeviceMotion";

/**
 * IMU初期化を行うクラス
 * 静止状態検出、重力ベクトル推定、初期姿勢キャリブレーションを担当
 */
export class IMUInitializer {
  private samples: MotionSample[] = [];
  private state: IMUInitializationState = IMUInitializationState.NOT_STARTED;
  private gravityVector: THREE.Vector3 | null = null;
  private initialOrientation: THREE.Quaternion | null = null;

  /** 初期化に必要なサンプル数（約1秒分 @ 50Hz） */
  private readonly requiredSamples: number;
  /** 静止状態判定の加速度分散閾値（m/s²）² */
  private readonly stationaryVarianceThreshold: number;
  /** 静止状態判定の角速度閾値（rad/s） */
  private readonly stationaryAngularVelocityThreshold: number;
  /** 重力加速度の基準値（m/s²） */
  private readonly gravityMagnitude: number = 9.81;
  /** 重力検出の許容誤差 */
  private readonly gravityTolerance: number = 0.5;

  constructor(options?: {
    requiredSamples?: number;
    stationaryVarianceThreshold?: number;
    stationaryAngularVelocityThreshold?: number;
  }) {
    this.requiredSamples = options?.requiredSamples ?? 50;
    this.stationaryVarianceThreshold =
      options?.stationaryVarianceThreshold ?? 0.1;
    this.stationaryAngularVelocityThreshold =
      options?.stationaryAngularVelocityThreshold ?? 0.1;
  }

  /**
   * 現在の初期化状態を取得
   */
  public getState(): IMUInitializationState {
    return this.state;
  }

  /**
   * サンプルを追加
   * @param acceleration 加速度ベクトル（重力含む）
   * @param angularVelocity 角速度ベクトル
   */
  public addSample(
    acceleration: THREE.Vector3,
    angularVelocity: THREE.Vector3
  ): void {
    if (
      this.state === IMUInitializationState.READY ||
      this.state === IMUInitializationState.FAILED
    ) {
      return;
    }

    if (this.state === IMUInitializationState.NOT_STARTED) {
      this.state = IMUInitializationState.COLLECTING_SAMPLES;
    }

    this.samples.push({
      acceleration: acceleration.clone(),
      angularVelocity: angularVelocity.clone(),
      timestamp: Date.now(),
    });

    if (this.samples.length > this.requiredSamples * 2) {
      this.samples = this.samples.slice(-this.requiredSamples);
    }

    if (this.samples.length >= this.requiredSamples) {
      this.tryCalibrate();
    }
  }

  /**
   * 静止状態かどうかを判定
   */
  public isStationary(): boolean {
    if (this.samples.length < this.requiredSamples) {
      return false;
    }

    const recentSamples = this.samples.slice(-this.requiredSamples);

    const accelerationVariance =
      this.calculateAccelerationVariance(recentSamples);
    const averageAngularVelocity =
      this.calculateAverageAngularVelocity(recentSamples);

    return (
      accelerationVariance < this.stationaryVarianceThreshold &&
      averageAngularVelocity < this.stationaryAngularVelocityThreshold
    );
  }

  /**
   * 初期化が完了しているか
   */
  public isReady(): boolean {
    return this.state === IMUInitializationState.READY;
  }

  /**
   * 重力ベクトルを取得
   */
  public getGravityVector(): THREE.Vector3 | null {
    return this.gravityVector?.clone() ?? null;
  }

  /**
   * 初期姿勢を取得
   */
  public getInitialOrientation(): THREE.Quaternion | null {
    return this.initialOrientation?.clone() ?? null;
  }

  /**
   * 初期化結果を取得
   */
  public getResult(): IMUInitializationResult {
    const calibrationQuality = this.calculateCalibrationQuality();

    return {
      success: this.state === IMUInitializationState.READY,
      gravityVector: this.gravityVector?.clone() ?? null,
      initialOrientation: this.initialOrientation?.clone() ?? null,
      calibrationQuality,
      errorMessage:
        this.state === IMUInitializationState.FAILED
          ? "Calibration failed: device not stationary"
          : undefined,
    };
  }

  /**
   * 初期化をリセット
   */
  public reset(): void {
    this.samples = [];
    this.state = IMUInitializationState.NOT_STARTED;
    this.gravityVector = null;
    this.initialOrientation = null;
  }

  /**
   * キャリブレーションを試行
   */
  private tryCalibrate(): void {
    if (!this.isStationary()) {
      return;
    }

    this.state = IMUInitializationState.CALIBRATING;

    try {
      this.estimateGravity();
      this.estimateInitialOrientation();
      this.state = IMUInitializationState.READY;
    } catch {
      this.state = IMUInitializationState.FAILED;
    }
  }

  /**
   * 重力ベクトルを推定
   */
  private estimateGravity(): void {
    const recentSamples = this.samples.slice(-this.requiredSamples);

    const averageAcceleration = new THREE.Vector3();
    for (const sample of recentSamples) {
      averageAcceleration.add(sample.acceleration);
    }
    averageAcceleration.divideScalar(recentSamples.length);

    const magnitude = averageAcceleration.length();
    if (Math.abs(magnitude - this.gravityMagnitude) > this.gravityTolerance) {
      throw new Error(
        `Invalid gravity magnitude: ${magnitude} (expected ~${this.gravityMagnitude})`
      );
    }

    this.gravityVector = averageAcceleration.clone();
  }

  /**
   * 初期姿勢を推定
   * 重力ベクトルから「上」方向を決定し、初期姿勢を計算
   */
  private estimateInitialOrientation(): void {
    if (!this.gravityVector) {
      throw new Error("Gravity vector not estimated");
    }

    const gravity = this.gravityVector.clone().normalize();

    const worldUp = new THREE.Vector3(0, 1, 0);

    const rotationAxis = new THREE.Vector3().crossVectors(gravity, worldUp);

    if (rotationAxis.length() < 0.001) {
      if (gravity.y > 0) {
        this.initialOrientation = new THREE.Quaternion();
      } else {
        this.initialOrientation = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0),
          Math.PI
        );
      }
      return;
    }

    rotationAxis.normalize();
    const angle = Math.acos(Math.max(-1, Math.min(1, gravity.dot(worldUp))));

    this.initialOrientation = new THREE.Quaternion().setFromAxisAngle(
      rotationAxis,
      angle
    );
  }

  /**
   * 加速度の分散を計算
   */
  private calculateAccelerationVariance(samples: MotionSample[]): number {
    if (samples.length === 0) return Infinity;

    const mean = new THREE.Vector3();
    for (const sample of samples) {
      mean.add(sample.acceleration);
    }
    mean.divideScalar(samples.length);

    let variance = 0;
    for (const sample of samples) {
      const diff = sample.acceleration.clone().sub(mean);
      variance += diff.lengthSq();
    }
    variance /= samples.length;

    return variance;
  }

  /**
   * 平均角速度を計算
   */
  private calculateAverageAngularVelocity(samples: MotionSample[]): number {
    if (samples.length === 0) return Infinity;

    let totalMagnitude = 0;
    for (const sample of samples) {
      totalMagnitude += sample.angularVelocity.length();
    }

    return totalMagnitude / samples.length;
  }

  /**
   * キャリブレーション品質を計算（0〜1）
   */
  private calculateCalibrationQuality(): number {
    if (this.samples.length < this.requiredSamples) {
      return 0;
    }

    const recentSamples = this.samples.slice(-this.requiredSamples);

    const accelerationVariance =
      this.calculateAccelerationVariance(recentSamples);
    const varianceScore = Math.max(
      0,
      1 - accelerationVariance / this.stationaryVarianceThreshold
    );

    const averageAngularVelocity =
      this.calculateAverageAngularVelocity(recentSamples);
    const angularVelocityScore = Math.max(
      0,
      1 - averageAngularVelocity / this.stationaryAngularVelocityThreshold
    );

    let gravityScore = 0;
    if (this.gravityVector) {
      const magnitude = this.gravityVector.length();
      const error = Math.abs(magnitude - this.gravityMagnitude);
      gravityScore = Math.max(0, 1 - error / this.gravityTolerance);
    }

    return (varianceScore + angularVelocityScore + gravityScore) / 3;
  }

  /**
   * 収集済みサンプル数を取得
   */
  public getSampleCount(): number {
    return this.samples.length;
  }

  /**
   * 初期化進捗を取得（0〜1）
   */
  public getProgress(): number {
    return Math.min(1, this.samples.length / this.requiredSamples);
  }
}

import * as THREE from "three";
import { DeviceOrientationData } from "../types/DeviceMotion";

/**
 * 姿勢表現と座標変換を行うユーティリティクラス
 * デバイス座標系とThree.js座標系間の変換を担当
 */
export class PoseRepresentation {
  private static readonly DEG_TO_RAD = Math.PI / 180;

  /**
   * デバイスの向きに応じた画面の向きオフセット（度）
   */
  private screenOrientation: number = 0;

  constructor() {
    this.updateScreenOrientation();
    if (typeof window !== "undefined") {
      window.addEventListener(
        "orientationchange",
        this.handleOrientationChange
      );
    }
  }

  /**
   * 画面の向き変更ハンドラー
   */
  private handleOrientationChange = (): void => {
    this.updateScreenOrientation();
  };

  /**
   * 画面の向きを更新
   */
  private updateScreenOrientation(): void {
    if (typeof window !== "undefined" && window.screen?.orientation) {
      this.screenOrientation = window.screen.orientation.angle || 0;
    } else if (typeof window !== "undefined") {
      this.screenOrientation = (window.orientation as number) || 0;
    }
  }

  /**
   * DeviceOrientation APIのデータからクォータニオンを生成
   * @param data DeviceOrientationデータ
   * @returns Three.jsクォータニオン
   */
  public orientationToQuaternion(
    data: DeviceOrientationData
  ): THREE.Quaternion {
    const alpha = data.alpha * PoseRepresentation.DEG_TO_RAD;
    const beta = data.beta * PoseRepresentation.DEG_TO_RAD;
    const gamma = data.gamma * PoseRepresentation.DEG_TO_RAD;
    const orient = this.screenOrientation * PoseRepresentation.DEG_TO_RAD;

    const quaternion = new THREE.Quaternion();
    this.setObjectQuaternion(quaternion, alpha, beta, gamma, orient);

    return quaternion;
  }

  /**
   * オイラー角（ZXY順序）からクォータニオンを設定
   * デバイス座標系からThree.js座標系への変換を含む
   *
   * 参考: https://w3c.github.io/deviceorientation/
   */
  private setObjectQuaternion(
    quaternion: THREE.Quaternion,
    alpha: number,
    beta: number,
    gamma: number,
    orient: number
  ): void {
    const zee = new THREE.Vector3(0, 0, 1);
    const euler = new THREE.Euler();
    const q0 = new THREE.Quaternion();
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

    euler.set(beta, alpha, -gamma, "YXZ");
    quaternion.setFromEuler(euler);
    quaternion.multiply(q1);
    quaternion.multiply(q0.setFromAxisAngle(zee, -orient));
  }

  /**
   * クォータニオンからオイラー角を生成
   * @param quaternion Three.jsクォータニオン
   * @returns オイラー角（度）
   */
  public quaternionToEuler(quaternion: THREE.Quaternion): {
    pitch: number;
    yaw: number;
    roll: number;
  } {
    const euler = new THREE.Euler().setFromQuaternion(quaternion, "YXZ");

    return {
      pitch: euler.x / PoseRepresentation.DEG_TO_RAD,
      yaw: euler.y / PoseRepresentation.DEG_TO_RAD,
      roll: euler.z / PoseRepresentation.DEG_TO_RAD,
    };
  }

  /**
   * クォータニオンを回転行列に変換
   * @param quaternion Three.jsクォータニオン
   * @returns 4x4変換行列
   */
  public quaternionToMatrix4(quaternion: THREE.Quaternion): THREE.Matrix4 {
    const matrix = new THREE.Matrix4();
    matrix.makeRotationFromQuaternion(quaternion);
    return matrix;
  }

  /**
   * デバイス座標系のベクトルをワールド座標系に変換
   * @param deviceVector デバイス座標系のベクトル
   * @param orientation 現在のデバイス姿勢
   * @returns ワールド座標系のベクトル
   */
  public deviceToWorld(
    deviceVector: THREE.Vector3,
    orientation: THREE.Quaternion
  ): THREE.Vector3 {
    const worldVector = deviceVector.clone();
    worldVector.applyQuaternion(orientation);
    return worldVector;
  }

  /**
   * ワールド座標系のベクトルをデバイス座標系に変換
   * @param worldVector ワールド座標系のベクトル
   * @param orientation 現在のデバイス姿勢
   * @returns デバイス座標系のベクトル
   */
  public worldToDevice(
    worldVector: THREE.Vector3,
    orientation: THREE.Quaternion
  ): THREE.Vector3 {
    const inverseOrientation = orientation.clone().invert();
    const deviceVector = worldVector.clone();
    deviceVector.applyQuaternion(inverseOrientation);
    return deviceVector;
  }

  /**
   * 重力ベクトルからデバイスの傾きを計算
   * @param gravity 重力ベクトル（デバイス座標系）
   * @returns 傾き角度（ラジアン）
   */
  public calculateTiltFromGravity(gravity: THREE.Vector3): {
    pitch: number;
    roll: number;
  } {
    const normalized = gravity.clone().normalize();

    const pitch = Math.atan2(-normalized.z, normalized.y);
    const roll = Math.atan2(normalized.x, normalized.y);

    return { pitch, roll };
  }

  /**
   * 2つのクォータニオン間の角度差を計算
   * @param q1 クォータニオン1
   * @param q2 クォータニオン2
   * @returns 角度差（ラジアン）
   */
  public angleBetweenQuaternions(
    q1: THREE.Quaternion,
    q2: THREE.Quaternion
  ): number {
    const dot = Math.abs(q1.dot(q2));
    return 2 * Math.acos(Math.min(dot, 1));
  }

  /**
   * クォータニオンを球面線形補間（Slerp）
   * @param q1 開始クォータニオン
   * @param q2 終了クォータニオン
   * @param t 補間係数（0〜1）
   * @returns 補間されたクォータニオン
   */
  public slerp(
    q1: THREE.Quaternion,
    q2: THREE.Quaternion,
    t: number
  ): THREE.Quaternion {
    return q1.clone().slerp(q2, t);
  }

  /**
   * クォータニオンをカメラに適用（AR用）
   * デバイスの姿勢に合わせてカメラを回転
   * @param camera Three.jsカメラ
   * @param orientation デバイス姿勢クォータニオン
   */
  public applyOrientationToCamera(
    camera: THREE.Camera,
    orientation: THREE.Quaternion
  ): void {
    camera.quaternion.copy(orientation);
  }

  /**
   * リソース解放
   */
  public dispose(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener(
        "orientationchange",
        this.handleOrientationChange
      );
    }
  }
}

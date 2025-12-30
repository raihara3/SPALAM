import * as THREE from "three";
import { AnimationConfig } from "../types/RenderingTypes";

/**
 * 回転アニメーション設定
 */
interface RotationAnimConfig {
  x: number;
  y: number;
  z: number;
}

/**
 * 浮遊アニメーション設定
 */
interface FloatAnimConfig {
  amplitude: number;
  frequency: number;
  initialY: number;
}

/**
 * パルスアニメーション設定
 */
interface PulseAnimConfig {
  minScale: number;
  maxScale: number;
  speed: number;
  initialScale: THREE.Vector3;
}

/**
 * カスタムアニメーション設定
 */
interface CustomAnimConfig {
  target: "position" | "rotation" | "scale";
  keyframes: Array<{
    time: number;
    value: { x?: number; y?: number; z?: number };
  }>;
  loop: boolean;
  duration: number;
}

/**
 * アニメーション設定の共用型
 */
type AnimConfigType =
  | RotationAnimConfig
  | FloatAnimConfig
  | PulseAnimConfig
  | CustomAnimConfig;

/**
 * GLTF読み込み結果の型
 */
interface GLTFResult {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

/**
 * アニメーションタイプ
 */
interface Animation {
  object: THREE.Object3D;
  type: "rotation" | "float" | "pulse" | "custom";
  config: AnimConfigType;
  startTime: number;
  currentTime: number;
  active: boolean;
}

/**
 * アニメーションサービス
 * Three.jsオブジェクトのアニメーションを管理
 */
export class AnimationService {
  private config: AnimationConfig;
  private animations: Map<string, Animation> = new Map();
  private clock: THREE.Clock;
  private animationMixers: Map<string, THREE.AnimationMixer> = new Map();

  constructor(config: AnimationConfig) {
    this.config = config;
    this.clock = new THREE.Clock();
  }

  /**
   * 回転アニメーションを追加
   */
  public addRotationAnimation(
    id: string,
    object: THREE.Object3D,
    speed?: { x: number; y: number; z: number }
  ): void {
    const animSpeed = speed || this.config.default.rotation.speed;

    this.animations.set(id, {
      object,
      type: "rotation",
      config: animSpeed,
      startTime: this.clock.getElapsedTime(),
      currentTime: 0,
      active: true,
    });
  }

  /**
   * 浮遊アニメーションを追加
   */
  public addFloatAnimation(
    id: string,
    object: THREE.Object3D,
    amplitude?: number,
    frequency?: number
  ): void {
    const config = {
      amplitude: amplitude || this.config.default.float.amplitude,
      frequency: frequency || this.config.default.float.frequency,
      initialY: object.position.y,
    };

    this.animations.set(id, {
      object,
      type: "float",
      config,
      startTime: this.clock.getElapsedTime(),
      currentTime: 0,
      active: true,
    });
  }

  /**
   * パルスアニメーションを追加
   */
  public addPulseAnimation(
    id: string,
    object: THREE.Object3D,
    minScale?: number,
    maxScale?: number,
    speed?: number
  ): void {
    const config = {
      minScale: minScale || this.config.default.pulse.minScale,
      maxScale: maxScale || this.config.default.pulse.maxScale,
      speed: speed || this.config.default.pulse.speed,
      initialScale: object.scale.clone(),
    };

    this.animations.set(id, {
      object,
      type: "pulse",
      config,
      startTime: this.clock.getElapsedTime(),
      currentTime: 0,
      active: true,
    });
  }

  /**
   * カスタムアニメーションを追加
   */
  public addCustomAnimation(
    id: string,
    object: THREE.Object3D,
    animationConfig: {
      name: string;
      target: "position" | "rotation" | "scale";
      keyframes: Array<{
        time: number;
        value: { x?: number; y?: number; z?: number };
      }>;
      loop: boolean;
      duration: number;
    }
  ): void {
    // キーフレームアニメーションの作成
    const tracks: THREE.KeyframeTrack[] = [];
    // const times: number[] = [];
    // const values: number[] = [];

    // キーフレームを時間順にソート
    const sortedKeyframes = [...animationConfig.keyframes].sort(
      (a, b) => a.time - b.time
    );

    // 各軸のトラックを作成
    ["x", "y", "z"].forEach((axis) => {
      const axisValues: number[] = [];
      const axisTimes: number[] = [];

      sortedKeyframes.forEach((keyframe) => {
        if (keyframe.value[axis as keyof typeof keyframe.value] !== undefined) {
          axisTimes.push(keyframe.time);
          axisValues.push(keyframe.value[axis as keyof typeof keyframe.value]!);
        }
      });

      if (axisTimes.length > 0) {
        const trackName = `${animationConfig.target}.${axis}`;
        tracks.push(
          new THREE.NumberKeyframeTrack(trackName, axisTimes, axisValues)
        );
      }
    });

    if (tracks.length > 0) {
      const clip = new THREE.AnimationClip(
        animationConfig.name,
        animationConfig.duration,
        tracks
      );
      const mixer = new THREE.AnimationMixer(object);
      const action = mixer.clipAction(clip);

      if (animationConfig.loop) {
        action.setLoop(THREE.LoopRepeat, Infinity);
      } else {
        action.setLoop(THREE.LoopOnce, 1);
      }

      action.play();
      this.animationMixers.set(id, mixer);
    }

    this.animations.set(id, {
      object,
      type: "custom",
      config: animationConfig,
      startTime: this.clock.getElapsedTime(),
      currentTime: 0,
      active: true,
    });
  }

  /**
   * GLTFモデルのアニメーションを追加
   */
  public addGLTFAnimation(
    _id: string,
    gltf: GLTFResult,
    animationIndex: number = 0,
    loop: boolean = true
  ): void {
    if (!gltf.animations || gltf.animations.length === 0) {
      console.warn("No animations found in GLTF model");
      return;
    }

    const mixer = new THREE.AnimationMixer(gltf.scene);
    const clip = gltf.animations[animationIndex];
    const action = mixer.clipAction(clip);

    if (loop) {
      action.setLoop(THREE.LoopRepeat, Infinity);
    } else {
      action.setLoop(THREE.LoopOnce, 1);
    }

    action.play();
    this.animationMixers.set(_id, mixer);
  }

  /**
   * アニメーションを更新
   */
  public update(): void {
    if (!this.config.enabled) return;

    const deltaTime = this.clock.getDelta();
    const elapsedTime = this.clock.getElapsedTime();

    // 標準アニメーションの更新
    this.animations.forEach((animation, _id) => {
      if (!animation.active) return;

      animation.currentTime = elapsedTime - animation.startTime;

      switch (animation.type) {
        case "rotation":
          this.updateRotation(animation);
          break;

        case "float":
          this.updateFloat(animation);
          break;

        case "pulse":
          this.updatePulse(animation);
          break;
      }
    });

    // AnimationMixerの更新
    this.animationMixers.forEach((mixer) => {
      mixer.update(deltaTime);
    });
  }

  /**
   * 回転アニメーションを更新
   */
  private updateRotation(animation: Animation): void {
    const speed = animation.config as RotationAnimConfig;
    const deltaTime = this.clock.getDelta();

    animation.object.rotation.x += speed.x * deltaTime;
    animation.object.rotation.y += speed.y * deltaTime;
    animation.object.rotation.z += speed.z * deltaTime;
  }

  /**
   * 浮遊アニメーションを更新
   */
  private updateFloat(animation: Animation): void {
    const config = animation.config as FloatAnimConfig;
    const time = animation.currentTime;

    animation.object.position.y =
      config.initialY + Math.sin(time * config.frequency) * config.amplitude;
  }

  /**
   * パルスアニメーションを更新
   */
  private updatePulse(animation: Animation): void {
    const config = animation.config as PulseAnimConfig;
    const time = animation.currentTime;

    const scale =
      config.minScale + (config.maxScale - config.minScale) * (Math.sin(time * config.speed) * 0.5 + 0.5);
    animation.object.scale.copy(config.initialScale).multiplyScalar(scale);
  }

  /**
   * アニメーションを一時停止
   */
  public pause(id: string): void {
    const animation = this.animations.get(id);
    if (animation) {
      animation.active = false;
    }

    const mixer = this.animationMixers.get(id);
    if (mixer) {
      mixer.timeScale = 0;
    }
  }

  /**
   * アニメーションを再開
   */
  public resume(id: string): void {
    const animation = this.animations.get(id);
    if (animation) {
      animation.active = true;
      animation.startTime = this.clock.getElapsedTime() - animation.currentTime;
    }

    const mixer = this.animationMixers.get(id);
    if (mixer) {
      mixer.timeScale = 1;
    }
  }

  /**
   * アニメーションを停止
   */
  public stop(id: string): void {
    const animation = this.animations.get(id);
    if (animation) {
      animation.active = false;

      // オブジェクトを初期状態に戻す
      switch (animation.type) {
        case "float":
          animation.object.position.y = (animation.config as FloatAnimConfig).initialY;
          break;
        case "pulse":
          animation.object.scale.copy((animation.config as PulseAnimConfig).initialScale);
          break;
      }
    }

    const mixer = this.animationMixers.get(id);
    if (mixer) {
      mixer.stopAllAction();
    }
  }

  /**
   * アニメーションを削除
   */
  public remove(id: string): void {
    this.stop(id);
    this.animations.delete(id);

    const mixer = this.animationMixers.get(id);
    if (mixer) {
      mixer.stopAllAction();
      mixer.uncacheRoot(mixer.getRoot());
      this.animationMixers.delete(id);
    }
  }

  /**
   * すべてのアニメーションをクリア
   */
  public clear(): void {
    this.animations.forEach((_, id) => this.remove(id));
  }

  /**
   * アニメーション速度を設定
   */
  public setSpeed(id: string, speed: number): void {
    const mixer = this.animationMixers.get(id);
    if (mixer) {
      mixer.timeScale = speed;
    }
  }

  /**
   * グローバルアニメーション速度を設定
   */
  public setGlobalSpeed(speed: number): void {
    this.animationMixers.forEach((mixer) => {
      mixer.timeScale = speed;
    });
  }

  /**
   * アニメーションの状態を取得
   */
  public getAnimationState(id: string): {
    active: boolean;
    currentTime: number;
    type: string;
  } | null {
    const animation = this.animations.get(id);
    if (!animation) return null;

    return {
      active: animation.active,
      currentTime: animation.currentTime,
      type: animation.type,
    };
  }

  /**
   * 設定を更新
   */
  public updateConfig(config: Partial<AnimationConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

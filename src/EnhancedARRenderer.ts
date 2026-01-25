/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
// import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { RenderingService } from "./services/RenderingService";
import { AnimationService } from "./services/AnimationService";
import {
  RenderingConfig,
  LightConfig,
  CameraConfig,
  MaterialConfig,
  RenderingStats,
  RenderingMode,
  ShadowMapType,
} from "./types/RenderingTypes";
import { ARRendererConfig } from "./config/types";

/**
 * OrbitControls-like interface for camera control
 */
interface CameraControls {
  update(): void;
  dispose(): void;
}

/**
 * Animation configuration types
 */
interface RotationAnimationConfig {
  x: number;
  y: number;
  z: number;
}

interface FloatAnimationConfig {
  amplitude?: number;
  frequency?: number;
}

interface PulseAnimationConfig {
  minScale?: number;
  maxScale?: number;
  speed?: number;
}

type AnimationConfigUnion = RotationAnimationConfig | FloatAnimationConfig | PulseAnimationConfig;

/**
 * Fog configuration types
 */
interface LinearFogConfig {
  color: THREE.ColorRepresentation;
  near: number;
  far: number;
}

interface ExponentialFogConfig {
  color: THREE.ColorRepresentation;
  density: number;
}

/**
 * Custom animation configuration
 */
interface CustomAnimationConfig {
  name: string;
  target: "position" | "rotation" | "scale";
  keyframes: Array<{
    time: number;
    value: { x?: number; y?: number; z?: number };
  }>;
  loop: boolean;
  duration: number;
}

/**
 * 拡張ARレンダラー
 * 高度なレンダリング機能とパフォーマンス最適化を提供
 */
export class EnhancedARRenderer {
  private width: number;
  private height: number;

  // キャンバス
  private canvas: HTMLCanvasElement;

  // Three.js コア
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;

  // サービス
  private renderingService!: RenderingService;
  private animationService!: AnimationService;

  // コントロール
  private controls?: CameraControls;

  // 設定
  private config: ARRendererConfig & {
    rendering?: RenderingConfig;
    camera?: CameraConfig;
    lights?: LightConfig;
  };

  // レイキャスター（インタラクション用）
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;

  // パフォーマンスモニタ
  private performanceMonitor: {
    enabled: boolean;
    callback?: (stats: RenderingStats) => void;
  } = { enabled: false };

  constructor({
    width,
    height,
    config,
  }: {
    width: number;
    height: number;
    config: ARRendererConfig & {
      rendering?: RenderingConfig;
      camera?: CameraConfig;
      lights?: LightConfig;
    };
  }) {
    this.width = width;
    this.height = height;
    this.config = config;

    // レイキャスター初期化
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // キャンバス作成
    this.canvas = this.createCanvas();

    // Three.js初期化
    this.initThreeJS();

    // サービス初期化
    this.initServices();

    // イベントリスナー設定
    this.setupEventListeners();
  }

  /**
   * キャンバスを作成
   */
  private createCanvas(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.id = "enhancedARCanvas";
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = this.config.camera?.controls.enableOrbit
      ? "auto"
      : "none";
    document.body.appendChild(canvas);

    return canvas;
  }

  /**
   * Three.js初期化
   */
  private initThreeJS(): void {
    // シーン作成
    this.scene = new THREE.Scene();

    // カメラ設定
    const cameraConfig = this.config.camera || {
      fov: this.config.fov || 75,
      near: this.config.near || 0.1,
      far: this.config.far || 1000,
      position: { x: 0, y: 0, z: 3 },
      lookAt: { x: 0, y: 0, z: 0 },
      controls: {
        enableOrbit: false,
        enablePan: false,
        enableZoom: false,
        autoRotate: false,
        autoRotateSpeed: 2,
        enableDamping: true,
        dampingFactor: 0.05,
      },
    };

    this.camera = new THREE.PerspectiveCamera(
      cameraConfig.fov,
      this.width / this.height,
      cameraConfig.near,
      cameraConfig.far
    );

    this.camera.position.set(
      cameraConfig.position.x,
      cameraConfig.position.y,
      cameraConfig.position.z
    );

    this.camera.lookAt(
      cameraConfig.lookAt.x,
      cameraConfig.lookAt.y,
      cameraConfig.lookAt.z
    );

    // レンダラー設定
    const renderingConfig = this.config.rendering || {
      mode: RenderingMode.STANDARD,
      antialias: true,
      pixelRatio: window.devicePixelRatio,
      clearColor: 0x000000,
      clearAlpha: 0,
      shadows: {
        enabled: true,
        type: ShadowMapType.PCF,
        resolution: 2048,
      },
      postProcessing: {
        enabled: false,
        effects: [],
      },
      performance: {
        enableLOD: true,
        frustumCulling: true,
        occlusionCulling: false,
        enableInstancing: true,
      },
    };

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: renderingConfig.antialias,
      powerPreference: "high-performance",
    });

    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(renderingConfig.pixelRatio);
    this.renderer.setClearColor(
      renderingConfig.clearColor,
      renderingConfig.clearAlpha
    );

    // コントロール設定（将来的に実装）
    if (cameraConfig.controls.enableOrbit) {
      // TODO: OrbitControlsを実装
      console.log("OrbitControls will be implemented in future version");
    }
  }

  /**
   * サービス初期化
   */
  private initServices(): void {
    // レンダリングサービス
    const renderingConfig = this.config.rendering || {
      mode: RenderingMode.STANDARD,
      antialias: true,
      pixelRatio: window.devicePixelRatio,
      clearColor: 0x000000,
      clearAlpha: 0,
      shadows: {
        enabled: true,
        type: ShadowMapType.PCF,
        resolution: 2048,
      },
      postProcessing: {
        enabled: false,
        effects: [],
      },
      performance: {
        enableLOD: true,
        frustumCulling: true,
        occlusionCulling: false,
        enableInstancing: true,
      },
    };

    this.renderingService = new RenderingService(
      this.renderer,
      this.scene,
      this.camera,
      renderingConfig
    );

    // アニメーションサービス
    const animationConfig = {
      enabled: true,
      default: {
        rotation: {
          enabled: false,
          speed: { x: 0, y: 0.01, z: 0 },
        },
        float: {
          enabled: false,
          amplitude: 0.1,
          frequency: 1,
        },
        pulse: {
          enabled: false,
          minScale: 0.9,
          maxScale: 1.1,
          speed: 2,
        },
      },
      custom: [],
    };

    this.animationService = new AnimationService(animationConfig);

    // デフォルトライト設定
    if (this.config.lights) {
      this.renderingService.setupLights(this.config.lights);
    } else {
      // デフォルトライト
      const defaultLights: LightConfig = {
        ambient: {
          enabled: true,
          color: 0xffffff,
          intensity: 0.6,
        },
        directional: {
          enabled: true,
          color: 0xffffff,
          intensity: 0.8,
          position: { x: 5, y: 5, z: 5 },
          castShadow: true,
        },
        points: [],
        spots: [],
      };
      this.renderingService.setupLights(defaultLights);
    }
  }

  /**
   * イベントリスナー設定
   */
  private setupEventListeners(): void {
    // ウィンドウリサイズ
    window.addEventListener("resize", () => this.handleResize());

    // マウスイベント（インタラクション用）
    this.canvas.addEventListener("mousemove", (event) =>
      this.handleMouseMove(event)
    );
    this.canvas.addEventListener("click", (event) => this.handleClick(event));

    // タッチイベント
    this.canvas.addEventListener("touchstart", (event) =>
      this.handleTouchStart(event)
    );
    this.canvas.addEventListener("touchmove", (event) =>
      this.handleTouchMove(event)
    );
  }

  /**
   * リサイズ処理
   */
  private handleResize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(this.width, this.height);
  }

  /**
   * マウス移動処理
   */
  private handleMouseMove(event: MouseEvent): void {
    this.mouse.x = (event.clientX / this.width) * 2 - 1;
    this.mouse.y = -(event.clientY / this.height) * 2 + 1;
  }

  /**
   * クリック処理
   */
  private handleClick(event: MouseEvent): void {
    this.handleMouseMove(event);

    // レイキャスト
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(
      this.scene.children,
      true
    );

    if (intersects.length > 0) {
      const object = intersects[0].object;
      // カスタムイベントを発火
      this.canvas.dispatchEvent(
        new CustomEvent("objectClick", {
          detail: { object, point: intersects[0].point },
        })
      );
    }
  }

  /**
   * タッチ開始処理
   */
  private handleTouchStart(event: TouchEvent): void {
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      this.mouse.x = (touch.clientX / this.width) * 2 - 1;
      this.mouse.y = -(touch.clientY / this.height) * 2 + 1;
    }
  }

  /**
   * タッチ移動処理
   */
  private handleTouchMove(event: TouchEvent): void {
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      this.mouse.x = (touch.clientX / this.width) * 2 - 1;
      this.mouse.y = -(touch.clientY / this.height) * 2 + 1;
    }
  }

  /**
   * オブジェクトを追加
   */
  public addObject(object: THREE.Object3D): void {
    this.scene.add(object);
  }

  /**
   * オブジェクトを削除
   */
  public removeObject(object: THREE.Object3D): void {
    this.scene.remove(object);
  }

  /**
   * メッシュを作成
   */
  public createMesh(
    geometry: THREE.BufferGeometry,
    materialConfig?: MaterialConfig
  ): THREE.Mesh {
    const material = materialConfig
      ? this.renderingService.createMaterial(materialConfig)
      : new THREE.MeshStandardMaterial({ color: 0xffffff });

    return new THREE.Mesh(geometry, material);
  }

  /**
   * LODオブジェクトを作成
   */
  public createLOD(
    id: string,
    levels: Array<{
      geometry: THREE.BufferGeometry;
      material: THREE.Material;
      distance: number;
    }>
  ): THREE.LOD {
    return this.renderingService.createLOD(id, levels);
  }

  /**
   * インスタンスメッシュを作成
   */
  public createInstancedMesh(
    id: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    count: number
  ): THREE.InstancedMesh {
    return this.renderingService.createInstancedMesh(
      id,
      geometry,
      material,
      count
    );
  }

  /**
   * アニメーションを追加
   */
  public addAnimation(
    id: string,
    object: THREE.Object3D,
    type: "rotation" | "float" | "pulse",
    config?: AnimationConfigUnion
  ): void {
    switch (type) {
      case "rotation": {
        const rotationConfig = config as RotationAnimationConfig | undefined;
        this.animationService.addRotationAnimation(id, object, rotationConfig);
        break;
      }
      case "float": {
        const floatConfig = config as FloatAnimationConfig | undefined;
        this.animationService.addFloatAnimation(
          id,
          object,
          floatConfig?.amplitude,
          floatConfig?.frequency
        );
        break;
      }
      case "pulse": {
        const pulseConfig = config as PulseAnimationConfig | undefined;
        this.animationService.addPulseAnimation(
          id,
          object,
          pulseConfig?.minScale,
          pulseConfig?.maxScale,
          pulseConfig?.speed
        );
        break;
      }
    }
  }

  /**
   * カスタムアニメーションを追加
   */
  public addCustomAnimation(
    id: string,
    object: THREE.Object3D,
    config: CustomAnimationConfig
  ): void {
    this.animationService.addCustomAnimation(id, object, config);
  }

  /**
   * GLTFモデルをロード（将来的に実装）
   */
  public async loadGLTF(url: string): Promise<THREE.Group | null> {
    // TODO: GLTFLoaderを実装
    console.log(`GLTF loading will be implemented in future version: ${url}`);
    return Promise.resolve(null);
  }

  /**
   * スクリーンショットを撮影
   */
  public captureScreenshot(
    format: "png" | "jpeg" = "png",
    quality: number = 0.9
  ): string {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL(`image/${format}`, quality);
  }

  /**
   * パフォーマンスモニタリングを有効化
   */
  public enablePerformanceMonitor(
    callback: (stats: RenderingStats) => void
  ): void {
    this.performanceMonitor = {
      enabled: true,
      callback,
    };
  }

  /**
   * レンダリングモードを設定
   */
  public setRenderingMode(mode: RenderingMode): void {
    this.renderingService.setRenderingMode(mode);
  }

  /**
   * フォグを設定
   */
  public setFog(type: "linear", config: LinearFogConfig): void;
  public setFog(type: "exponential", config: ExponentialFogConfig): void;
  public setFog(type: "linear" | "exponential", config: LinearFogConfig | ExponentialFogConfig): void {
    if (type === "linear") {
      const linearConfig = config as LinearFogConfig;
      this.scene.fog = new THREE.Fog(linearConfig.color, linearConfig.near, linearConfig.far);
    } else {
      const expConfig = config as ExponentialFogConfig;
      this.scene.fog = new THREE.FogExp2(expConfig.color, expConfig.density);
    }
  }

  /**
   * 環境マップを設定
   */
  public setEnvironmentMap(texture: THREE.Texture): void {
    this.scene.environment = texture;
  }

  /**
   * レンダリング
   */
  public render(): void {
    // アニメーション更新
    this.animationService.update();

    // コントロール更新
    if (this.controls) {
      this.controls.update();
    }

    // 最適化されたレンダリング
    this.renderingService.render();

    // パフォーマンスモニタリング
    if (this.performanceMonitor.enabled && this.performanceMonitor.callback) {
      const stats = this.renderingService.getStats();
      this.performanceMonitor.callback(stats);
    }
  }

  /**
   * ゲッター
   */
  public getScene(): THREE.Scene {
    return this.scene;
  }

  public getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  public getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  public getRenderingService(): RenderingService {
    return this.renderingService;
  }

  public getAnimationService(): AnimationService {
    return this.animationService;
  }

  /**
   * カメラ位置を設定
   */
  public setCameraPosition(x: number, y: number, z: number): void {
    this.camera.position.set(x, y, z);
  }

  /**
   * カメラを対象に向ける
   */
  public lookAt(x: number, y: number, z: number): void {
    this.camera.lookAt(x, y, z);
  }

  /**
   * リソースのクリーンアップ
   */
  public dispose(): void {
    // アニメーションクリア
    this.animationService.clear();

    // レンダリングサービスのクリーンアップ
    this.renderingService.dispose();

    // シーンのクリーンアップ
    this.scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    // レンダラーのクリーンアップ
    this.renderer.dispose();

    // コントロールのクリーンアップ
    if (this.controls) {
      this.controls.dispose();
    }

    // キャンバスを削除
    this.canvas.remove();
  }
}

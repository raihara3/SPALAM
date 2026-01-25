/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";

/**
 * レンダリングモードの種類
 */
export enum RenderingMode {
  /** 標準レンダリング */
  STANDARD = "standard",
  /** ワイヤーフレーム */
  WIREFRAME = "wireframe",
  /** ポイントクラウド */
  POINT_CLOUD = "point_cloud",
  /** シェーダーマテリアル */
  SHADER = "shader",
}

/**
 * ポストプロセッシング効果
 */
export enum PostProcessingEffect {
  /** アンチエイリアシング */
  ANTIALIASING = "antialiasing",
  /** ブルーム効果 */
  BLOOM = "bloom",
  /** 被写界深度 */
  DEPTH_OF_FIELD = "depth_of_field",
  /** モーションブラー */
  MOTION_BLUR = "motion_blur",
  /** 環境光遮蔽 */
  SSAO = "ssao",
  /** トーンマッピング */
  TONE_MAPPING = "tone_mapping",
}

/**
 * シャドウマップタイプ
 */
export enum ShadowMapType {
  /** シャドウなし */
  NONE = "none",
  /** 基本シャドウマップ */
  BASIC = "basic",
  /** PCFシャドウマップ */
  PCF = "pcf",
  /** PCFソフトシャドウマップ */
  PCF_SOFT = "pcf_soft",
  /** VSMシャドウマップ */
  VSM = "vsm",
}

/**
 * レンダリング設定
 */
export interface RenderingConfig {
  /** レンダリングモード */
  mode: RenderingMode;
  /** アンチエイリアシング */
  antialias: boolean;
  /** ピクセル比 */
  pixelRatio: number;
  /** 背景色 */
  clearColor: number;
  /** 背景透明度 */
  clearAlpha: number;
  /** シャドウ設定 */
  shadows: {
    enabled: boolean;
    type: ShadowMapType;
    resolution: number;
  };
  /** ポストプロセッシング */
  postProcessing: {
    enabled: boolean;
    effects: PostProcessingEffect[];
  };
  /** パフォーマンス設定 */
  performance: {
    /** LOD（Level of Detail）有効化 */
    enableLOD: boolean;
    /** フラスタムカリング */
    frustumCulling: boolean;
    /** オクルージョンカリング */
    occlusionCulling: boolean;
    /** インスタンシング */
    enableInstancing: boolean;
  };
}

/**
 * ライト設定
 */
export interface LightConfig {
  /** 環境光 */
  ambient: {
    enabled: boolean;
    color: number;
    intensity: number;
  };
  /** 平行光源 */
  directional: {
    enabled: boolean;
    color: number;
    intensity: number;
    position: { x: number; y: number; z: number };
    castShadow: boolean;
  };
  /** ポイントライト */
  points: Array<{
    color: number;
    intensity: number;
    position: { x: number; y: number; z: number };
    distance: number;
    decay: number;
  }>;
  /** スポットライト */
  spots: Array<{
    color: number;
    intensity: number;
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
    angle: number;
    penumbra: number;
    distance: number;
    decay: number;
  }>;
}

/**
 * マテリアル設定
 */
export interface MaterialConfig {
  /** マテリアルタイプ */
  type: "basic" | "standard" | "phong" | "physical" | "shader";
  /** 基本設定 */
  base: {
    color: number;
    opacity: number;
    transparent: boolean;
    side: "front" | "back" | "double";
  };
  /** PBR設定（standard/physicalマテリアル用） */
  pbr?: {
    metalness: number;
    roughness: number;
    emissive: number;
    emissiveIntensity: number;
  };
  /** カスタムシェーダー設定 */
  shader?: {
    vertexShader: string;
    fragmentShader: string;
    uniforms: Record<string, THREE.IUniform>;
  };
}

/**
 * アニメーション設定
 */
export interface AnimationConfig {
  /** アニメーション有効化 */
  enabled: boolean;
  /** デフォルトアニメーション */
  default: {
    /** 回転アニメーション */
    rotation: {
      enabled: boolean;
      speed: { x: number; y: number; z: number };
    };
    /** 浮遊アニメーション */
    float: {
      enabled: boolean;
      amplitude: number;
      frequency: number;
    };
    /** パルスアニメーション */
    pulse: {
      enabled: boolean;
      minScale: number;
      maxScale: number;
      speed: number;
    };
  };
  /** カスタムアニメーション */
  custom: Array<{
    name: string;
    target: "position" | "rotation" | "scale";
    keyframes: Array<{
      time: number;
      value: { x?: number; y?: number; z?: number };
    }>;
    loop: boolean;
    duration: number;
  }>;
}

/**
 * カメラ設定
 */
export interface CameraConfig {
  /** 視野角 */
  fov: number;
  /** ニアクリップ */
  near: number;
  /** ファークリップ */
  far: number;
  /** 初期位置 */
  position: { x: number; y: number; z: number };
  /** 初期注視点 */
  lookAt: { x: number; y: number; z: number };
  /** カメラコントロール */
  controls: {
    /** オービットコントロール有効化 */
    enableOrbit: boolean;
    /** パンニング有効化 */
    enablePan: boolean;
    /** ズーム有効化 */
    enableZoom: boolean;
    /** 自動回転 */
    autoRotate: boolean;
    /** 自動回転速度 */
    autoRotateSpeed: number;
    /** ダンピング */
    enableDamping: boolean;
    /** ダンピング係数 */
    dampingFactor: number;
  };
}

/**
 * レンダリング統計情報
 */
export interface RenderingStats {
  /** FPS */
  fps: number;
  /** フレーム時間 */
  frameTime: number;
  /** 描画コール数 */
  drawCalls: number;
  /** 三角形数 */
  triangles: number;
  /** テクスチャメモリ使用量 */
  textureMemory: number;
  /** ジオメトリメモリ使用量 */
  geometryMemory: number;
}

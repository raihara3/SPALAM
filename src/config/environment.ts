/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 環境変数の管理
 */

/**
 * 環境変数の型定義
 */
interface EnvironmentVariables {
  /** デバッグモードの有効化 */
  VITE_DEBUG?: string;
  /** 深度推定モデルのURL（カスタムモデル使用時） */
  VITE_DEPTH_MODEL_URL?: string;
  /** 推論デバイスの指定 */
  VITE_DEVICE?: "cpu" | "webgpu";
  /** 特徴点表示の有効化 */
  VITE_SHOW_FEATURES?: string;
  /** 深度マップ表示の有効化 */
  VITE_SHOW_DEPTH?: string;
}

/**
 * 環境変数を取得
 */
export function getEnv(): EnvironmentVariables {
  // Viteの環境変数はimport.meta.envで取得
  if (typeof import.meta !== "undefined" && import.meta.env) {
    return import.meta.env as EnvironmentVariables;
  }

  // Node.js環境の場合
  if (typeof process !== "undefined" && process.env) {
    return process.env as unknown as EnvironmentVariables;
  }

  return {};
}

/**
 * デバッグモードが有効かチェック
 */
export function isDebugMode(): boolean {
  const env = getEnv();
  return env.VITE_DEBUG === "true";
}

/**
 * 環境変数から設定値を取得
 */
export function getEnvConfig() {
  const env = getEnv();

  return {
    debug: isDebugMode(),
    depthModelUrl: env.VITE_DEPTH_MODEL_URL,
    device: env.VITE_DEVICE || "webgpu",
    showFeatures: env.VITE_SHOW_FEATURES !== "false",
    showDepth: env.VITE_SHOW_DEPTH !== "false",
  };
}

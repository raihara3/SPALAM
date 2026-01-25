/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Feature {
  x: number;
  y: number;
  trackingCount: number; // 追跡されているフレーム数
  id: string;
  /** 特徴点のスコア（信頼度） */
  score?: number;
  /** 特徴点の向き（度単位） */
  angle?: number;
  /** オクターブレベル */
  octave?: number;
  /** 特徴点のサイズ */
  size?: number;
}

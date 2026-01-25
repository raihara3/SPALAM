/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { Point3D } from "../types/Point";

/**
 * 平面フィッティング結果
 */
interface PlaneFitResult {
  a: number;
  b: number;
  c: number;
}

/**
 * 3x3行列の型
 */
type Matrix3x3 = [[number, number, number], [number, number, number], [number, number, number]];

/**
 * 3次元ベクトルの型
 */
type Vector3 = [number, number, number];

/**
 * weightedPlaneFit2D
 *   inliers:          平面とみなした 3D inlier 点群 [{ x, y, z },…]
 *   weights:          点ごとの重み配列 same length as inliers
 * @return { a, b, c }  で z ≈ a*x + b*y + c
 */
export function weightedPlaneFit2D(inliers: Point3D[], weights: number[]): PlaneFitResult {
  let Sxx = 0,
    Syy = 0,
    Sxy = 0;
  let Sxz = 0,
    Syz = 0,
    Sw = 0;
  let Sx = 0,
    Sy = 0,
    Sz = 0;

  for (let i = 0; i < inliers.length; i++) {
    const { x, y, z } = inliers[i];
    const w = weights[i];
    Sxx += w * x * x;
    Syy += w * y * y;
    Sxy += w * x * y;
    Sxz += w * x * z;
    Syz += w * y * z;
    Sx += w * x;
    Sy += w * y;
    Sz += w * z;
    Sw += w;
  }

  // 数値の正規化（スケール調整）
  const scale = Math.max(Math.abs(Sxx), Math.abs(Syy), Math.abs(Sw));
  if (scale > 1e-6) {
    Sxx /= scale;
    Syy /= scale;
    Sxy /= scale;
    Sxz /= scale;
    Syz /= scale;
    Sx /= scale;
    Sy /= scale;
    Sz /= scale;
    Sw /= scale;
  }

  // [[Sxx, Sxy, Sx ],   [ a ]   [ Sxz ]
  //  [Sxy, Syy, Sy ], * [ b ] = [ Syz ]
  //  [ Sx,  Sy, Sw ]]   [ c ]   [ Sz  ]]
  const A: Matrix3x3 = [
    [Sxx, Sxy, Sx],
    [Sxy, Syy, Sy],
    [Sx, Sy, Sw],
  ];
  const B: Vector3 = [Sxz, Syz, Sz];

  // 3x3 を解く（逆行列 or Cramer's rule）
  const invA = invert3x3(A);
  const [a, b, c] = multiplyMatVec(invA, B);
  return { a, b, c };
}

// --- ヘルパー行列演算 ---
// 3×3 行列を逆行列にする
function invert3x3(m: Matrix3x3): Matrix3x3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-6) throw new Error("平面フィット: 行列が特異");
  const invDet = 1 / det;
  return [
    [A * invDet, D * invDet, G * invDet],
    [B * invDet, E * invDet, H * invDet],
    [C * invDet, F * invDet, I * invDet],
  ];
}

// 行列×ベクトル
function multiplyMatVec(m: Matrix3x3, v: Vector3): Vector3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

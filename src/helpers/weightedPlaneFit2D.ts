/**
 * weightedPlaneFit2D
 *   inliers:          平面とみなした 3D inlier 点群 [{ X, Y, Z },…]
 *   weights:          点ごとの重み配列 same length as inliers
 * @return { a, b, c }  で Z ≈ a X + b Y + c
 */
export function weightedPlaneFit2D(inliers: any, weights: any) {
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
    const { X, Y, Z } = inliers[i];
    const w = weights[i];
    Sxx += w * X * X;
    Syy += w * Y * Y;
    Sxy += w * X * Y;
    Sxz += w * X * Z;
    Syz += w * Y * Z;
    Sx += w * X;
    Sy += w * Y;
    Sz += w * Z;
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
  const A = [
    [Sxx, Sxy, Sx],
    [Sxy, Syy, Sy],
    [Sx, Sy, Sw],
  ];
  const B = [Sxz, Syz, Sz];

  // 3x3 を解く（逆行列 or Cramer's rule）
  const invA = invert3x3(A);
  const [a, b, c] = multiplyMatVec(invA, B);
  return { a, b, c };
}

// --- ヘルパー行列演算 ---
// 3×3 行列を逆行列にする
function invert3x3(m: any) {
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
function multiplyMatVec(m: any, v: any) {
  return m.map((row: any) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
}

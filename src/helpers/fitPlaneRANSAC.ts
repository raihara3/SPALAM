// types
import { Point3D, PlaneModel } from "../types";

/**
 * @param {Array<Point3D>} points
 *   - 3D 点群
 * @param {number} iterations
 *   - 試行回数（例: 1000）
 * @param {number} threshold
 *   - inlier 判定の距離閾値（同じ単位、例: 0.05 m）
 * @returns {{
 *   plane: { a: number, b: number, c: number, d: number },
 *   inliers: Array<Point3D>
 * }}
 *   - 最良の平面モデルと、その inlier 点群
 */
function fitPlaneRANSAC({
  points,
  iterations = 100,
  threshold = 0.1,
}: {
  points: Point3D[];
  iterations?: number;
  threshold?: number;
}): RANSACResult {
  if (points.length < 3) {
    throw new Error("最低3点が必要です");
  }
  if (iterations <= 0) {
    throw new Error("iterationsは正の値である必要があります");
  }
  if (threshold <= 0) {
    throw new Error("thresholdは正の値である必要があります");
  }

  let best: { model: PlaneModel | null; inliers: Point3D[] } = {
    model: null,
    inliers: [],
  };

  for (let i = 0; i < iterations; i++) {
    // 1) ランダムに3点を選んで平面モデルを計算
    const sample = randomSample(points, 3);
    const model = computePlaneFrom3Points(sample[0], sample[1], sample[2]);
    // 2) 全点に対して距離を計算し、閾値以下なら inlier
    const inliers = points.filter(
      (p) => distancePointToPlane(p, model) < threshold
    );
    // 3) inlier が最も多いモデルを保持
    if (inliers.length > best.inliers.length) {
      best = { model, inliers };
    }
  }

  return best;
}

/**
 * 点群からランダムに指定数の点を選択
 */
function randomSample(points: Array<Point3D>, n: number): Array<Point3D> {
  const result = [];
  const indices = new Set<number>();
  while (indices.size < n) {
    const idx = Math.floor(Math.random() * points.length);
    if (!indices.has(idx)) {
      indices.add(idx);
      result.push(points[idx]);
    }
  }

  return result;
}

/**
 * 3点から平面パラメータ(ax + by + cz + d = 0)を計算
 */
function computePlaneFrom3Points(p1: Point3D, p2: Point3D, p3: Point3D) {
  // 2つのベクトルを計算
  const v1 = {
    x: p2.x - p1.x,
    y: p2.y - p1.y,
    z: p2.z - p1.z,
  };
  const v2 = {
    x: p3.x - p1.x,
    y: p3.y - p1.y,
    z: p3.z - p1.z,
  };
  // 外積で法線ベクトルを計算
  const normal = {
    x: v1.y * v2.z - v1.z * v2.y,
    y: v1.z * v2.x - v1.x * v2.z,
    z: v1.x * v2.y - v1.y * v2.x,
  };
  // 正規化
  const length = Math.sqrt(
    normal.x * normal.x + normal.y * normal.y + normal.z * normal.z
  );
  const a = normal.x / length;
  const b = normal.y / length;
  const c = normal.z / length;
  // d = -(ax + by + cz) を計算
  const d = -(a * p1.x + b * p1.y + c * p1.z);

  return { a, b, c, d };
}

/**
 * 点と平面の距離を計算
 */
export function distancePointToPlane(
  point: Point3D,
  plane: { a: number; b: number; c: number; d: number }
): number {
  const numerator = Math.abs(
    plane.a * point.x + plane.b * point.y + plane.c * point.z + plane.d
  );
  const denominator = Math.sqrt(
    plane.a * plane.a + plane.b * plane.b + plane.c * plane.c
  );
  return numerator / denominator;
}

/**
 * 深度情報を元に点群をフィルタリング
 * 深度の中央値からの偏差が delta 以下の点を残す
 */
export function filterByDepth(points3D: Point3D[], delta = 0.025) {
  const zs = points3D.map((p) => p.z).sort((a, b) => a - b);
  const medZ = zs[Math.floor(zs.length / 2)];
  return points3D.filter((p) => Math.abs(p.z - medZ) < delta);
}

interface RANSACResult {
  model: PlaneModel | null;
  inliers: Point3D[];
}

export default fitPlaneRANSAC;

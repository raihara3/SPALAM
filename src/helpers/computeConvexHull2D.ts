// types
import { Point2D } from "../types";

/**
 * @param {Array<{ u: number, v: number }>} points
 *   - 平面上の 2D 座標点群
 * @returns {Array<{ u: number, v: number }>}
 *   - 凸包を構成する頂点を反時計回り (CCW) または順序付きで返却
 */

function computeConvexHull2D(points: Point2D[]): Point2D[] {
  if (!Array.isArray(points)) {
    throw new Error("入力は配列である必要があります");
  }
  if (points.some((p) => typeof p.u !== "number" || typeof p.v !== "number")) {
    throw new Error("すべての点は有効な座標値を持つ必要があります");
  }
  if (points.length < 3) return points;

  // 点をx座標でソート（x座標が同じ場合はy座標で）
  const sortedPoints = [...points].sort((a, b) => {
    if (a.u !== b.u) return a.u - b.u;
    return a.v - b.v;
  });

  // 下側の凸包を構築
  const lowerHull: Point2D[] = [];
  for (const point of sortedPoints) {
    while (
      lowerHull.length >= 2 &&
      !isCounterClockwise(
        lowerHull[lowerHull.length - 2],
        lowerHull[lowerHull.length - 1],
        point
      )
    ) {
      lowerHull.pop();
    }
    lowerHull.push(point);
  }

  // 上側の凸包を構築
  const upperHull: Point2D[] = [];
  for (let i = sortedPoints.length - 1; i >= 0; i--) {
    const point = sortedPoints[i];
    while (
      upperHull.length >= 2 &&
      !isCounterClockwise(
        upperHull[upperHull.length - 2],
        upperHull[upperHull.length - 1],
        point
      )
    ) {
      upperHull.pop();
    }
    upperHull.push(point);
  }

  // 重複を避けるため、最初と最後の点を除いて結合
  return [...lowerHull.slice(0, -1), ...upperHull.slice(0, -1)];
}

/**
 * 3点が反時計回り(CCW)かどうかを判定
 * 外積の符号で判定（正なら反時計回り）
 */
function isCounterClockwise(p1: Point2D, p2: Point2D, p3: Point2D): boolean {
  return (p2.u - p1.u) * (p3.v - p1.v) - (p2.v - p1.v) * (p3.u - p1.u) > 0;
}

export default computeConvexHull2D;

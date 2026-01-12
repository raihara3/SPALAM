// types
import { Feature } from "../types";

/**
 * 空間的平滑化：指定された座標周辺の深度値の平均を計算
 * @param {Float32Array} depthMap - 深度マップ
 * @param {number} centerX - 中心のX座標
 * @param {number} centerY - 中心のY座標
 * @param {number} mapWidth - 深度マップの幅
 * @param {number} mapHeight - 深度マップの高さ
 * @param {number} radius - 平滑化半径（デフォルト: 5, ((radius*2)+1)二乗px）
 * @returns {number} 平滑化された深度値
 */
function getSpatiallySmoothedDepth(
  depthMap: Float32Array<ArrayBufferLike>,
  centerX: number,
  centerY: number,
  mapWidth: number,
  mapHeight: number,
  radius: number = 5
): number {
  let depthSum = 0;
  let validCount = 0;

  // 指定された半径内の全ピクセルをチェック
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = centerX + dx;
      const y = centerY + dy;

      // 境界チェック
      if (x >= 0 && x < mapWidth && y >= 0 && y < mapHeight) {
        const depthIndex = y * mapWidth + x;
        const depth = depthMap[depthIndex];

        // 有効な深度値のみ累積
        if (depth && depth > 0) {
          depthSum += depth;
          validCount++;
        }
      }
    }
  }

  // 有効な深度値がある場合は平均を返す、ない場合は0を返す
  return validCount > 0 ? depthSum / validCount : 0;
}

/**
 * @param {Array<{ x: number, y: number }>} featurePoints  - 画像上の特徴点リスト（ピクセル座標、元の解像度）
 * @param {Float32Array<ArrayBufferLike>} depthMap         - depth-estimation の出力深度マップ（一次元配列、行優先）
 * @param {number} mapWidth                                - depthMap の横幅（ピクセル数）
 * @param {number} mapHeight                               - depthMap の縦幅（ピクセル数）
 * @param {number} featureWidth                            - 特徴点座標系の幅（省略時はmapWidth）
 * @param {number} featureHeight                           - 特徴点座標系の高さ（省略時はmapHeight）
 * @returns {Array<{ x: number, y: number, z: number, id: string }>}   - 各特徴点に対応する 3D 点群
 */
function sampleDepthAtFeaturePoints({
  featurePoints,
  depthMap,
  mapWidth,
  mapHeight,
  featureWidth,
  featureHeight,
}: {
  featurePoints: Feature[];
  depthMap: Float32Array<ArrayBufferLike> | null;
  mapWidth: number;
  mapHeight: number;
  featureWidth?: number;
  featureHeight?: number;
}): Array<{ x: number; y: number; z: number; id: string }> {
  // Use provided feature dimensions or fall back to map dimensions
  const srcWidth = featureWidth || mapWidth;
  const srcHeight = featureHeight || mapHeight;
  const points3D = [];

  // 深度マップが利用できない場合のフォールバック
  if (!depthMap) {
    console.warn("Depth map not available, using fallback depth estimation");
    for (const point of featurePoints) {
      // 画面中央からの距離に基づく簡易深度推定
      const centerX = srcWidth / 2;
      const centerY = srcHeight / 2;
      const distanceFromCenter = Math.sqrt(
        Math.pow(point.x - centerX, 2) + Math.pow(point.y - centerY, 2)
      );

      // 距離に基づく簡易深度値の改善版
      // より現実的な深度分布を作成（中央が近く、周辺が遠い）
      const normalizedDistance =
        distanceFromCenter / Math.max(centerX, centerY);
      const fallbackDepth = 1.5 + Math.pow(normalizedDistance, 1.5) * 1.5; // 1.5-3.0の範囲

      points3D.push({
        x: point.x,
        y: point.y,
        z: fallbackDepth,
        id: point.id,
      });
    }
    return points3D;
  }

  for (const point of featurePoints) {
    // 特徴点の座標を深度マップのサイズに合わせてスケーリング
    // srcWidth/Height: 特徴点座標系のサイズ（元の解像度）
    // mapWidth/Height: 深度マップのサイズ（スケール後の解像度）
    const scaledX = Math.floor((point.x * mapWidth) / srcWidth);
    const scaledY = Math.floor((point.y * mapHeight) / srcHeight);

    // 深度マップの範囲内かチェック
    if (
      scaledX >= 0 &&
      scaledX < mapWidth &&
      scaledY >= 0 &&
      scaledY < mapHeight
    ) {
      // 空間的平滑化：周辺領域の平均深度を取得
      const smoothedDepth = getSpatiallySmoothedDepth(
        depthMap,
        scaledX,
        scaledY,
        mapWidth,
        mapHeight
      );

      // 有効な深度値の場合のみ追加
      if (smoothedDepth && smoothedDepth > 0) {
        points3D.push({
          x: point.x,
          y: point.y,
          z: smoothedDepth,
          id: point.id,
        });
      }
    }
  }

  return points3D;
}

export default sampleDepthAtFeaturePoints;

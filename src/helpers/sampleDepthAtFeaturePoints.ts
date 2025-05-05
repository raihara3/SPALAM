// types
import { Feature } from "../types";

/**
 * @param {Array<{ x: number, y: number }>} featurePoints  - 画像上の特徴点リスト（ピクセル座標）
 * @param {Float32Array<ArrayBufferLike>} depthMap         - depth-estimation の出力深度マップ（一次元配列、行優先）
 * @param {number} mapWidth                                - depthMap の横幅（ピクセル数）
 * @param {number} mapHeight                               - depthMap の縦幅（ピクセル数）
 * @returns {Array<{ x: number, y: number, z: number, id: string }>}   - 各特徴点に対応する 3D 点群
 */
function sampleDepthAtFeaturePoints({
  featurePoints,
  depthMap,
  mapWidth,
  mapHeight,
}: {
  featurePoints: Feature[];
  depthMap: Float32Array<ArrayBufferLike>;
  mapWidth: number;
  mapHeight: number;
}): Array<{ x: number; y: number; z: number; id: string }> {
  const points3D = [];

  for (const point of featurePoints) {
    // 特徴点の座標を深度マップのサイズに合わせてスケーリング
    const scaledX = Math.floor((point.x * mapWidth) / window.innerWidth);
    const scaledY = Math.floor((point.y * mapHeight) / window.innerHeight);

    // 深度マップの範囲内かチェック
    if (
      scaledX >= 0 &&
      scaledX < mapWidth &&
      scaledY >= 0 &&
      scaledY < mapHeight
    ) {
      // 深度マップから深度値を取得（行優先の一次元配列）
      const depthIndex = scaledY * mapWidth + scaledX;
      const depth = depthMap[depthIndex];

      // 有効な深度値の場合のみ追加
      if (depth && depth > 0) {
        points3D.push({
          x: point.x,
          y: point.y,
          z: depth,
          id: point.id,
        });
      }
    }
  }

  return points3D;
}

export default sampleDepthAtFeaturePoints;

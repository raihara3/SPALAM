// types
import { Point3D } from "../types";

/**
 * @param {Array<Point3D>} points
 *   - { x, y }: 画像上のピクセル座標
 *   - z       : 深度マップから取得した距離値
 * @returns {Array<Point3D>}
 *   - カメラ座標系での3D点群
 */
function backProjectPoints(points: Array<Point3D>) {
  const Fx = 2584; //カメラの焦点距離
  const Fy = 4563; //カメラの焦点距離
  const Cx = 1057; //カメラの光学中心
  const Cy = 1663; //カメラの光学中心

  const points3D: Array<Point3D> = [];

  // 各点について逆投影を実行
  for (const point of points) {
    // カメラの内部パラメータを使用して3D座標に変換
    // Z = depth (そのまま使用)
    const z = point.z;
    // X = (x - Cx) * Z / Fx
    const x = ((point.x - Cx) * z) / Fx;
    // Y = (y - Cy) * Z / Fy
    const y = ((point.y - Cy) * z) / Fy;

    points3D.push({ x, y, z });
  }
  return points3D;
}

export default backProjectPoints;

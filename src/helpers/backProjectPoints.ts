/**
 * @param {Array<{ x: number, y: number, z: number }>} points
 *   - { x, y }: 画像上のピクセル座標
 *   - z       : 深度マップから取得した距離値
 * @returns {Array<{ X: number, Y: number, Z: number }>}
 *   - カメラ座標系での3D点群
 */
function backProjectPoints(points: Array<{ x: number; y: number; z: number }>) {
  const Fx = 2584; //カメラの焦点距離
  const Fy = 4563; //カメラの焦点距離
  const Cx = 1057; //カメラの光学中心
  const Cy = 1663; //カメラの光学中心

  const points3D: Array<{ X: number; Y: number; Z: number }> = [];

  // 各点について逆投影を実行
  for (const point of points) {
    // カメラの内部パラメータを使用して3D座標に変換
    // Z = depth (そのまま使用)
    const Z = point.z;
    // X = (x - Cx) * Z / Fx
    const X = ((point.x - Cx) * Z) / Fx;
    // Y = (y - Cy) * Z / Fy
    const Y = ((point.y - Cy) * Z) / Fy;

    points3D.push({ X, Y, Z });
  }
  return points3D;
}

export default backProjectPoints;

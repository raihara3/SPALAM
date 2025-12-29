import { Point3D } from "../types";
import { CameraIntrinsicsConfig } from "../config/types";

/**
 * カメラ内部パラメータを計算
 */
export interface CameraIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

/**
 * FoVと画像サイズから焦点距離を計算
 * f = (width / 2) / tan(hfov / 2)
 */
function calculateFocalLengthFromFov(
  horizontalFovDegrees: number,
  imageWidth: number
): number {
  const halfFovRadians = ((horizontalFovDegrees / 2) * Math.PI) / 180;
  return imageWidth / 2 / Math.tan(halfFovRadians);
}

/**
 * カメラ内部パラメータを取得
 */
export function getCameraIntrinsics(
  config: CameraIntrinsicsConfig,
  imageWidth: number,
  imageHeight: number
): CameraIntrinsics {
  const fx =
    config.focalLengthPixels !== null
      ? config.focalLengthPixels
      : calculateFocalLengthFromFov(config.horizontalFov, imageWidth);

  const fy = fx;

  const cx = imageWidth / 2 + config.principalPointOffset.x * imageWidth;
  const cy = imageHeight / 2 + config.principalPointOffset.y * imageHeight;

  return { fx, fy, cx, cy };
}

export interface BackProjectParams {
  points: Point3D[];
  intrinsics: CameraIntrinsics;
}

/**
 * 2D特徴点と深度から3Dカメラ座標系に逆投影
 *
 * @param params.points - { x, y }: 画像上のピクセル座標, z: 深度値
 * @param params.intrinsics - カメラ内部パラメータ
 * @returns カメラ座標系での3D点群
 */
function backProjectPoints(params: BackProjectParams): Point3D[] {
  const { points, intrinsics } = params;
  const { fx, fy, cx, cy } = intrinsics;

  const points3D: Point3D[] = [];

  for (const point of points) {
    const z = point.z;
    const x = ((point.x - cx) * z) / fx;
    // 画像座標系(Y下向き)からThree.js座標系(Y上向き)への変換
    const y = -((point.y - cy) * z) / fy;

    points3D.push({ x, y, z, id: point.id });
  }

  return points3D;
}

export default backProjectPoints;

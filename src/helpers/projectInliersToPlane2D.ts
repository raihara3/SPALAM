// lib
import * as THREE from "three";

// types
import { Point3D } from "../types";

/**
 * @param {Array<THREE.Vector3>} inliers   - 平面上と判定された 3D 点群
 * @param {THREE.Vector3} P0               - 平面上の原点
 * @param {THREE.Vector3} u                - 平面上の第一基底ベクトル (単位長)
 * @param {THREE.Vector3} v                - 平面上の第二基底ベクトル (単位長)
 * @returns {Array<{ u: number, v: number }>}
 *   - inlier 各点の平面局所座標
 */
function projectInliersToPlane2D({
  inliers,
  P0,
  u,
  v,
}: {
  inliers: Point3D[];
  P0: Point3D;
  u: THREE.Vector3;
  v: THREE.Vector3;
}) {
  return inliers.map((point3D) => {
    // 1) 平面原点からの相対位置ベクトル
    const rel = new THREE.Vector3().subVectors(point3D, P0);
    // 2) 基底 u, v との内積で (u_i, v_i) を得る
    const ui = rel.dot(u);
    const vi = rel.dot(v);
    return { u: ui, v: vi };
  });
}

export default projectInliersToPlane2D;

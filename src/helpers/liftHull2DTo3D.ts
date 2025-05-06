// types
import { Point2D, Point3D } from "../types";
import * as THREE from "three";

interface LiftHull2DTo3DParams {
  hull2D: Point2D[];
  P0: Point3D;
  uVec: THREE.Vector3;
  vVec: THREE.Vector3;
}

function liftHull2DTo3D({
  hull2D,
  P0,
  uVec,
  vVec,
}: LiftHull2DTo3DParams): Point3D[] {
  if (!Array.isArray(hull2D)) {
    throw new Error("hull2Dは配列である必要があります");
  }
  if (!P0 || !uVec || !vVec) {
    throw new Error("P0, uVec, vVecは必須パラメータです");
  }

  // 各2D点について3D空間への写像を実行
  return hull2D.map((point2D) => {
    // P = P0 + u*uVec + v*vVec の式で3D点を計算
    return {
      x: P0.x + point2D.u * uVec.x + point2D.v * vVec.x,
      y: P0.y + point2D.u * uVec.y + point2D.v * vVec.y,
      z: P0.z + point2D.u * uVec.z + point2D.v * vVec.z,
    };
  });
}

export default liftHull2DTo3D;

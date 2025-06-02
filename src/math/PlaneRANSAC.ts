import * as THREE from "three";
import { Point3D, PlaneModel } from "../types/core";
import { RANSACConfig, PlaneModelFitter } from "../types/geometry";
import { RANSAC } from "./RANSAC";

export class PlaneModelFitterImpl implements PlaneModelFitter {
  fit(points: Point3D[]): PlaneModel | null {
    if (points.length < 3) return null;

    const p1 = new THREE.Vector3(points[0].x, points[0].y, points[0].z);
    const p2 = new THREE.Vector3(points[1].x, points[1].y, points[1].z);
    const p3 = new THREE.Vector3(points[2].x, points[2].y, points[2].z);

    const v1 = new THREE.Vector3().subVectors(p2, p1);
    const v2 = new THREE.Vector3().subVectors(p3, p1);
    const normal = new THREE.Vector3().crossVectors(v1, v2).normalize();

    if (normal.lengthSq() === 0) return null;

    const d = -normal.dot(p1);

    return {
      a: normal.x,
      b: normal.y,
      c: normal.z,
      d: d,
    };
  }

  score(model: PlaneModel, points: Point3D[]): number {
    if (points.length === 0) return 0;
    
    let totalDistance = 0;
    for (const point of points) {
      const distance = this.distancePointToPlane(point, model);
      totalDistance += 1 / (1 + distance); // Inverse distance scoring
    }
    
    return totalDistance / points.length;
  }

  isInlier(model: PlaneModel, point: Point3D, threshold: number): boolean {
    const distance = this.distancePointToPlane(point, model);
    return distance <= threshold;
  }

  private distancePointToPlane(point: Point3D, plane: PlaneModel): number {
    const { a, b, c, d } = plane;
    const numerator = Math.abs(a * point.x + b * point.y + c * point.z + d);
    const denominator = Math.sqrt(a * a + b * b + c * c);
    return denominator === 0 ? 0 : numerator / denominator;
  }
}

export class PlaneRANSAC extends RANSAC<PlaneModel, Point3D> {
  constructor(config: RANSACConfig) {
    super(new PlaneModelFitterImpl(), config);
  }
}

export function filterByDepth(points: Point3D[], threshold: number): Point3D[] {
  if (points.length === 0) return [];
  
  const depths = points.map(p => p.z);
  const meanDepth = depths.reduce((sum, d) => sum + d, 0) / depths.length;
  
  return points.filter(p => Math.abs(p.z - meanDepth) <= threshold);
}

export function distancePointToPlane(point: Point3D, plane: PlaneModel): number {
  const { a, b, c, d } = plane;
  const numerator = Math.abs(a * point.x + b * point.y + c * point.z + d);
  const denominator = Math.sqrt(a * a + b * b + c * c);
  return denominator === 0 ? 0 : numerator / denominator;
}
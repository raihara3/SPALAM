import * as THREE from "three";
import { Point2D, Point3D, PlaneModel } from "../types/core";
import { PlaneProjectionParams, WeightedPoint } from "../types/geometry";

export class PlaneGeometry {
  static computeFromThreePoints(p1: Point3D, p2: Point3D, p3: Point3D): PlaneModel {
    const v1 = new THREE.Vector3(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
    const v2 = new THREE.Vector3(p3.x - p1.x, p3.y - p1.y, p3.z - p1.z);
    const normal = new THREE.Vector3().crossVectors(v1, v2).normalize();
    
    const d = -(normal.x * p1.x + normal.y * p1.y + normal.z * p1.z);
    
    return {
      a: normal.x,
      b: normal.y,
      c: normal.z,
      d: d,
    };
  }

  static distancePointToPlane(point: Point3D, plane: PlaneModel): number {
    const { a, b, c, d } = plane;
    const numerator = Math.abs(a * point.x + b * point.y + c * point.z + d);
    const denominator = Math.sqrt(a * a + b * b + c * c);
    return denominator === 0 ? 0 : numerator / denominator;
  }

  static projectPointsToPlane(
    points: Point3D[],
    params: PlaneProjectionParams
  ): Point2D[] {
    const { P0, uVec, vVec } = params;
    
    return points.map(point => {
      const vector = new THREE.Vector3(
        point.x - P0.x,
        point.y - P0.y,
        point.z - P0.z
      );
      
      return {
        u: vector.dot(uVec),
        v: vector.dot(vVec),
      };
    });
  }

  static computeConvexHull2D(points: Point2D[]): Point2D[] {
    if (points.length <= 3) return points;

    // Graham scan algorithm
    const sortedPoints = points.sort((a, b) => {
      if (a.u === b.u) return a.v - b.v;
      return a.u - b.u;
    });

    const cross = (o: Point2D, a: Point2D, b: Point2D): number => {
      return (a.u - o.u) * (b.v - o.v) - (a.v - o.v) * (b.u - o.u);
    };

    // Build lower hull
    const lower: Point2D[] = [];
    for (let i = 0; i < sortedPoints.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], sortedPoints[i]) <= 0) {
        lower.pop();
      }
      lower.push(sortedPoints[i]);
    }

    // Build upper hull
    const upper: Point2D[] = [];
    for (let i = sortedPoints.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], sortedPoints[i]) <= 0) {
        upper.pop();
      }
      upper.push(sortedPoints[i]);
    }

    // Remove last point of each half because it's repeated
    lower.pop();
    upper.pop();

    return lower.concat(upper);
  }

  static liftHull2DTo3D(
    hull2D: Point2D[],
    params: PlaneProjectionParams
  ): Point3D[] {
    const { P0, uVec, vVec } = params;
    
    return hull2D.map(point => {
      const worldPoint = new THREE.Vector3(P0.x, P0.y, P0.z)
        .add(uVec.clone().multiplyScalar(point.u))
        .add(vVec.clone().multiplyScalar(point.v));
      
      return {
        x: worldPoint.x,
        y: worldPoint.y,
        z: worldPoint.z,
      };
    });
  }

  static weightedPlaneFit2D(points: Point3D[], weights: number[]): { a: number; b: number; c: number } {
    if (points.length !== weights.length || points.length === 0) {
      return { a: 0, b: 0, c: -1 };
    }

    const weightedPoints: WeightedPoint[] = points.map((point, i) => ({
      ...point,
      weight: weights[i],
    }));

    // Weighted least squares fitting for plane z = ax + by + c
    let sumW = 0, sumWx = 0, sumWy = 0, sumWz = 0;
    let sumWxx = 0, sumWxy = 0, sumWyy = 0, sumWxz = 0, sumWyz = 0;

    for (const wp of weightedPoints) {
      const w = wp.weight;
      sumW += w;
      sumWx += w * wp.x;
      sumWy += w * wp.y;
      sumWz += w * wp.z;
      sumWxx += w * wp.x * wp.x;
      sumWxy += w * wp.x * wp.y;
      sumWyy += w * wp.y * wp.y;
      sumWxz += w * wp.x * wp.z;
      sumWyz += w * wp.y * wp.z;
    }

    const det = sumW * sumWxx * sumWyy + 2 * sumWx * sumWy * sumWxy 
                - sumW * sumWxy * sumWxy - sumWxx * sumWy * sumWy - sumWyy * sumWx * sumWx;

    if (Math.abs(det) < 1e-10) {
      return { a: 0, b: 0, c: -1 };
    }

    const a = (sumWxz * (sumW * sumWyy - sumWy * sumWy) + sumWyz * (sumWx * sumWy - sumW * sumWxy) + sumWz * (sumWxy * sumWy - sumWyy * sumWx)) / det;
    const b = (sumWyz * (sumW * sumWxx - sumWx * sumWx) + sumWxz * (sumWx * sumWy - sumW * sumWxy) + sumWz * (sumWxy * sumWx - sumWxx * sumWy)) / det;
    const c = (sumWz * (sumWxx * sumWyy - sumWxy * sumWxy) + sumWxz * (sumWxy * sumWy - sumWyy * sumWx) + sumWyz * (sumWxy * sumWx - sumWxx * sumWy)) / det;

    return { a, b, c };
  }
}
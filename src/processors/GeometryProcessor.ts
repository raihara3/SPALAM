import * as THREE from "three";
import { EventEmitter } from "../utils/EventEmitter";
import { Point3D, Feature, PlaneEstimationResult } from "../types/core";
import { PlaneEstimationConfig } from "../types/configuration";
import { PlaneRANSAC, filterByDepth, distancePointToPlane } from "../math/PlaneRANSAC";
import { PlaneGeometry } from "../geometry/PlaneGeometry";
import { CoordinateTransforms } from "../geometry/CoordinateTransforms";

export class GeometryProcessor extends EventEmitter {
  private config: PlaneEstimationConfig;
  private ransac: PlaneRANSAC;

  constructor(config: PlaneEstimationConfig) {
    super();
    this.config = config;
    this.ransac = new PlaneRANSAC(config.ransac);
  }

  estimatePlane(
    points3D: Point3D[], 
    centerFeature: Feature | null, 
    trackedFeatures: Feature[], 
    depthMap: Float32Array,
    mapSize: { width: number; height: number }
  ): PlaneEstimationResult | null {
    try {
      console.log("Starting plane estimation with", points3D.length, "points");
      
      // Filter points by depth
      const filteredPoints = filterByDepth(points3D, this.config.depthFilterThreshold);
      console.log("After depth filtering:", filteredPoints.length, "points");
      
      if (filteredPoints.length < this.config.ransac.minInliers) {
        console.log("Not enough points after filtering:", filteredPoints.length, "< required:", this.config.ransac.minInliers);
        return null;
      }

      // Apply coordinate transformation (back-projection)
      const backProjectedPoints = CoordinateTransforms.backProjectPoints(filteredPoints);

      // Fit plane using RANSAC
      const ransacResult = this.ransac.fit(backProjectedPoints);
      console.log("RANSAC result:", {
        hasModel: !!ransacResult.model,
        inliers: ransacResult.inliers.length,
        outliers: ransacResult.outliers.length,
        score: ransacResult.score,
        iterations: ransacResult.iterations
      });
      
      if (!ransacResult.model) {
        console.log("RANSAC failed to find a plane model");
        return null;
      }

      // Refine plane with weighted fitting
      const refinedPlane = this.refineWithWeighting(
        ransacResult.inliers,
        trackedFeatures,
        depthMap,
        mapSize,
        ransacResult.model
      );

      // Compute convex hull
      const convexHull = this.computeConvexHull(
        ransacResult.inliers,
        centerFeature,
        refinedPlane
      );

      if (!convexHull) {
        return null;
      }

      const result: PlaneEstimationResult = {
        plane: refinedPlane,
        hull2D: convexHull.hull2D,
        hull3D: convexHull.hull3D,
        confidence: this.calculateConfidence(ransacResult),
        P0: convexHull.P0,
        uVec: convexHull.uVec,
        vVec: convexHull.vVec,
        normal: convexHull.normal,
      };

      this.emit("planeEstimated", result);
      return result;
    } catch (error) {
      this.emit("error", error);
      return null;
    }
  }

  private refineWithWeighting(
    inliers: Point3D[],
    trackedFeatures: Feature[],
    depthMap: Float32Array,
    mapSize: { width: number; height: number },
    initialPlane: any
  ): any {
    const weights = inliers.map((pt, i) => {
      // Reprojection error weight
      const distance = distancePointToPlane(pt, initialPlane);
      const reprojWeight = Math.exp(-Math.pow(distance / this.config.weightedFitting.reprojectionSigma, 2));

      // Depth gradient weight
      let gradientWeight = 1;
      if (this.config.weightedFitting.enableGradientWeight) {
        gradientWeight = this.computeDepthGradientWeight(pt, depthMap, mapSize);
      }

      // Tracking stability weight
      const trackingWeight = this.computeTrackingWeight(pt, trackedFeatures);

      const finalWeight = Math.max(
        reprojWeight * gradientWeight * trackingWeight,
        this.config.weightedFitting.minWeight
      );

      return isNaN(finalWeight) ? this.config.weightedFitting.minWeight : finalWeight;
    });

    const { a, b, c } = PlaneGeometry.weightedPlaneFit2D(inliers, weights);

    // Validate results
    const isValidNumber = (n: number) => !isNaN(n) && isFinite(n);
    return {
      a: isValidNumber(a) ? a : 0,
      b: isValidNumber(b) ? b : 0,
      c: -1,
      d: isValidNumber(c) ? c : -1,
    };
  }

  private computeDepthGradientWeight(
    point: Point3D,
    depthMap: Float32Array,
    mapSize: { width: number; height: number }
  ): number {
    const x = Math.round(Math.min(Math.max(point.x, 0), mapSize.width - 1));
    const y = Math.round(Math.min(Math.max(point.y, 0), mapSize.height - 1));

    const gx = x > 0 && x < mapSize.width - 1
      ? Math.abs(depthMap[y * mapSize.width + (x + 1)] - depthMap[y * mapSize.width + (x - 1)])
      : 0;

    const gy = y > 0 && y < mapSize.height - 1
      ? Math.abs(depthMap[(y + 1) * mapSize.width + x] - depthMap[(y - 1) * mapSize.width + x])
      : 0;

    return 1 / (1 + (gx + gy));
  }

  private computeTrackingWeight(point: Point3D, trackedFeatures: Feature[]): number {
    const matchingFeature = trackedFeatures.find(f => f.id === point.id);
    if (!matchingFeature) return this.config.weightedFitting.minWeight;

    const trackCount = matchingFeature.trackingCount;
    return Math.min(trackCount / this.config.weightedFitting.trackingFrameWeight, 1);
  }

  private computeConvexHull(
    inliers: Point3D[],
    centerFeature: Feature | null,
    plane: any
  ): {
    hull2D: any[];
    hull3D: Point3D[];
    P0: Point3D;
    uVec: THREE.Vector3;
    vVec: THREE.Vector3;
    normal: THREE.Vector3;
  } | null {
    if (!centerFeature) return null;

    // Find center point
    const centerPoint = inliers.find(p => p.id === centerFeature.id);
    if (!centerPoint) return null;

    // Create orthonormal basis for the plane
    const normal = new THREE.Vector3(plane.a, plane.b, plane.c).normalize();
    if (normal.lengthSq() === 0) {
      normal.set(0, 0, 1);
    }

    // Create reference vector for u-axis
    let reference = new THREE.Vector3(0, 1, 0);
    if (Math.abs(normal.dot(reference)) > 0.9) {
      reference.set(1, 0, 0);
    }

    const uVec = new THREE.Vector3().crossVectors(normal, reference).normalize();
    const vVec = new THREE.Vector3().crossVectors(normal, uVec).normalize();

    // Project points to 2D plane coordinates
    const projectedPoints2D = PlaneGeometry.projectPointsToPlane(inliers, {
      P0: centerPoint,
      uVec,
      vVec,
      normal,
    });

    // Compute 2D convex hull
    const hull2D = PlaneGeometry.computeConvexHull2D(projectedPoints2D);

    // Lift hull back to 3D
    const hull3D = PlaneGeometry.liftHull2DTo3D(hull2D, {
      P0: centerPoint,
      uVec,
      vVec,
      normal,
    });

    return {
      hull2D,
      hull3D,
      P0: centerPoint,
      uVec,
      vVec,
      normal: reference, // Use reference vector as stored normal
    };
  }

  private calculateConfidence(ransacResult: any): number {
    const totalPoints = ransacResult.inliers.length + ransacResult.outliers.length;
    if (totalPoints === 0) return 0;

    const inlierRatio = ransacResult.inliers.length / totalPoints;
    const iterationRatio = Math.max(0, 1 - ransacResult.iterations / this.config.ransac.maxIterations);
    
    return (inlierRatio * 0.7 + iterationRatio * 0.3) * ransacResult.score;
  }
}
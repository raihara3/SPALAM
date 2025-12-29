import * as THREE from "three";
import { Point2D, Point3D, PlaneModel } from "../types";
import { PlaneEstimationConfig } from "../config/types";
import { defaultConfig } from "../config/defaults";
import fitPlaneRANSAC, {
  filterByDepth,
  distancePointToPlane,
} from "../helpers/fitPlaneRANSAC";
import projectInliersToPlane2D from "../helpers/projectInliersToPlane2D";
import computeConvexHull2D from "../helpers/computeConvexHull2D";
import liftHull2DTo3D from "../helpers/liftHull2DTo3D";
import { weightedPlaneFit2D } from "../helpers/weightedPlaneFit2D";
import sampleDepthAtFeaturePoints from "../helpers/sampleDepthAtFeaturePoints";
import backProjectPoints, {
  getCameraIntrinsics,
  CameraIntrinsics,
} from "../helpers/backProjectPoints";
import { Feature } from "../types";

/**
 * 平面推定結果
 */
export interface PlaneFittingResult {
  hull2D: Point2D[];
  hull3D: Point3D[];
  P0: Point3D;
  uVec: THREE.Vector3;
  vVec: THREE.Vector3;
  normal: THREE.Vector3;
}

/**
 * 平面フィッティングサービス
 * 特徴点と深度情報から平面を推定する機能を提供
 */
export class PlaneFittingService {
  private config: PlaneEstimationConfig;
  private fittingResults: PlaneFittingResult[] = [];
  private fittingCount: number = 0;
  private cachedIntrinsics: CameraIntrinsics | null = null;
  private cachedVideoSize: { width: number; height: number } | null = null;

  constructor(config?: Partial<PlaneEstimationConfig>) {
    this.config = {
      ...defaultConfig.plane,
      ...config,
    };
  }

  /**
   * 設定を更新
   */
  public updateConfig(config: Partial<PlaneEstimationConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * フィッティング結果をリセット
   */
  public reset(): void {
    this.fittingResults = [];
    this.fittingCount = 0;
  }

  /**
   * カメラ内部パラメータを取得（キャッシュ付き）
   */
  private getIntrinsics(videoWidth: number, videoHeight: number): CameraIntrinsics {
    if (
      this.cachedIntrinsics &&
      this.cachedVideoSize?.width === videoWidth &&
      this.cachedVideoSize?.height === videoHeight
    ) {
      return this.cachedIntrinsics;
    }

    this.cachedIntrinsics = getCameraIntrinsics(
      this.config.cameraIntrinsics,
      videoWidth,
      videoHeight
    );
    this.cachedVideoSize = { width: videoWidth, height: videoHeight };

    return this.cachedIntrinsics;
  }

  /**
   * 平面フィッティングを実行
   */
  public async performFitting(
    featurePoints: Feature[],
    depthMap: Float32Array | null,
    mapWidth: number,
    mapHeight: number,
    centerFeature: Feature,
    videoWidth?: number,
    videoHeight?: number
  ): Promise<PlaneFittingResult | null> {
    if (!featurePoints || featurePoints.length === 0) {
      console.warn("No feature points provided for plane fitting");
      return null;
    }

    const safeMapWidth = Math.max(mapWidth || 640, 1);
    const safeMapHeight = Math.max(mapHeight || 480, 1);

    const safeVideoWidth = videoWidth || safeMapWidth;
    const safeVideoHeight = videoHeight || safeMapHeight;

    const points3D = sampleDepthAtFeaturePoints({
      featurePoints,
      depthMap,
      mapWidth: safeMapWidth,
      mapHeight: safeMapHeight,
    });

    const intrinsics = this.getIntrinsics(safeVideoWidth, safeVideoHeight);

    const points3DBackProjected = backProjectPoints({
      points: points3D,
      intrinsics,
    });

    // 深度フィルタリング
    const filteredPoints3D = filterByDepth(
      points3DBackProjected,
      this.config.depthFilterDelta
    );

    // RANSACで平面フィッティング
    const planeModel = fitPlaneRANSAC({
      points: filteredPoints3D,
      iterations: this.config.ransacIterations,
      threshold: this.config.ransacThreshold,
    });

    if (!planeModel.model) return null;

    // 重み付き平面フィッティング
    const refinedModel = this.performWeightedFitting(
      planeModel,
      featurePoints,
      depthMap,
      safeMapWidth,
      safeMapHeight
    );

    // 平面座標系を構築
    const result = this.constructPlaneCoordinates(
      refinedModel,
      planeModel.inliers,
      points3DBackProjected,
      centerFeature
    );

    if (result && this.fittingCount < this.config.smoothingIterations) {
      this.fittingResults.push(result);
      this.fittingCount++;
    }

    return result;
  }

  /**
   * 平均化された結果を取得
   */
  public getAveragedResult(): PlaneFittingResult | null {
    if (this.fittingResults.length !== this.config.smoothingIterations) {
      return null;
    }

    return this.calculateAverageResults();
  }

  /**
   * フィッティングが完了したかチェック
   */
  public isComplete(): boolean {
    return this.fittingCount >= this.config.smoothingIterations;
  }

  /**
   * 現在の進捗を取得
   */
  public getProgress(): { current: number; total: number } {
    return {
      current: this.fittingCount,
      total: this.config.smoothingIterations,
    };
  }

  /**
   * 重み付き平面フィッティングを実行
   */
  private performWeightedFitting(
    planeModel: { model: PlaneModel | null; inliers: Point3D[] },
    trackedFeatures: Feature[],
    depthMap: Float32Array | null,
    mapWidth: number,
    mapHeight: number
  ): PlaneModel {
    const inliers = planeModel.inliers;
    const weights = this.calculateWeights(
      inliers,
      planeModel.model!,
      trackedFeatures,
      depthMap,
      mapWidth,
      mapHeight
    );

    const { a, b, c } = weightedPlaneFit2D(inliers, weights);

    // NaNチェックと異常値の補正
    const isValidNumber = (n: number) => !isNaN(n) && isFinite(n);
    const safeA = isValidNumber(a) ? a : 0;
    const safeB = isValidNumber(b) ? b : 0;
    const safeC = isValidNumber(c) ? c : -1;

    return {
      a: safeA,
      b: safeB,
      c: -1,
      d: safeC,
    };
  }

  /**
   * 重みを計算
   */
  private calculateWeights(
    inliers: Point3D[],
    planeModel: PlaneModel,
    trackedFeatures: Feature[],
    depthMap: Float32Array | null,
    mapWidth: number,
    mapHeight: number
  ): number[] {
    return inliers.map((pt, i) => {
      // 再投影誤差による重み
      const d = distancePointToPlane(pt, planeModel);
      const w_reproj = Math.exp(
        -((d / this.config.weights.reprojectionSigma) ** 2)
      );

      // 深度勾配による重み（深度マップが利用可能な場合のみ）
      let w_grad = 1.0; // デフォルト値

      if (depthMap && mapWidth > 0 && mapHeight > 0) {
        const x = Math.round(Math.min(Math.max(pt.x, 0), mapWidth - 1));
        const y = Math.round(Math.min(Math.max(pt.y, 0), mapHeight - 1));

        const gx =
          x > 0 && x < mapWidth - 1
            ? Math.abs(
                depthMap[y * mapWidth + (x + 1)] -
                  depthMap[y * mapWidth + (x - 1)]
              )
            : 0;
        const gy =
          y > 0 && y < mapHeight - 1
            ? Math.abs(
                depthMap[(y + 1) * mapWidth + x] -
                  depthMap[(y - 1) * mapWidth + x]
              )
            : 0;

        w_grad = 1 / (1 + gx + gy);
      }

      // 追跡安定性による重み
      const trackCount = trackedFeatures[i]?.trackingCount ?? 1;
      const w_track = Math.min(
        trackCount / this.config.weights.maxTrackingFrames,
        1
      );

      // 最終的な重み
      const finalWeight = Math.max(
        w_reproj * w_grad * w_track,
        this.config.weights.minWeight
      );

      return isNaN(finalWeight) ? this.config.weights.minWeight : finalWeight;
    });
  }

  /**
   * 平面座標系を構築
   */
  private constructPlaneCoordinates(
    refinedModel: PlaneModel,
    inliers: Point3D[],
    points3DBackProjected: Point3D[],
    centerFeature: Feature
  ): PlaneFittingResult | null {
    // 法線ベクトルを計算
    const n = new THREE.Vector3(
      refinedModel.a,
      refinedModel.b,
      refinedModel.c
    ).normalize();

    if (n.lengthSq() === 0) {
      n.set(0, 0, 1);
    }

    // 平面の基底ベクトルを計算
    const r = new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(n, r).normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize();

    // 中心点を見つける
    const centerPoint = points3DBackProjected.find(
      (p) => p.id === centerFeature.id
    );
    if (!centerPoint) return null;

    const P0 = centerPoint;

    // 2D投影
    const projectedPoints2D = projectInliersToPlane2D({
      inliers,
      P0,
      u,
      v,
    });

    // 凸包を計算
    const hull2D = computeConvexHull2D(projectedPoints2D);
    const hull3D = liftHull2DTo3D({
      hull2D,
      P0,
      uVec: u,
      vVec: v,
    });

    return {
      hull2D,
      hull3D,
      P0,
      uVec: u,
      vVec: v,
      normal: r,
    };
  }

  /**
   * 結果を平均化
   */
  private calculateAverageResults(): PlaneFittingResult {
    const results = this.fittingResults;

    // P0の平均
    const avgP0 = {
      x: results.reduce((sum, r) => sum + r.P0.x, 0) / results.length,
      y: results.reduce((sum, r) => sum + r.P0.y, 0) / results.length,
      z: results.reduce((sum, r) => sum + r.P0.z, 0) / results.length,
    };

    // ベクトルの平均
    const avgUVec = new THREE.Vector3(
      results.reduce((sum, r) => sum + r.uVec.x, 0) / results.length,
      results.reduce((sum, r) => sum + r.uVec.y, 0) / results.length,
      results.reduce((sum, r) => sum + r.uVec.z, 0) / results.length
    ).normalize();

    const avgVVec = new THREE.Vector3(
      results.reduce((sum, r) => sum + r.vVec.x, 0) / results.length,
      results.reduce((sum, r) => sum + r.vVec.y, 0) / results.length,
      results.reduce((sum, r) => sum + r.vVec.z, 0) / results.length
    ).normalize();

    const avgNormal = new THREE.Vector3(
      results.reduce((sum, r) => sum + r.normal.x, 0) / results.length,
      results.reduce((sum, r) => sum + r.normal.y, 0) / results.length,
      results.reduce((sum, r) => sum + r.normal.z, 0) / results.length
    ).normalize();

    // hull2Dの平均
    const baseHull2D = results[0].hull2D;
    const avgHull2D = baseHull2D.map((_, i) => ({
      u:
        results.reduce((sum, r) => sum + (r.hull2D[i]?.u || 0), 0) /
        results.length,
      v:
        results.reduce((sum, r) => sum + (r.hull2D[i]?.v || 0), 0) /
        results.length,
    }));

    // hull3Dの平均
    const baseHull3D = results[0].hull3D;
    const avgHull3D = baseHull3D.map((_, i) => ({
      x:
        results.reduce((sum, r) => sum + (r.hull3D[i]?.x || 0), 0) /
        results.length,
      y:
        results.reduce((sum, r) => sum + (r.hull3D[i]?.y || 0), 0) /
        results.length,
      z:
        results.reduce((sum, r) => sum + (r.hull3D[i]?.z || 0), 0) /
        results.length,
    }));

    return {
      hull2D: avgHull2D,
      hull3D: avgHull3D,
      P0: avgP0,
      uVec: avgUVec,
      vVec: avgVVec,
      normal: avgNormal,
    };
  }
}

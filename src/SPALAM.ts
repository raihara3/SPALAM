// lib
import * as THREE from "three";
import cv from "@techstark/opencv-js";

// types
import { Point2D, Point3D } from "./types";

// modules
import { FeatureDetector } from "./FeatureDetector";
import { DepthEstimation } from "./DepthEstimation";
import { ARRenderer } from "./ARRenderer";

// utils
import { CameraController } from "./utils/CameraController";

// helpers
import sampleDepthAtFeaturePoints from "./helpers/sampleDepthAtFeaturePoints";
import backProjectPoints from "./helpers/backProjectPoints";
import fitPlaneRANSAC, {
  filterByDepth,
  distancePointToPlane,
} from "./helpers/fitPlaneRANSAC";
import projectInliersToPlane2D from "./helpers/projectInliersToPlane2D";
import computeConvexHull2D from "./helpers/computeConvexHull2D";
import liftHull2DTo3D from "./helpers/liftHull2DTo3D";
import { weightedPlaneFit2D } from "./helpers/weightedPlaneFit2D";

class SPALAM {
  video: HTMLVideoElement | null;
  featureDetector: FeatureDetector | null = null;
  depthEstimation: DepthEstimation | null = null;
  arRenderer: ARRenderer | null = null;

  group: THREE.Group | null = null;

  constructor() {
    this.video = null;
    this.group = null;
  }

  public start({ video = null }: { video?: HTMLVideoElement | null } = {}) {
    const setup = async () => {
      if (video) {
        this.video = video;
      } else {
        const cameraController = new CameraController();
        await cameraController.initCamera();
        this.video = cameraController.getVideo();
      }
      this.video.style.display = "none";
      console.debug("Video element:", this.video);

      this.arRenderer = new ARRenderer({
        width: this.video.width,
        height: this.video.height,
      });

      this.featureDetector = new FeatureDetector({
        cv,
        video: this.video,
        showFeatures: true,
      });

      this.depthEstimation = new DepthEstimation({
        canvas: this.featureDetector!.canvas,
        context: this.featureDetector!.ctx,
        showDepth: true,
      });
      await this.depthEstimation.loadModel();

      this.render();
    };

    cv.onRuntimeInitialized = async () => {
      console.log(cv.getBuildInformation());
      await setup();
      this.setGroupPosition();
    };
  }

  /**
   * 平面ジオメトリを生成する
   */
  private createPlaneGeometries(
    hull2D: Point2D[],
    planeWidth: number,
    planeHeight: number
  ) {
    // 通常の平面ジオメトリ
    const planeGeom = new THREE.PlaneGeometry(planeWidth, planeHeight);
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x8888ff,
      side: THREE.DoubleSide,
      opacity: 0.3,
      transparent: true,
    });
    const planeMesh = new THREE.Mesh(planeGeom, planeMat);

    // 凸包形状の平面ジオメトリ
    const shape = new THREE.Shape(
      hull2D.map((p) => new THREE.Vector2(p.u, p.v))
    );
    const shapeGeom = new THREE.ShapeGeometry(shape);
    const shapeMat = new THREE.MeshBasicMaterial({
      color: 0x44ff44,
      side: THREE.DoubleSide,
      opacity: 0.5,
      transparent: true,
    });
    const shapeMesh = new THREE.Mesh(shapeGeom, shapeMat);

    return { planeMesh, shapeMesh };
  }

  /**
   * メッシュの位置と回転を調整する
   */
  private adjustMeshTransform(
    group: THREE.Group,
    P0: Point3D, // in camera-space
    centerCS: THREE.Vector3, // in camera-space
    uVecCS: THREE.Vector3, // in camera-space
    vVecCS: THREE.Vector3, // in camera-space
    normalCS: THREE.Vector3, // in camera-space
    midU: number,
    midV: number,
    useCenter: boolean = false
  ) {
    const camera = this.arRenderer!.getCamera();

    // 1) カメラ空間の平面中心を求める
    const planeCenterCS = new THREE.Vector3()
      .copy(P0)
      .add(uVecCS.clone().multiplyScalar(midU))
      .add(vVecCS.clone().multiplyScalar(midV));

    // 2) カメラ空間→ワールド空間に変換
    const copyCamera = camera.clone();
    copyCamera.position.z = 0; // カメラの位置を原点に
    const planeCenterWS = copyCamera.localToWorld(planeCenterCS.clone());
    const centerWS = copyCamera.localToWorld(centerCS.clone());

    // 3) ワールド空間の位置をセット
    group.position.copy(useCenter ? centerWS : planeCenterWS);

    // 4) 各基底ベクトルもワールド空間に変換
    const worldU = uVecCS
      .clone()
      .normalize()
      .applyQuaternion(copyCamera.quaternion);
    const worldV = vVecCS
      .clone()
      .normalize()
      .applyQuaternion(copyCamera.quaternion);
    const worldN = normalCS
      .clone()
      .normalize()
      .applyQuaternion(copyCamera.quaternion);

    // 5) 直交基底から回転行列を作成
    const basis = new THREE.Matrix4().makeBasis(worldU, worldV, worldN);

    // 6) x軸にプラス90度回転を追加
    const rotationX = new THREE.Matrix4().makeRotationX(
      THREE.MathUtils.degToRad(90)
    );
    basis.multiply(rotationX);

    // 7) メッシュに回転を適用
    group.setRotationFromMatrix(basis);
  }

  /**
   * 平面の生成と配置
   */
  public async setGroupPosition() {
    const { hull2D, hull3D, P0, uVec, vVec, normal } = await this.getPoints3D();
    if (!hull3D) return;

    // 中心点の計算
    const center = new THREE.Vector3();
    hull3D.forEach((p) => center.add(p));
    center.divideScalar(hull3D.length);

    // バウンディングボックスの計算
    const us = hull2D.map((p) => p.u),
      vs = hull2D.map((p) => p.v);
    const minU = Math.min(...us),
      maxU = Math.max(...us);
    const minV = Math.min(...vs),
      maxV = Math.max(...vs);
    const planeWidth = maxU - minU;
    const planeHeight = maxV - minV;
    const midU = (minU + maxU) / 2;
    const midV = (minV + maxV) / 2;

    // ジオメトリの生成
    if (!this.group) {
      const scene = this.arRenderer!.getScene();
      this.group = new THREE.Group();
      const { planeMesh, shapeMesh } = this.createPlaneGeometries(
        hull2D,
        planeWidth,
        planeHeight
      );
      this.group.add(planeMesh);
      scene.add(this.group);
    }

    // 位置と回転の調整
    this.adjustMeshTransform(
      this.group,
      P0,
      center,
      uVec,
      vVec,
      normal,
      midU,
      midV,
      true
    );
    console.log(this.group.position);
    this.arRenderer?.setCameraPosition(0, 0, this.group.position.z * 2);
    console.log(this.arRenderer?.getCamera().position);
    // this.adjustMeshTransform(
    //   shapeMesh,
    //   P0,
    //   center,
    //   uVec,
    //   vVec,
    //   normal,
    //   midU,
    //   midV,
    //   false
    // );

    // this.group.add(planeMesh);
    // scene.add(shapeMesh);
  }

  private async getPoints3D() {
    if (!this.depthEstimation || !this.featureDetector) return {};

    // 中心特徴点が設定されていない場合は処理を中断
    if (!this.featureDetector.centerFeature) return {};

    // 検出済みの特徴点と深度マップを使い、各特徴点の3D座標を計算
    const depthMap = await this.depthEstimation.getDepthMap();
    if (!depthMap) return {};
    const points3D = sampleDepthAtFeaturePoints({
      featurePoints: this.featureDetector!.getTrackedFeaturePoints(),
      depthMap: depthMap,
      mapWidth: this.featureDetector!.canvas.width,
      mapHeight: this.featureDetector!.canvas.height,
    });

    // 特徴点の3D座標からカメラ座標を復元
    const points3DBackProjected = backProjectPoints(points3D);
    // 外れ値やノイズを除去
    let filterdPoints3D = filterByDepth(points3DBackProjected, 0.025);

    // 平面モデルをRANSACでフィッティング
    const planeModel = fitPlaneRANSAC({
      points: filterdPoints3D,
    });
    if (!planeModel.model) return {};

    const inliers = planeModel.inliers; // [{X,Y,Z},…]
    const tracked = this.featureDetector.trackedFeatures; // [{x,y,trackingCount},…]
    const mapW = this.featureDetector.canvas.width,
      mapH = this.featureDetector.canvas.height;

    const weights = inliers.map((pt, i) => {
      // reprojection error weight（平面からの距離による重み）
      if (!planeModel.model) return 0;
      const d = distancePointToPlane(pt, planeModel.model);
      // シグマ値を調整（0.05が小さすぎる可能性）
      const w_reproj = Math.exp((-d / 0.5) ** 2); // 0.05 → 0.5 に変更

      // depth gradient weight（深度の勾配による重み）
      const x = Math.round(Math.min(Math.max(pt.x, 0), mapW - 1)); // 境界チェック追加
      const y = Math.round(Math.min(Math.max(pt.y, 0), mapH - 1));

      // 深度の勾配計算を安全に
      const gx =
        x > 0 && x < mapW - 1
          ? Math.abs(
              depthMap[y * mapW + (x + 1)] - depthMap[y * mapW + (x - 1)]
            )
          : 0;
      const gy =
        y > 0 && y < mapH - 1
          ? Math.abs(
              depthMap[(y + 1) * mapW + x] - depthMap[(y - 1) * mapW + x]
            )
          : 0;

      // 勾配の重みのスケールを調整
      const w_grad = 1 / (1 + (gx + gy)); // * 10 を削除

      // tracking stability weight（追跡安定性による重み）
      const trackCount = tracked[i]?.trackingCount ?? 1;
      const w_track = Math.min(trackCount / 5, 1); // 10 → 5 に変更

      // 各重みの下限を設定
      const minWeight = 0.1;
      const finalWeight = Math.max(w_reproj * w_grad * w_track, minWeight);

      // NaNチェック
      return isNaN(finalWeight) ? minWeight : finalWeight;
    });

    const { a, b, c } = weightedPlaneFit2D(inliers, weights);

    // NaNチェックと異常値の補正
    const isValidNumber = (n: number) => !isNaN(n) && isFinite(n);
    const safeA = isValidNumber(a) ? a : 0;
    const safeB = isValidNumber(b) ? b : 0;
    const safeC = isValidNumber(c) ? c : -1;

    // デバッグ用のログ
    console.log("Weights:", weights);
    console.log("Plane parameters:", { a: safeA, b: safeB, c: safeC });

    const refinedModel = {
      a: safeA,
      b: safeB,
      c: -1,
      d: safeC,
    };

    const n = new THREE.Vector3(
      refinedModel.a,
      refinedModel.b,
      refinedModel.c
    ).normalize();
    // 法線ベクトルが有効か確認
    if (n.lengthSq() === 0) {
      n.set(0, 0, 1); // デフォルトの法線を設定
    }

    // 平面と直交しない参照ベクトル
    let r = new THREE.Vector3(0, 1, 0);
    // if (Math.abs(n.dot(r)) > 0.9) {
    //   // n がほぼ(1,0,0)に平行なら別軸を選ぶ
    //   r.set(0, 1, 0);
    // }
    // ローカル軸となる2つのベクトルを計算
    const u = new THREE.Vector3().crossVectors(n, r).normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    // 各inlier点の3D座標を平面座標(u,v)に射影
    const centerPoint = points3DBackProjected.find(
      (p) => p.id === this.featureDetector!.centerFeature!.id
    );
    if (!centerPoint) return {};
    const P0 = centerPoint;
    // const P0 = planeModel.inliers[0]; // 一旦0番目
    const projectedPoints2D = projectInliersToPlane2D({
      inliers: planeModel.inliers,
      P0: P0,
      u: u,
      v: v,
    });
    // 平面領域を覆う最小ポリゴンの取得
    const hull2D = computeConvexHull2D(projectedPoints2D);
    const hull3D = liftHull2DTo3D({
      hull2D: hull2D,
      P0: P0,
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

  public render() {
    if (this.featureDetector) {
      this.featureDetector.render();
    }
    this.setGroupPosition();
    if (this.arRenderer) {
      this.arRenderer.render();
    }
    requestAnimationFrame(() => this.render());
  }
}

export default SPALAM;

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
import fitPlaneRANSAC, { filterByDepth } from "./helpers/fitPlaneRANSAC";
import projectInliersToPlane2D from "./helpers/projectInliersToPlane2D";
import computeConvexHull2D from "./helpers/computeConvexHull2D";
import liftHull2DTo3D from "./helpers/liftHull2DTo3D";

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
    P0: Point3D,
    center: THREE.Vector3,
    uVec: THREE.Vector3,
    vVec: THREE.Vector3,
    normal: THREE.Vector3,
    midU: number,
    midV: number,
    useCenter: boolean = false
  ) {
    // 位置の設定
    const planeCenter = new THREE.Vector3()
      .copy(P0)
      .add(uVec.clone().multiplyScalar(midU))
      .add(vVec.clone().multiplyScalar(midV));

    group.position.copy(useCenter ? center : planeCenter);

    // 回転の設定
    const camera = this.arRenderer!.getCamera();
    const worldNormal = normal
      .clone()
      .normalize()
      .applyQuaternion(camera.quaternion);

    const basis = new THREE.Matrix4();
    basis.makeBasis(
      uVec.clone().normalize(),
      vVec.clone().normalize(),
      normal.clone().normalize()
    );
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
    if (!this.depthEstimation) return {};

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
    const n = new THREE.Vector3(
      planeModel.model.a,
      planeModel.model.b,
      planeModel.model.c
    ).normalize();
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
    const P0 = planeModel.inliers[0]; // 一旦0番目
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

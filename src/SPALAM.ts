// lib
import * as THREE from "three";
import cv from "@techstark/opencv-js";

// modules
import { FeatureDetector } from "./FeatureDetector";
import { DepthEstimation } from "./DepthEstimation";

// utils
import { CameraController } from "./utils/CameraController";

// helpers
import sampleDepthAtFeaturePoints from "./helpers/sampleDepthAtFeaturePoints";
import backProjectPoints from "./helpers/backProjectPoints";
import fitPlaneRANSAC from "./helpers/fitPlaneRANSAC";
import projectInliersToPlane2D from "./helpers/projectInliersToPlane2D";

class SPALAM {
  video: HTMLVideoElement | null;
  featureDetector: FeatureDetector | null = null;
  depthEstimation: DepthEstimation | null = null;

  constructor() {
    this.video = null;
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
      this.getPoints3D();
    };
  }

  async getPoints3D() {
    if (!this.depthEstimation) return;

    // 検出済みの特徴点と深度マップを使い、各特徴点の3D座標を計算
    const depthMap = await this.depthEstimation.getDepthMap();
    if (!depthMap) return;
    const points3D = sampleDepthAtFeaturePoints({
      featurePoints: this.featureDetector!.getTrackedFeaturePoints(),
      depthMap: depthMap,
      mapWidth: this.featureDetector!.canvas.width,
      mapHeight: this.featureDetector!.canvas.height,
    });

    // 特徴点の3D座標からカメラ座標を復元
    const points3DBackProjected = backProjectPoints(points3D);

    // 平面モデルをRANSACでフィッティング
    const planeModel = fitPlaneRANSAC({
      points: points3DBackProjected,
    });
    if (!planeModel.model) return;
    const n = new THREE.Vector3(
      planeModel.model.a,
      planeModel.model.b,
      planeModel.model.c
    ).normalize();
    // 平面と直交しない参照ベクトル
    let r = new THREE.Vector3(1, 0, 0);
    if (Math.abs(n.dot(r)) > 0.9) {
      // n がほぼ(1,0,0)に平行なら別軸を選ぶ
      r.set(0, 1, 0);
    }
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
    console.log(projectedPoints2D);
  }

  public render() {
    if (this.featureDetector) {
      this.featureDetector.render();
    }
    requestAnimationFrame(() => this.render());
  }
}

export default SPALAM;

// lib
import * as THREE from "three";
import cv from "@techstark/opencv-js";

// types
import { Point2D, Point3D } from "./types";

// modules
import { ARRenderer } from "./ARRenderer";

// services
import {
  PlaneFittingService,
  PlaneFittingResult,
} from "./services/PlaneFittingService";
import { FrameProcessor } from "./services/FrameProcessor";
import { StateManager, SPALAMState } from "./services/StateManager";

// utils
import { CameraController } from "./utils/CameraController";

// config
import { SPALAMConfig } from "./config/types";
import { mergeWithDefaults } from "./config/defaults";
import { getEnvConfig } from "./config/environment";

/**
 * SPALAMメインクラス
 * WebGL/Three.jsを使用したAR環境での平面推定を実装
 */
class SPALAM {
  /** ビデオ入力 */
  private video: HTMLVideoElement | null = null;
  /** ARレンダラー */
  private arRenderer: ARRenderer | null = null;

  /** サービス */
  private planeFittingService: PlaneFittingService;
  private frameProcessor: FrameProcessor;
  private stateManager: StateManager;

  /** 設定 */
  private config: SPALAMConfig;

  constructor(config?: Partial<SPALAMConfig>) {
    // 環境変数とマージ
    const envConfig = getEnvConfig();
    const mergedConfig = mergeWithDefaults(config);

    // 環境変数からの設定を適用
    if (envConfig.showFeatures !== undefined) {
      mergedConfig.features.showFeatures = envConfig.showFeatures;
    }
    if (envConfig.showDepth !== undefined) {
      mergedConfig.depth.showDepth = envConfig.showDepth;
    }
    if (envConfig.device) {
      mergedConfig.depth.device = envConfig.device as "cpu" | "webgpu";
    }

    this.config = mergedConfig;

    // サービスの初期化
    this.planeFittingService = new PlaneFittingService(this.config.plane);
    this.frameProcessor = new FrameProcessor();
    this.stateManager = new StateManager();
  }

  /**
   * SPALAMを開始
   * @param options - 開始オプション
   * @param options.video - 使用するビデオ要素（省略時はカメラを使用）
   */
  public async start({
    video = null,
  }: { video?: HTMLVideoElement | null } = {}): Promise<void> {
    this.stateManager.setState(SPALAMState.INITIALIZING);

    const setup = async () => {
      try {
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

        // フレームプロセッサーを初期化
        await this.frameProcessor.initialize(
          cv,
          this.video,
          this.config.features.showFeatures,
          this.config.depth.showDepth
        );

        this.stateManager.setState(SPALAMState.DETECTING_FEATURES);
        this.render();
      } catch (error) {
        this.stateManager.setError(error as Error);
        throw error;
      }
    };

    return new Promise((resolve, reject) => {
      cv.onRuntimeInitialized = async () => {
        console.log(cv.getBuildInformation());
        try {
          await setup();
          this.processPlaneDetection();
          resolve();
        } catch (error) {
          reject(error);
        }
      };
    });
  }

  /**
   * 平面ジオメトリを生成する
   * @param hull2D - 2D凸包の点群
   * @param planeWidth - 平面の幅
   * @param planeHeight - 平面の高さ
   * @returns 平面メッシュと凸包形状メッシュ
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
   * @param group - Three.jsグループ
   * @param P0 - 平面の原点（カメラ座標系）
   * @param centerCS - 中心点（カメラ座標系）
   * @param uVecCS - U軸ベクトル（カメラ座標系）
   * @param vVecCS - V軸ベクトル（カメラ座標系）
   * @param normalCS - 法線ベクトル（カメラ座標系）
   * @param midU - U軸中央座標
   * @param midV - V軸中央座標
   * @param useCenter - 中心点を使用するか
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
   * 平面検出処理
   */
  private async processPlaneDetection(): Promise<void> {
    // 既に平面が検出されている場合はスキップ
    if (this.stateManager.isPlaneDetected()) {
      return;
    }

    this.stateManager.setState(SPALAMState.FITTING_PLANE);

    const processInterval = setInterval(async () => {
      // フレーム処理
      const frameResult = await this.frameProcessor.processFrame();
      if (!frameResult || !frameResult.centerFeature || !frameResult.depthMap) {
        return;
      }

      // 平面フィッティングを実行
      await this.planeFittingService.performFitting(
        frameResult.features,
        frameResult.depthMap,
        this.frameProcessor.getCanvasWidth(),
        this.frameProcessor.getCanvasHeight(),
        frameResult.centerFeature
      );

      // フィッティングが完了したかチェック
      if (this.planeFittingService.isComplete()) {
        clearInterval(processInterval);

        // 平均化された結果を取得
        const avgResult = this.planeFittingService.getAveragedResult();
        if (avgResult) {
          this.createPlaneFromResult(avgResult);
          this.stateManager.setPlaneDetected(true, avgResult);
        }
      } else {
        // 進捗をログ
        const progress = this.planeFittingService.getProgress();
        console.log(
          `フィッティング完了: ${progress.current}/${progress.total}`
        );
      }
    }, 100); // 100msごとに処理
  }

  /**
   * 平面を結果から作成
   */
  private createPlaneFromResult(result: PlaneFittingResult): void {
    const { hull2D, hull3D, P0, uVec, vVec, normal } = result;

    // 中心点の計算
    const center = new THREE.Vector3();
    hull3D.forEach((p) => center.add(new THREE.Vector3(p.x, p.y, p.z)));
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
    const scene = this.arRenderer!.getScene();
    const group = new THREE.Group();
    const { planeMesh } = this.createPlaneGeometries(
      hull2D,
      planeWidth,
      planeHeight
    );
    group.add(planeMesh);
    scene.add(group);

    // 位置と回転の調整
    this.adjustMeshTransform(
      group,
      P0,
      center,
      uVec,
      vVec,
      normal,
      midU,
      midV,
      true
    );

    // 状態マネージャーに保存
    this.stateManager.setPlaneGroup(group);
    console.log("平面配置完了:", group.position);
    this.arRenderer?.setCameraPosition(0, 0, group.position.z * 2);
  }

  /**
   * レンダリングループ
   * ARレンダリングを実行
   */
  public render() {
    // 常に特徴点検出は実行（カメラ映像の更新のため）
    if (this.frameProcessor.isReady()) {
      this.frameProcessor.renderFeatures();
    }

    if (this.arRenderer) {
      this.arRenderer.render();
    }
    requestAnimationFrame(() => this.render());
  }

  /**
   * 現在の状態を取得
   */
  public getState(): SPALAMState {
    return this.stateManager.getState();
  }

  /**
   * 状態変更リスナーを登録
   */
  public onStateChange(listener: (event: any) => void): void {
    this.stateManager.addListener(listener);
  }

  /**
   * 設定を更新
   */
  public updateConfig(config: Partial<SPALAMConfig>): void {
    this.config = mergeWithDefaults({
      ...this.config,
      ...config,
    });

    // 各サービスの設定を更新
    if (config.plane) {
      this.planeFittingService.updateConfig(config.plane);
    }
  }

  /**
   * リセット
   */
  public reset(): void {
    this.stateManager.reset();
    this.planeFittingService.reset();
    this.frameProcessor.reset();
  }
}

export default SPALAM;

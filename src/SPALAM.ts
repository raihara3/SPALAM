// lib
import * as THREE from "three";
declare const cv: any;

// types
import {
  Point2D,
  Point3D,
  SPALAMEvents,
  FrameData,
  PlaneData,
  SPALAMStartOptions,
  PerformanceStats,
  CameraInfo,
  SPALAMError,
  SPALAMErrorType,
} from "./types";

// modules
import { ARRenderer } from "./ARRenderer";

// services
import {
  PlaneFittingService,
  PlaneFittingResult,
} from "./services/PlaneFittingService";
import { FrameProcessor } from "./services/FrameProcessor";
import {
  StateManager,
  SPALAMState,
  StateChangeEvent,
} from "./services/StateManager";

// utils
import { CameraController } from "./utils/CameraController";
import { ServiceContainer } from "./utils/ServiceContainer";
import { IServiceProvider } from "./interfaces/IServiceProvider";

// config
import { SPALAMConfig } from "./config/types";
import { mergeWithDefaults } from "./config/defaults";
import { getEnvConfig } from "./config/environment";

/**
 * Fluent API用の設定ビルダー
 *
 * SPALAMインスタンスを構成するためのビルダーパターンを実装。
 * メソッドチェーンで直感的な設定が可能。
 *
 * @example
 * ```typescript
 * const spalam = createSPALAM()
 *   .useWebGPU()
 *   .features({ maxCorners: 100, qualityLevel: 0.01 })
 *   .depth({ modelId: 'depth-anything-v2-small' })
 *   .plane({ ransacIterations: 1000, smoothingIterations: 3 })
 *   .enableDebug()
 *   .build();
 * ```
 */
export class SPALAMBuilder {
  private config: Partial<SPALAMConfig> = {};
  private serviceProvider?: IServiceProvider;

  /**
   * 特徴点検出の設定
   *
   * @param config - 特徴点検出設定
   * @param config.maxCorners - 最大特徴点数 (デフォルト: 100)
   * @param config.qualityLevel - 品質闾値 (デフォルト: 0.01)
   * @param config.minDistance - 特徴点間の最小距離 (デフォルト: 10)
   * @param config.showFeatures - 特徴点表示フラグ (デフォルト: false)
   * @returns SPALAMBuilderインスタンス
   *
   * @example
   * ```typescript
   * builder.features({
   *   maxCorners: 200,
   *   qualityLevel: 0.005,
   *   minDistance: 15,
   *   showFeatures: true
   * });
   * ```
   */
  public features(config: Partial<SPALAMConfig["features"]>): SPALAMBuilder {
    this.config.features = { ...this.config.features, ...config } as any;
    return this;
  }

  /**
   * 深度推定の設定
   *
   * @param config - 深度推定設定
   * @param config.modelId - 使用する深度推定モデル (デフォルト: 'depth-anything-v2-small')
   * @param config.device - 実行デバイス 'cpu' | 'webgpu' (デフォルト: 'webgpu')
   * @param config.showDepth - 深度マップ表示フラグ (デフォルト: false)
   * @returns SPALAMBuilderインスタンス
   *
   * @example
   * ```typescript
   * builder.depth({
   *   modelId: 'depth-anything-v2-large',
   *   device: 'webgpu',
   *   showDepth: true
   * });
   * ```
   */
  public depth(config: Partial<SPALAMConfig["depth"]>): SPALAMBuilder {
    this.config.depth = { ...this.config.depth, ...config } as any;
    return this;
  }

  /**
   * 平面推定の設定
   *
   * @param config - 平面推定設定
   * @param config.ransacIterations - RANSACアルゴリズムの反復回数 (デフォルト: 1000)
   * @param config.ransacThreshold - RANSACの闾値 (デフォルト: 0.1)
   * @param config.smoothingIterations - 空間スムージングの反復回数 (デフォルト: 3)
   * @returns SPALAMBuilderインスタンス
   *
   * @example
   * ```typescript
   * builder.plane({
   *   ransacIterations: 2000,
   *   ransacThreshold: 0.05,
   *   smoothingIterations: 5
   * });
   * ```
   */
  public plane(config: Partial<SPALAMConfig["plane"]>): SPALAMBuilder {
    this.config.plane = { ...this.config.plane, ...config } as any;
    return this;
  }

  /**
   * WebGPUを使用する設定
   *
   * 深度推定のGPUアクセラレーションを有効にします。
   * WebGPUがサポートされていない環境では自動的にCPUにフォールバックされます。
   *
   * @returns SPALAMBuilderインスタンス
   *
   * @example
   * ```typescript
   * const spalam = createSPALAM()
   *   .useWebGPU() // GPUアクセラレーションを有効化
   *   .build();
   * ```
   */
  public useWebGPU(): SPALAMBuilder {
    this.config.depth = { ...this.config.depth, device: "webgpu" } as any;
    return this;
  }

  /**
   * CPUを使用する設定
   *
   * 深度推定をCPUで実行します。
   * GPUが利用できない環境や、安定性を優先する場合に使用します。
   *
   * @returns SPALAMBuilderインスタンス
   *
   * @example
   * ```typescript
   * const spalam = createSPALAM()
   *   .useCPU() // CPUでの実行を強制
   *   .build();
   * ```
   */
  public useCPU(): SPALAMBuilder {
    this.config.depth = { ...this.config.depth, device: "cpu" } as any;
    return this;
  }

  /**
   * デバッグ表示を有効にする
   *
   * 特徴点と深度マップの表示を有効にします。
   * 開発時のデバッグや動作確認に便利です。
   *
   * @returns SPALAMBuilderインスタンス
   *
   * @example
   * ```typescript
   * const spalam = createSPALAM()
   *   .enableDebug() // 特徴点と深度情報を表示
   *   .build();
   * ```
   */
  public enableDebug(): SPALAMBuilder {
    this.config.features = {
      ...this.config.features,
      showFeatures: true,
    } as any;
    this.config.depth = { ...this.config.depth, showDepth: true } as any;
    return this;
  }

  /**
   * カスタムサービスプロバイダーを設定
   *
   * 独自のサービス実装を指定してDI（依存性注入）を実現します。
   * テスト時のモックや、独自のアルゴリズム実装に使用します。
   *
   * @param provider - カスタムサービスプロバイダー
   * @returns SPALAMBuilderインスタンス
   *
   * @example
   * ```typescript
   * const customProvider = new MyServiceProvider();
   * const spalam = createSPALAM()
   *   .withServices(customProvider)
   *   .build();
   * ```
   */
  public withServices(provider: IServiceProvider): SPALAMBuilder {
    this.serviceProvider = provider;
    return this;
  }

  /**
   * SPALAMインスタンスをビルド
   *
   * これまでの設定を適用してSPALAMインスタンスを作成します。
   * ビルド後はstart()メソッドで処理を開始できます。
   *
   * @returns 構成されたSPALAMインスタンス
   *
   * @example
   * ```typescript
   * const spalam = createSPALAM()
   *   .useWebGPU()
   *   .enableDebug()
   *   .build(); // インスタンスを作成
   *
   * await spalam.start(); // 処理開始
   * ```
   */
  public build(): SPALAM {
    // マージした設定をmergeWithDefaultsで処理
    const mergedConfig = mergeWithDefaults(this.config);
    return new SPALAM(mergedConfig, this.serviceProvider);
  }
}

/**
 * SPALAMファクトリー関数
 *
 * SPALAMインスタンスを作成するためのファクトリー関数。
 * Fluent APIスタイルで直感的な設定が可能です。
 *
 * @returns SPALAMBuilderインスタンス
 *
 * @example
 * ```typescript
 * // 基本的な使用方法
 * const spalam = createSPALAM()
 *   .useWebGPU()
 *   .enableDebug()
 *   .build();
 *
 * await spalam.start();
 *
 * // 詳細設定
 * const advancedSpalam = createSPALAM()
 *   .features({
 *     maxCorners: 200,
 *     qualityLevel: 0.005,
 *     minDistance: 15
 *   })
 *   .depth({
 *     modelId: 'depth-anything-v2-large',
 *     device: 'webgpu'
 *   })
 *   .plane({
 *     ransacIterations: 2000,
 *     smoothingIterations: 5
 *   })
 *   .build();
 *
 * await advancedSpalam.start({ autoRender: false });
 * advancedSpalam.render(); // 手動でレンダリング開始
 * ```
 */
export function createSPALAM(): SPALAMBuilder {
  return new SPALAMBuilder();
}

/**
 * SPALAMメインクラス
 * WebGL/Three.jsを使用したAR環境での平面推定を実装
 *
 * @example
 * ```typescript
 * // 基本的な使用方法
 * const spalam = createSPALAM()
 *   .useWebGPU()
 *   .enableDebug()
 *   .build();
 *
 * await spalam.start();
 *
 * // イベントリスナーの登録
 * spalam.on('plane:detected', (plane) => {
 *   console.log('平面が検出されました:', plane);
 * });
 * ```
 */
export class SPALAM implements IServiceProvider {
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

  /** サービスコンテナ */
  private container: ServiceContainer;

  /** イベントリスナー */
  private eventListeners: Map<keyof SPALAMEvents, Function[]> = new Map();

  /** アニメーションフレームID */
  private animationFrameId: number | null = null;

  /** 前フレームの中心特徴点位置（カメラ移動追跡用） */
  private previousCenterFeature: { x: number; y: number } | null = null;

  /** 前フレームの特徴点数（Z軸移動検出用） */
  private previousFeatureCount: number = 0;

  /** 前フレームの特徴点平均距離（Z軸移動検出用） */
  private previousAverageDistance: number = 0;

  constructor(
    config?: SPALAMConfig | Partial<SPALAMConfig>,
    serviceProvider?: IServiceProvider
  ) {
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

    // サービスコンテナの初期化
    this.container = new ServiceContainer();

    // サービスの初期化（DIで上書き可能）
    if (serviceProvider) {
      // 外部サービスプロバイダーからサービスを取得
      this.planeFittingService = serviceProvider.getService(
        "planeFittingService"
      );
      this.frameProcessor = serviceProvider.getService("frameProcessor");
      this.stateManager = serviceProvider.getService("stateManager");
    } else {
      // デフォルトサービスを作成
      this.planeFittingService = new PlaneFittingService(this.config.plane);
      this.frameProcessor = new FrameProcessor();
      this.stateManager = new StateManager();
    }

    // コンテナにサービスを登録
    this.container.register("config", this.config);
    this.container.register("planeFittingService", this.planeFittingService);
    this.container.register("frameProcessor", this.frameProcessor);
    this.container.register("stateManager", this.stateManager);

    // 状態変更リスナーを設定
    this.stateManager.addListener((event: StateChangeEvent) => {
      try {
        this.emit("state:changed", event);
      } catch (error) {
        console.error("Error in state change event emission:", error);
      }
    });
  }

  /**
   * SPALAMを開始
   * @param options - 開始オプション
   * @returns Promise<SPALAM> - チェーンメソッド用にSPALAMインスタンスを返す
   */
  public async start(options: SPALAMStartOptions = {}): Promise<SPALAM> {
    const { video = null, autoRender = true } = options;
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
      // OpenCV.jsが既に読み込み済みかチェック
      const checkOpenCVReady = () => {
        try {
          // OpenCV.jsが利用可能かテスト
          if (typeof cv !== "undefined" && cv.getBuildInformation) {
            cv.getBuildInformation();
            return true;
          }
          return false;
        } catch (error) {
          return false;
        }
      };

      const initializeApp = async () => {
        try {
          console.log("OpenCV.js initialized:", cv.getBuildInformation());
          await setup();
          this.processPlaneDetection();

          if (autoRender) {
            this.render();
          }

          resolve(this);
        } catch (error) {
          const spalamError =
            error instanceof SPALAMError
              ? error
              : new SPALAMError(
                  SPALAMErrorType.UNKNOWN,
                  (error as Error).message,
                  error as Error
                );
          this.emit("error", spalamError);
          reject(spalamError);
        }
      };

      // 既に読み込み済みの場合はすぐに実行
      if (checkOpenCVReady()) {
        initializeApp();
        return;
      }

      // OpenCV.jsの読み込み完了を待機
      let timeoutId: NodeJS.Timeout;
      const timeout = setTimeout(() => {
        reject(
          new SPALAMError(
            SPALAMErrorType.INITIALIZATION_ERROR,
            "OpenCV.js loading timeout"
          )
        );
      }, 10000); // 10秒でタイムアウト

      cv.onRuntimeInitialized = () => {
        clearTimeout(timeout);
        initializeApp();
      };

      // エラーハンドリング用のfallback
      if (typeof cv === "undefined") {
        clearTimeout(timeout);
        reject(
          new SPALAMError(
            SPALAMErrorType.INITIALIZATION_ERROR,
            "OpenCV.js is not available"
          )
        );
      }
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

    // 2) カメラ空間→ワールド空間に変換（カメラ位置はリセットしない）
    const copyCamera = camera.clone();

    // 3) ワールド空間の位置をセット
    // P0は既に中心特徴点の位置なので、それをワールド座標に変換
    const p0WS = copyCamera.localToWorld(new THREE.Vector3(P0.x, P0.y, P0.z));
    group.position.copy(p0WS);

    // x座標とy座標を0に固定（平面追跡アプローチ）
    group.position.x = 0;
    group.position.y = 0;

    // 4) 平面の基底ベクトルはカメラ座標系のまま使用（カメラの回転に追従させない）
    const worldU = uVecCS.clone().normalize();
    const worldV = vVecCS.clone().normalize();
    const worldN = normalCS.clone().normalize();

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
      if (!frameResult || !frameResult.centerFeature) {
        return;
      }

      // 深度マップが利用できない場合の警告（モバイル端末など）
      if (!frameResult.depthMap) {
        console.log(
          "Processing frame without AI depth estimation - using fallback depth calculation"
        );
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

          // 平面検出イベントを発火
          const planeData: PlaneData = {
            position: new THREE.Vector3().copy(avgResult.P0),
            normal: new THREE.Vector3().copy(avgResult.normal),
            hull2D: avgResult.hull2D,
            hull3D: avgResult.hull3D,
            confidence: 1.0, // TODO: 実際の信頼度を計算
            size: {
              width:
                Math.max(...avgResult.hull2D.map((p) => p.u)) -
                Math.min(...avgResult.hull2D.map((p) => p.u)),
              height:
                Math.max(...avgResult.hull2D.map((p) => p.v)) -
                Math.min(...avgResult.hull2D.map((p) => p.v)),
            },
            detectedAt: Date.now(),
          };
          this.emit("plane:detected", planeData);
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

    // 既存の平面グループがあれば削除
    const existingGroup = this.stateManager.getPlaneGroup();
    if (existingGroup) {
      scene.remove(existingGroup);
      existingGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }

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
    console.log("カメラの位置:", this.arRenderer?.getCamera().position);
    this.arRenderer?.setCameraPosition(0, 0, group.position.z * 2);
  }

  /**
   * 特徴点間の平均距離を計算（Z軸移動検出用）
   */
  private calculateAverageFeatureDistance(
    features: any[],
    centerFeature: Feature
  ): number {
    if (features.length < 2) return 0;

    let totalDistance = 0;
    let count = 0;

    for (const feature of features) {
      const dx = feature.x - centerFeature.x;
      const dy = feature.y - centerFeature.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      totalDistance += distance;
      count++;
    }

    return count > 0 ? totalDistance / count : 0;
  }

  /**
   * カメラの移動を追跡し、Three.jsカメラの位置を更新
   */
  private updateCameraPosition(centerFeature: Feature): void {
    const camera = this.arRenderer!.getCamera();
    const features = this.frameProcessor.getFeatures() || [];

    // 前フレームの特徴点位置がない場合は初期化
    if (!this.previousCenterFeature) {
      this.previousCenterFeature = { x: centerFeature.x, y: centerFeature.y };
      this.previousFeatureCount = features.length;
      this.previousAverageDistance = this.calculateAverageFeatureDistance(
        features,
        centerFeature
      );
      console.log(
        `カメラ位置: x=${camera.position.x.toFixed(3)}, y=${camera.position.y.toFixed(3)}, z=${camera.position.z.toFixed(3)}`
      );
      return;
    }

    // X, Y軸の移動量を計算（逆方向に修正）
    const deltaX = -(centerFeature.x - this.previousCenterFeature.x);
    const deltaY = -(centerFeature.y - this.previousCenterFeature.y);

    // Z軸の移動量を特徴点の平均距離変化から推定
    const currentAverageDistance = this.calculateAverageFeatureDistance(
      features,
      centerFeature
    );
    let deltaZ = 0;

    if (this.previousAverageDistance > 0 && currentAverageDistance > 0) {
      // 特徴点間距離の変化率からZ軸移動を推定
      // 距離が減少 = カメラが遠ざかる（Z軸正方向）
      // 距離が増加 = カメラが近づく（Z軸負方向）
      const distanceRatio =
        currentAverageDistance / this.previousAverageDistance;
      deltaZ = -(distanceRatio - 1.0) * 2.0; // スケール調整（逆方向に修正）
    }

    // 移動量がほとんどない場合はスキップ（ノイズ除去）
    const xyThreshold = 2.0; // ピクセル単位
    const zThreshold = 0.05; // Z軸の閾値

    const hasXYMovement =
      Math.abs(deltaX) >= xyThreshold || Math.abs(deltaY) >= xyThreshold;
    const hasZMovement = Math.abs(deltaZ) >= zThreshold;

    if (!hasXYMovement && !hasZMovement) {
      console.log(
        `カメラ位置: x=${camera.position.x.toFixed(3)}, y=${camera.position.y.toFixed(3)}, z=${camera.position.z.toFixed(3)}`
      );
      return;
    }

    // 画面サイズで正規化（X, Y軸）
    const width = this.frameProcessor.getCanvasWidth();
    const height = this.frameProcessor.getCanvasHeight();
    const normalizedDeltaX = deltaX / width;
    const normalizedDeltaY = deltaY / height; // Y軸反転を削除（既に逆方向計算済み）

    // 移動距離をカメラの位置に反映
    const movementScale = 1.0;
    const zMovementScale = 0.5; // Z軸の感度調整

    if (hasXYMovement) {
      camera.position.x += normalizedDeltaX * movementScale;
      camera.position.y += normalizedDeltaY * movementScale;
    }

    if (hasZMovement) {
      camera.position.z += deltaZ * zMovementScale;
    }

    // 前フレームの値を更新
    this.previousCenterFeature.x = centerFeature.x;
    this.previousCenterFeature.y = centerFeature.y;
    this.previousFeatureCount = features.length;
    this.previousAverageDistance = currentAverageDistance;

    // 毎フレームカメラ位置をコンソール出力
    console.log(
      `カメラ位置: x=${camera.position.x.toFixed(3)}, y=${camera.position.y.toFixed(3)}, z=${camera.position.z.toFixed(3)}`
    );
    console.log("平面の角度:", this.stateManager.getPlaneGroup()?.rotation);
  }

  /**
   * 平面の位置を中心特徴点に基づいて更新
   */
  private updatePlanePosition(centerFeature: Feature): void {
    const planeGroup = this.stateManager.getPlaneGroup();
    const planeResult = this.stateManager.getPlaneResult();

    if (!planeGroup || !planeResult) return;

    // 簡易的な深度計算（平面検出時の深度を使用）
    const estimatedZ = planeResult.P0.z;

    // 特徴点の正規化座標を計算
    const width = this.frameProcessor.getCanvasWidth();
    const height = this.frameProcessor.getCanvasHeight();
    const normalizedX = (centerFeature.x / width - 0.5) * 2;
    const normalizedY = -(centerFeature.y / height - 0.5) * 2; // Y軸を反転

    // カメラのアスペクト比とFOVを考慮
    const camera = this.arRenderer!.getCamera();
    const aspect = camera.aspect;
    const fov = (camera.fov * Math.PI) / 180;
    const tanHalfFov = Math.tan(fov / 2);

    // 3D位置を計算（カメラ座標系）
    const x = normalizedX * tanHalfFov * aspect * estimatedZ;
    const y = normalizedY * tanHalfFov * estimatedZ;

    // カメラ座標系からワールド座標系への変換
    const copyCamera = camera.clone();
    copyCamera.position.z = 0;

    const newPositionWS = copyCamera.localToWorld(
      new THREE.Vector3(x, y, estimatedZ)
    );

    // 位置の変化が大きすぎる場合はスムージング
    const smoothingFactor = 0.7; // 0.0-1.0の範囲で、値が小さいほどスムーズ

    planeGroup.position.lerp(newPositionWS, smoothingFactor);
  }

  /**
   * レンダリングループ
   * ARレンダリングを実行
   */
  public render(): void {
    // 常に特徴点検出は実行（カメラ映像の更新のため）
    if (this.frameProcessor.isReady()) {
      this.frameProcessor.renderFeatures();

      // フレーム処理イベントを発火
      const features = this.frameProcessor.getFeatures() || [];
      const centerFeature = this.frameProcessor.getCenterFeature();
      const frameData: FrameData = {
        features: features.map((f: any, index: number) => ({
          point: f.point || { x: f.x || 0, y: f.y || 0 },
          quality: f.quality || 0.5,
          trackingCount: f.trackingCount || 1,
          id: f.id || `feature_${index}`,
        })),
        centerFeature: centerFeature
          ? {
              point: (centerFeature as any).point || {
                x: (centerFeature as any).x || 0,
                y: (centerFeature as any).y || 0,
              },
              quality: (centerFeature as any).quality || 0.5,
              trackingCount: (centerFeature as any).trackingCount || 1,
              id: (centerFeature as any).id || "center_feature",
            }
          : null,
        depthMap: null, // getDepthMapは非同期なので、ここでは省略
        timestamp: Date.now(),
      };
      this.emit("frame:processed", frameData);

      // 中心特徴点が存在する場合はカメラ位置を更新
      if (centerFeature) {
        this.updateCameraPosition(centerFeature);
      }

      // 平面が検出済みで、中心特徴点が存在する場合は位置を更新
      if (this.stateManager.isPlaneDetected() && centerFeature) {
        this.updatePlanePosition(centerFeature);
      }
    }

    if (this.arRenderer) {
      this.arRenderer.render();
    }
    this.animationFrameId = requestAnimationFrame(() => this.render());
  }

  /**
   * 現在の状態を取得
   */
  public getState(): SPALAMState {
    return this.stateManager.getState();
  }

  /**
   * イベントリスナーを登録
   */
  public on<K extends keyof SPALAMEvents>(
    event: K,
    listener: SPALAMEvents[K]
  ): SPALAM {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
    return this; // チェーンメソッド用
  }

  /**
   * イベントリスナーを削除
   */
  public off<K extends keyof SPALAMEvents>(
    event: K,
    listener: SPALAMEvents[K]
  ): SPALAM {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
    return this; // チェーンメソッド用
  }

  /**
   * イベントを発火
   */
  private emit<K extends keyof SPALAMEvents>(
    event: K,
    ...args: Parameters<SPALAMEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          (listener as Function)(...args);
        } catch (error) {
          console.error(`Error in ${event} listener:`, error);
        }
      });
    }
  }

  /**
   * 状態変更リスナーを登録（後方互換性）
   * @deprecated on('state:changed', listener)を使用してください
   */
  public onStateChange(listener: (event: StateChangeEvent) => void): void {
    this.on("state:changed", listener);
  }

  /**
   * 設定を更新
   */
  public updateConfig(config: Partial<SPALAMConfig>): SPALAM {
    this.config = mergeWithDefaults({
      ...this.config,
      ...config,
    });

    // 各サービスの設定を更新
    if (config.plane) {
      this.planeFittingService.updateConfig(config.plane);
    }
    return this; // チェーンメソッド用
  }

  /**
   * リセット
   */
  public reset(): SPALAM {
    this.stateManager.reset();
    this.planeFittingService.reset();
    this.frameProcessor.reset();
    this.previousCenterFeature = null; // カメラ移動追跡もリセット
    this.previousFeatureCount = 0;
    this.previousAverageDistance = 0;
    return this; // チェーンメソッド用
  }

  /**
   * 停止
   */
  public stop(): SPALAM {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // 各サービスを停止
    if (this.frameProcessor) {
      this.frameProcessor.stop();
    }

    return this; // チェーンメソッド用
  }

  /**
   * リソースを解放
   */
  public dispose(): void {
    this.stop();

    // イベントリスナーをクリア
    this.eventListeners.clear();

    // ARレンダラーを解放
    if (this.arRenderer) {
      this.arRenderer.dispose();
      this.arRenderer = null;
    }

    // ビデオ要素をクリア
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      this.video = null;
    }
  }

  /**
   * サービスを取得（IServiceProvider実装）
   */
  public getService<T>(name: string): T {
    return this.container.resolve<T>(name);
  }

  /**
   * サービスが利用可能かチェック（IServiceProvider実装）
   */
  public hasService(name: string): boolean {
    return this.container.has(name);
  }

  /**
   * パフォーマンス統計を取得
   *
   * フレームレート、各処理の実行時間、メモリ使用量などの
   * パフォーマンス情報を取得します。
   *
   * @returns パフォーマンス統計情報
   *
   * @example
   * ```typescript
   * const stats = spalam.getPerformanceStats();
   * console.log(`FPS: ${stats.fps}`);
   * console.log(`特徴点検出時間: ${stats.featureDetectionTime}ms`);
   * ```
   */
  public getPerformanceStats(): PerformanceStats {
    // TODO: 実際のパフォーマンスメトリクスを収集
    return {
      fps: 0,
      featureDetectionTime: 0,
      depthEstimationTime: 0,
      planeFittingTime: 0,
      memoryUsage: 0,
    };
  }

  /**
   * カメラ情報を取得
   *
   * 現在使用中のカメラの内部パラメータ、歪み係数、解像度などの
   * 詳細情報を取得します。カメラが初期化されていない場合はnullを返します。
   *
   * @returns カメラ情報、またはnull（カメラが未初期化の場合）
   *
   * @example
   * ```typescript
   * const cameraInfo = spalam.getCameraInfo();
   * if (cameraInfo) {
   *   console.log(`解像度: ${cameraInfo.resolution.width}x${cameraInfo.resolution.height}`);
   *   console.log(`焦点距離: fx=${cameraInfo.intrinsics.fx}, fy=${cameraInfo.intrinsics.fy}`);
   * }
   * ```
   */
  public getCameraInfo(): CameraInfo | null {
    if (!this.video) {
      return null;
    }

    // TODO: 実際のカメラパラメータを取得
    return {
      intrinsics: {
        fx: 800,
        fy: 800,
        cx: this.video.videoWidth / 2,
        cy: this.video.videoHeight / 2,
      },
      distortion: {
        k1: 0,
        k2: 0,
        p1: 0,
        p2: 0,
      },
      resolution: {
        width: this.video.videoWidth,
        height: this.video.videoHeight,
      },
    };
  }

  /**
   * 現在の設定を取得
   *
   * SPALAM内部で使用されている全ての設定情報のコピーを取得します。
   * 返される設定オブジェクトを変更しても内部設定には影響しません。
   *
   * @returns 現在の設定のコピー
   *
   * @example
   * ```typescript
   * const config = spalam.getConfig();
   * console.log('特徴点設定:', config.features);
   * console.log('深度推定設定:', config.depth);
   * console.log('平面推定設定:', config.plane);
   * ```
   */
  public getConfig(): SPALAMConfig {
    return { ...this.config };
  }

  /**
   * 検出された平面情報を取得
   *
   * 現在検出されている平面の詳細情報を取得します。
   * 平面が検出されていない場合はnullを返します。
   *
   * @returns 検出された平面データ、またはnull（平面が未検出の場合）
   *
   * @example
   * ```typescript
   * const plane = spalam.getDetectedPlane();
   * if (plane) {
   *   console.log('平面位置:', plane.position);
   *   console.log('平面法線:', plane.normal);
   *   console.log('信頼度:', plane.confidence);
   *   console.log('サイズ:', plane.size);
   * }
   * ```
   */
  public getDetectedPlane(): PlaneData | null {
    if (!this.stateManager.isPlaneDetected()) {
      return null;
    }

    const planeResult = this.stateManager.getPlaneResult();
    if (!planeResult) {
      return null;
    }

    return {
      position: new THREE.Vector3().copy(planeResult.P0),
      normal: new THREE.Vector3().copy(planeResult.normal),
      hull2D: planeResult.hull2D,
      hull3D: planeResult.hull3D,
      confidence: 1.0,
      size: {
        width:
          Math.max(...planeResult.hull2D.map((p) => p.u)) -
          Math.min(...planeResult.hull2D.map((p) => p.u)),
        height:
          Math.max(...planeResult.hull2D.map((p) => p.v)) -
          Math.min(...planeResult.hull2D.map((p) => p.v)),
      },
      detectedAt: Date.now(),
    };
  }

  /**
   * アクティブな状態かどうかをチェック
   *
   * SPALAMが現在フレーム処理を実行しているかどうかを確認します。
   * start()で開始され、stop()やpause()で停止されるまでtrueを返します。
   *
   * @returns アクティブ状態の場合true、停止中の場合false
   *
   * @example
   * ```typescript
   * if (spalam.isActive()) {
   *   console.log('SPALAMは実行中です');
   * } else {
   *   console.log('SPALAMは停止中です');
   * }
   * ```
   */
  public isActive(): boolean {
    return this.animationFrameId !== null;
  }

  /**
   * 平面が検出されているかどうかをチェック
   *
   * 現在平面が検出済みかどうかを確認します。
   * 平面検出が完了している場合はtrue、まだ検出中または失敗した場合はfalseを返します。
   *
   * @returns 平面が検出済みの場合true、未検出の場合false
   *
   * @example
   * ```typescript
   * spalam.on('plane:detected', () => {
   *   if (spalam.isPlaneDetected()) {
   *     console.log('平面が検出されました!');
   *     const plane = spalam.getDetectedPlane();
   *   }
   * });
   * ```
   */
  public isPlaneDetected(): boolean {
    return this.stateManager.isPlaneDetected();
  }

  /**
   * フレーム処理の一時停止
   *
   * 現在実行中のフレーム処理を一時停止します。
   * resume()メソッドで処理を再開できます。
   *
   * @returns SPALAMインスタンス（メソッドチェーン用）
   *
   * @example
   * ```typescript
   * // 一時停止
   * spalam.pause();
   *
   * // 何かしらの処理...
   *
   * // 再開
   * spalam.resume();
   * ```
   */
  public pause(): SPALAM {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    return this;
  }

  /**
   * フレーム処理の再開
   *
   * pause()で一時停止したフレーム処理を再開します。
   * 既に実行中の場合は何も行いません。
   *
   * @returns SPALAMインスタンス（メソッドチェーン用）
   *
   * @example
   * ```typescript
   * // 一時停止
   * spalam.pause();
   *
   * // 後で再開
   * spalam.resume();
   *
   * // チェーンメソッドとしても使用可能
   * spalam.pause().resume();
   * ```
   */
  public resume(): SPALAM {
    if (!this.animationFrameId) {
      this.render();
    }
    return this;
  }
}

// デフォルトエクスポート（後方互換性）
export default SPALAM;

// 名前付きエクスポート
export type { SPALAMState } from "./services/StateManager";
export type { SPALAMConfig } from "./config/types";

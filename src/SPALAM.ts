/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

// lib
import * as THREE from "three";
// cv types are defined in opencv.d.ts

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
import type { Feature as InternalFeature } from "./types/Feature";
import type { Feature as APIFeature } from "./types/API";

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
import { StageProfiler, FrameBudgetStatistics } from "./utils/StageProfiler";
import { IServiceProvider } from "./types/ServiceProvider";

// tracking
import {
  DeviceMotionTracker,
  ComplementaryFilter,
  DriftCorrector,
  DistanceTracker,
  FeatureAnchor,
  GravityAligner,
  FeatureQualityMonitor,
  FeatureQualityState,
  PlaneModelPersistence,
  TrackingStateMachine,
  CameraTracker,
  CameraTrackerStatus,
  LandmarkMap,
  MapInitializer,
  PoseEstimator,
  Triangulator,
  PnPSolver,
  LocalBundleAdjustment,
} from "./tracking";
import { DeviceMotionTrackerEvent } from "./types/DeviceMotion";
import type { TrackingState, CameraPose } from "./types/Pose";

// config
import { SPALAMConfig } from "./config/types";
import { mergeWithDefaults } from "./config/defaults";
import { getEnvConfig } from "./config/environment";

// helpers
import { getCameraIntrinsics } from "./helpers/backProjectPoints";
import { cameraPoseToThreeJs } from "./helpers/cameraPoseConversion";
import sampleDepthAtFeaturePoints from "./helpers/sampleDepthAtFeaturePoints";

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
    this.config.features = { ...this.config.features, ...config } as Partial<SPALAMConfig["features"]> as SPALAMConfig["features"];
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
    this.config.depth = { ...this.config.depth, ...config } as Partial<SPALAMConfig["depth"]> as SPALAMConfig["depth"];
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
    this.config.plane = { ...this.config.plane, ...config } as Partial<SPALAMConfig["plane"]> as SPALAMConfig["plane"];
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
    this.config.depth = { ...this.config.depth, device: "webgpu" } as Partial<SPALAMConfig["depth"]> as SPALAMConfig["depth"];
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
    this.config.depth = { ...this.config.depth, device: "cpu" } as Partial<SPALAMConfig["depth"]> as SPALAMConfig["depth"];
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
    } as Partial<SPALAMConfig["features"]> as SPALAMConfig["features"];
    this.config.depth = { ...this.config.depth, showDepth: true } as Partial<SPALAMConfig["depth"]> as SPALAMConfig["depth"];
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
  private eventListeners: Map<keyof SPALAMEvents, ((...args: never[]) => void)[]> = new Map();

  /** アニメーションフレームID */
  private animationFrameId: number | null = null;

  /** Frame rate limiting - 30fps to reduce CPU and memory pressure */
  private frameInterval: number = 1000 / 30; // ~33ms per frame
  private lastFrameTime: number = 0;

  /** Periodic memory reset */
  private memoryResetInterval: number = 60000; // 1 minute
  private lastMemoryResetTime: number = 0;

  /** デバイスモーショントラッカー */
  private deviceMotionTracker: DeviceMotionTracker | null = null;
  /** IMUトラッキングが有効かどうか */
  private imuTrackingEnabled: boolean = false;
  /** IMUデバッグ情報を表示するかどうか */
  private showIMUDebug: boolean = false;

  /** 相補フィルタ（Phase 2: Visual-Inertial Fusion） */
  private complementaryFilter: ComplementaryFilter | null = null;
  /** ドリフト補正器（Phase 2: Visual-Inertial Fusion） */
  private driftCorrector: DriftCorrector | null = null;

  /** 距離トラッカー（Phase 2.5: 距離追跡とスケール更新） */
  private distanceTracker: DistanceTracker | null = null;
  /** 特徴点アンカー（Phase 2.5: 特徴点固定化） */
  private featureAnchor: FeatureAnchor | null = null;
  /** 重力アライナー（Phase 2.5: 平面角度精度向上） */
  private gravityAligner: GravityAligner | null = null;
  /** 特徴点品質モニター（特徴点が少ない平面でのドリフト軽減） */
  private featureQualityMonitor: FeatureQualityMonitor | null = null;
  /** 平面モデル永続化（DROUGHT時に平面位置をロック） */
  private planeModelPersistence: PlaneModelPersistence | null = null;
  /** 初期平面スケール */
  private initialPlaneScale: number = 1.0;
  /** 再配置待ちフラグ（オブジェクトをcenterFeatureの位置に移動する必要がある） */
  private pendingReposition: boolean = false;

  /** ステージ別プロファイラ（フレームバジェット監視） */
  private readonly stageProfiler: StageProfiler = new StageProfiler();
  /** トラッキング状態機械 */
  private readonly trackingStateMachine: TrackingStateMachine =
    new TrackingStateMachine();
  /** 6DoFカメラトラッカー（ランドマークマップ + RANSAC PnP） */
  private cameraTracker: CameraTracker | null = null;
  /** 6DoFトラッキングのOpenCV依存コンポーネント（dispose用） */
  private sixDofComponents: Array<{ dispose(): void }> = [];
  /** 6DoFトラッキングのエラーログ抑制フラグ（毎フレームのログ洪水を防ぐ） */
  private sixDofErrorLogged: boolean = false;
  /** 6DoF初期化用にキャッシュした深度マップ（初期化中のみ更新） */
  private sixDofDepthMapCache: Float32Array | null = null;
  /** 深度マップ取得の実行中フラグ */
  private sixDofDepthMapFetching: boolean = false;
  /** 深度マップの最終取得時刻（ms） */
  private sixDofDepthMapFetchedAt: number = 0;
  /** 深度マップ取得の最小間隔（ms） */
  private readonly sixDofDepthMapRefreshInterval: number = 500;
  /** 初期化時の深度事前情報用の再利用Map */
  private readonly reusableDepthPriors: Map<string, number> = new Map();

  /** Previous orientation for computing rotation delta for DistanceTracker */
  private readonly previousOrientationForScale: THREE.Quaternion =
    new THREE.Quaternion();
  private hasPreviousOrientationForScale: boolean = false;
  private readonly reusableRotationDelta: THREE.Quaternion =
    new THREE.Quaternion();

  // Reusable objects to prevent GC pressure from per-frame allocations
  private readonly reusablePlaneCenter: THREE.Vector3 = new THREE.Vector3();
  private readonly reusablePosition3D: THREE.Vector3 = new THREE.Vector3();
  private readonly reusablePlaneNormal: THREE.Vector3 = new THREE.Vector3();
  private readonly reusableDefaultNormal: THREE.Vector3 = new THREE.Vector3(
    0,
    0,
    1
  );
  private readonly reusableTargetQuaternion: THREE.Quaternion =
    new THREE.Quaternion();
  private readonly reusableDepth3DPoints: Map<string, THREE.Vector3> =
    new Map();
  private readonly reusableVector3Pool: THREE.Vector3[] = [];

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

        this.arRenderer = new ARRenderer({
          width: this.video.width,
          height: this.video.height,
        });

        // フレームプロセッサーを初期化
        await this.frameProcessor.initialize(
          cv,
          this.video,
          this.config.features.showFeatures,
          this.config.depth.showDepth,
          {
            // 6DoFトラッキングは環境全体のランドマークを必要とするため、
            // 有効時は検出領域を全画面に切り替え、マップ品質のために
            // Forward-Backwardチェックも既定で有効化する（config優先）。
            // グリッドバケッティングは全画面検出時のみ適用し、従来の
            // 中央ROIパイプラインの特徴点選択挙動は変えない
            detectionRegion: this.config.tracking.enableSixDof
              ? "full"
              : this.config.features.detectionRegion,
            forwardBackwardThreshold:
              this.config.tracking.enableSixDof &&
              this.config.features.forwardBackwardThreshold <= 0
                ? 1.0
                : this.config.features.forwardBackwardThreshold,
            grid:
              this.config.tracking.enableSixDof ||
              this.config.features.detectionRegion === "full"
                ? this.config.features.grid
                : null,
          }
        );

        if (this.config.tracking.enableSixDof) {
          this.initializeCameraTracker();
        }

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
        } catch {
          return false;
        }
      };

      const initializeApp = async () => {
        try {
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
      const timeout = setTimeout(() => {
        reject(
          new SPALAMError(
            SPALAMErrorType.OPENCV_INIT_FAILED,
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
            SPALAMErrorType.OPENCV_INIT_FAILED,
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
   * @param uVecCS - U軸ベクトル（カメラ座標系）
   * @param vVecCS - V軸ベクトル（カメラ座標系）
   * @param normalCS - 法線ベクトル（カメラ座標系）
   */
  private adjustMeshTransform(
    group: THREE.Group,
    P0: Point3D,
    uVecCS: THREE.Vector3,
    vVecCS: THREE.Vector3,
    normalCS: THREE.Vector3
  ) {
    const camera = this.arRenderer!.getCamera();

    // Three.jsの座標系: -Zがカメラの前方なので、深度値を負にする
    const p0WS = camera.localToWorld(new THREE.Vector3(P0.x, P0.y, -P0.z));

    console.log("[InitialPlacement] P0:", P0.x, P0.y, P0.z);
    console.log("[InitialPlacement] worldPosition:", p0WS.x, p0WS.y, p0WS.z);

    group.position.copy(p0WS);

    const worldU = uVecCS.clone().normalize();
    const worldV = vVecCS.clone().normalize();
    const worldN = normalCS.clone().normalize();

    const basis = new THREE.Matrix4().makeBasis(worldU, worldV, worldN);
    const rotationX = new THREE.Matrix4().makeRotationX(
      THREE.MathUtils.degToRad(90)
    );
    basis.multiply(rotationX);

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
        // フォールバック深度計算を使用
      }

      // 平面フィッティングを実行
      this.stageProfiler.beginStage("planeFitting");
      await this.planeFittingService.performFitting(
        frameResult.features,
        frameResult.depthMap,
        this.frameProcessor.getCanvasWidth(),
        this.frameProcessor.getCanvasHeight(),
        frameResult.centerFeature,
        this.video?.videoWidth,
        this.video?.videoHeight
      );
      this.stageProfiler.endStage("planeFitting");

      // フィッティングが完了したかチェック
      if (this.planeFittingService.isComplete()) {
        clearInterval(processInterval);

        // 平均化された結果を取得
        const avgResult = this.planeFittingService.getAveragedResult();
        if (avgResult) {
          this.createPlaneFromResult(avgResult);
          this.stateManager.setPlaneDetected(true, avgResult);

          // 平面検出完了後は深度推定を無効化（CPU/メモリ節約）
          this.frameProcessor.setDepthEstimationEnabled(false);

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

    // 6面異なる色の立方体を追加（平面サイズの7割）
    const cubeSize = Math.min(planeWidth, planeHeight) * 0.7;
    const cubeMaterials = [
      new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.8,
      }), // right: red
      new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.8,
      }), // left: green
      new THREE.MeshBasicMaterial({
        color: 0x0000ff,
        transparent: true,
        opacity: 0.8,
      }), // top: blue
      new THREE.MeshBasicMaterial({
        color: 0xffff00,
        transparent: true,
        opacity: 0.8,
      }), // bottom: yellow
      new THREE.MeshBasicMaterial({
        color: 0xff00ff,
        transparent: true,
        opacity: 0.8,
      }), // front: magenta
      new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.8,
      }), // back: cyan
    ];
    const cubeGeometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
    const cubeMesh = new THREE.Mesh(cubeGeometry, cubeMaterials);
    cubeMesh.position.set(0, 0, cubeSize / 2);
    group.add(cubeMesh);

    scene.add(group);

    // 位置と回転の調整
    this.adjustMeshTransform(group, P0, uVec, vVec, normal);

    // 画面サイズに対して60%の大きさになるように初期スケールを計算
    const initialScale = this.computeScreenBasedInitialScale(P0.z, cubeSize);
    group.scale.set(initialScale, initialScale, initialScale);
    this.initialPlaneScale = initialScale;

    // 状態マネージャーに保存
    this.stateManager.setPlaneGroup(group);
    this.arRenderer?.setCameraPosition(0, 0, 0);

    // Phase 2.5: トラッキング品質改善機能を初期化
    this.initializePhase25Tracking(result);
  }

  /**
   * 画面サイズに対して一定の大きさになるように初期スケールを計算
   *
   * カメラのFOVとオブジェクトまでの距離から、画面の指定割合を占めるスケールを計算する。
   *
   * @param distance オブジェクトまでの距離
   * @param objectSize オブジェクトの現在のサイズ
   * @param screenRatio 画面に対するオブジェクトの割合（デフォルト: 0.15 = 15%）
   * @returns 適用すべきスケール値
   */
  private computeScreenBasedInitialScale(
    distance: number,
    objectSize: number,
    screenRatio: number = 0.15
  ): number {
    if (!this.arRenderer) return 1.0;

    const camera = this.arRenderer.getCamera();
    const fov = camera.fov;

    // 視錐台の高さを計算: visibleHeight = 2 * tan(FOV/2) * distance
    const fovRadians = THREE.MathUtils.degToRad(fov);
    const visibleHeight = 2 * Math.tan(fovRadians / 2) * Math.abs(distance);

    // 画面の指定割合のサイズを計算
    const targetSize = visibleHeight * screenRatio;

    // 現在のオブジェクトサイズに対するスケールを計算
    const scale = targetSize / objectSize;

    console.log(
      `[InitialScale] distance: ${distance.toFixed(2)}, visibleHeight: ${visibleHeight.toFixed(2)}, ` +
        `targetSize: ${targetSize.toFixed(2)}, objectSize: ${objectSize.toFixed(2)}, scale: ${scale.toFixed(2)}`
    );

    return scale;
  }

  /**
   * Phase 2.5 トラッキング機能の初期化
   */
  private initializePhase25Tracking(result: PlaneFittingResult): void {
    // 距離トラッカーを初期化（IMUがあれば静止検出に利用）
    this.distanceTracker = new DistanceTracker({
      minTrackedFrames: 20,
      maxPairs: 15,
      minPairDistance: 80,
      deviceMotionTracker: this.deviceMotionTracker ?? undefined,
      stationaryAccelerationThreshold: 0.3,
      stationaryAngularVelocityThreshold: 5.0,
    });
    this.distanceTracker.setInitialDepth(Math.abs(result.P0.z));

    // Set camera intrinsics for rotation compensation
    const videoWidth = this.video?.videoWidth || 640;
    const videoHeight = this.video?.videoHeight || 480;
    const intrinsics = getCameraIntrinsics(
      this.config.plane.cameraIntrinsics,
      videoWidth,
      videoHeight
    );
    this.distanceTracker.setCameraIntrinsics(intrinsics);
    this.hasPreviousOrientationForScale = false;
    // Note: initialPlaneScale is set in createPlaneFromResult before this method is called

    // 特徴点アンカーを初期化
    this.featureAnchor = new FeatureAnchor({
      maxReprojectionError: 10,
      moderateReprojectionError: 5,
      minTrackingCountForAnchor: 10,
      maxAnchors: 50,
      descriptorMatchInterval: 30,
    });

    // 重力アライナーを初期化
    this.gravityAligner = new GravityAligner({
      horizontalThreshold: 15,
      verticalThreshold: 15,
      gravitySmoothingAlpha: 0.1,
      normalSmoothingAlpha: 0.2,
      forceHorizontalAlignment: true,
      maxCorrectionAnglePerFrame: 5,
    });

    console.log("Phase 2.5 tracking initialized");
  }

  /**
   * 複数の安定特徴点から重み付き重心を計算
   *
   * @param features 特徴点リスト
   * @param minTrackingCount 最小追跡フレーム数
   * @returns 重み付き重心の正規化座標（-1 to 1）、または null
   */
  private computeWeightedCentroid(
    features: InternalFeature[],
    minTrackingCount: number = 5
  ): { x: number; y: number } | null {
    // Use original video dimensions since features are scaled to original coordinates
    const width = this.frameProcessor.getOriginalWidth();
    const height = this.frameProcessor.getOriginalHeight();

    // 安定した特徴点をフィルタリング
    const stableFeatures = features.filter(
      (f) => f.trackingCount >= minTrackingCount
    );

    if (stableFeatures.length === 0) {
      return null;
    }

    // 追跡フレーム数で重み付けした重心を計算
    let weightedX = 0;
    let weightedY = 0;
    let totalWeight = 0;

    for (const feature of stableFeatures) {
      const weight = feature.trackingCount;
      weightedX += feature.x * weight;
      weightedY += feature.y * weight;
      totalWeight += weight;
    }

    if (totalWeight === 0) {
      return null;
    }

    // 重心の正規化座標 (-1 to 1)
    const centroidX = weightedX / totalWeight;
    const centroidY = weightedY / totalWeight;

    return {
      x: (centroidX / width - 0.5) * 2,
      y: -(centroidY / height - 0.5) * 2,
    };
  }

  /**
   * 重心が中央領域内にあるかチェック
   * 中央領域外の場合は平面位置を更新しない（オブジェクトがついてこないようにする）
   *
   * @param centroid 正規化重心座標（-1 to 1）
   * @param thresholdX X方向の閾値（デフォルト: 0.6 = 画面の60%）
   * @param thresholdY Y方向の閾値（デフォルト: 0.6 = 画面の60%）
   * @returns 中央領域内にある場合true
   */
  private isCentroidInCenterRegion(
    centroid: { x: number; y: number },
    thresholdX: number = 0.6,
    thresholdY: number = 0.6
  ): boolean {
    return (
      Math.abs(centroid.x) <= thresholdX && Math.abs(centroid.y) <= thresholdY
    );
  }

  /**
   * IMU無効時: centerFeatureの位置に基づいて平面位置を更新
   * centerFeature（黄色い特徴点）の位置に平面を配置する
   */
  private updateCameraPosition(centerFeature: InternalFeature): void {
    const planeGroup = this.stateManager.getPlaneGroup();
    const planeResult = this.stateManager.getPlaneResult();

    if (!planeResult || !planeGroup) return;

    // ビデオサイズを取得（カメラ内部パラメータ計算に必要）
    const videoWidth = this.video?.videoWidth || 640;
    const videoHeight = this.video?.videoHeight || 480;

    // カメラ内部パラメータを取得（repositionToCenterFeatureと同じ方法）
    const intrinsics = getCameraIntrinsics(
      this.config.plane.cameraIntrinsics,
      videoWidth,
      videoHeight
    );

    // 深度（初期検出時のP0.zを使用）
    const depth = planeResult.P0.z;

    // backProjectPointsと同じロジックで2D→3D変換
    const x = ((centerFeature.x - intrinsics.cx) * depth) / intrinsics.fx;
    const y = -((centerFeature.y - intrinsics.cy) * depth) / intrinsics.fy;
    const z = -depth; // Three.jsの座標系: -Zがカメラの前方

    // ワールド座標に変換（カメラは原点固定）
    const targetPosition = new THREE.Vector3(x, y, z);

    // スムーズに追従
    planeGroup.position.lerp(targetPosition, 0.5);
  }

  /**
   * IMU有効時: centerFeatureの位置から平面のワールド位置を更新
   *
   * centerFeature（黄色い特徴点）の位置を使って平面のワールド座標を補正する。
   * カメラはIMUで回転するが、平面はcenterFeatureに正確に配置される。
   */
  private updatePlaneWorldPosition(
    centerFeature: InternalFeature,
    lerpFactor: number = 0.5
  ): void {
    const camera = this.arRenderer!.getCamera();
    const planeGroup = this.stateManager.getPlaneGroup();
    const planeResult = this.stateManager.getPlaneResult();

    if (!planeResult || !planeGroup) return;

    // ビデオサイズを取得（カメラ内部パラメータ計算に必要）
    const videoWidth = this.video?.videoWidth || 640;
    const videoHeight = this.video?.videoHeight || 480;

    // カメラ内部パラメータを取得（repositionToCenterFeatureと同じ方法）
    const intrinsics = getCameraIntrinsics(
      this.config.plane.cameraIntrinsics,
      videoWidth,
      videoHeight
    );

    // 深度（初期検出時のP0.zを使用）
    const depth = planeResult.P0.z;

    // backProjectPointsと同じロジックで2D→3D変換
    const x = ((centerFeature.x - intrinsics.cx) * depth) / intrinsics.fx;
    const y = -((centerFeature.y - intrinsics.cy) * depth) / intrinsics.fy;
    const z = depth;

    // ワールド座標に変換（Three.jsの座標系: -Zがカメラの前方）
    const targetPosition = camera.localToWorld(new THREE.Vector3(x, y, -z));

    // スムーズに追従（lerpFactorで追従速度を制御）
    planeGroup.position.lerp(targetPosition, lerpFactor);
  }

  /**
   * 再配置時にオブジェクトをcenterFeatureの位置に即座に配置
   * 初期配置時と同じロジック（backProjectPoints + adjustMeshTransform）を使用
   */
  private repositionToCenterFeature(centerFeature: InternalFeature): void {
    const camera = this.arRenderer!.getCamera();
    const planeGroup = this.stateManager.getPlaneGroup();
    const planeResult = this.stateManager.getPlaneResult();

    if (!planeResult || !planeGroup) return;

    // ビデオサイズを取得（カメラ内部パラメータ計算に必要）
    const videoWidth = this.video?.videoWidth || 640;
    const videoHeight = this.video?.videoHeight || 480;

    // カメラ内部パラメータを取得（初期配置時と同じ方法）
    const intrinsics = getCameraIntrinsics(
      this.config.plane.cameraIntrinsics,
      videoWidth,
      videoHeight
    );

    // 深度（初期検出時のP0.zを使用）
    const depth = planeResult.P0.z;

    // backProjectPointsと同じロジックで2D→3D変換
    // x = ((point.x - cx) * z) / fx
    // y = -((point.y - cy) * z) / fy （Y軸反転）
    const x = ((centerFeature.x - intrinsics.cx) * depth) / intrinsics.fx;
    const y = -((centerFeature.y - intrinsics.cy) * depth) / intrinsics.fy;
    const z = depth;

    // adjustMeshTransformと同じロジックでワールド座標に変換
    // Three.jsの座標系: -Zがカメラの前方なので、深度値を負にする
    const p0WS = camera.localToWorld(new THREE.Vector3(x, y, -z));

    console.log("[Reposition] centerFeature:", centerFeature.x, centerFeature.y);
    console.log("[Reposition] intrinsics:", intrinsics);
    console.log("[Reposition] depth:", depth);
    console.log("[Reposition] backProjected (x,y,z):", x, y, z);
    console.log("[Reposition] worldPosition:", p0WS.x, p0WS.y, p0WS.z);

    // 即座に配置（lerpなし）
    planeGroup.position.copy(p0WS);
  }

  /**
   * レンダリングループ
   * ARレンダリングを実行
   * Frame rate is limited to targetFPS (default: 30fps) to reduce memory pressure
   */
  public render(): void {
    const currentTime = performance.now();
    const elapsed = currentTime - this.lastFrameTime;

    // Schedule next frame first
    this.animationFrameId = requestAnimationFrame(() => this.render());

    // Skip frame if not enough time has passed (frame rate limiting)
    if (elapsed < this.frameInterval) {
      return;
    }
    this.lastFrameTime = currentTime - (elapsed % this.frameInterval);

    // Periodic memory reset check
    if (currentTime - this.lastMemoryResetTime > this.memoryResetInterval) {
      this.performMemoryReset();
      this.lastMemoryResetTime = currentTime;
    }

    this.stageProfiler.beginFrame();

    // IMUトラッキングが有効な場合、カメラの姿勢を更新
    if (this.imuTrackingEnabled && this.deviceMotionTracker?.isTracking()) {
      this.stageProfiler.measure("imu", () => this.updateCameraFromIMU());
    }

    // centerFeatureがnull、または全特徴点が失われている場合、Frustum判定で再検出をトリガー
    if (this.frameProcessor.isReady() && this.stateManager.isPlaneDetected()) {
      const currentCenterFeature = this.frameProcessor.getCenterFeature();
      if (this.frameProcessor.hasLostFeatures() || !currentCenterFeature) {
        this.checkFrustumForRedetection();
      }
    }

    // 常に特徴点検出は実行（カメラ映像の更新のため）
    if (this.frameProcessor.isReady()) {
      this.stageProfiler.measure("featureDetection", () =>
        this.frameProcessor.renderFeatures()
      );

      // フレーム処理イベントを発火
      const features = this.frameProcessor.getFeatures() || [];
      const centerFeature = this.frameProcessor.getCenterFeature();

      const mapToAPIFeature = (f: InternalFeature, index: number): APIFeature => ({
        point: { u: f.x, v: f.y },
        quality: f.score ?? 0.5,
        trackingCount: f.trackingCount,
        id: f.id || `feature_${index}`,
      });

      const frameData: FrameData = {
        features: features.map((f, index) => mapToAPIFeature(f, index)),
        centerFeature: centerFeature
          ? mapToAPIFeature(centerFeature, 0)
          : null,
        depthMap: null, // getDepthMapは非同期なので、ここでは省略
        timestamp: Date.now(),
      };
      this.emit("frame:processed", frameData);

      this.stageProfiler.beginStage("tracking");

      // 6DoFカメラトラッキング（有効時）: ランドマークマップに対する
      // RANSAC PnPでカメラ姿勢を推定し、レンダリングカメラへ反映する。
      // トラッキング成功時は視覚姿勢がIMU姿勢を上書きし、lost時はIMUが
      // フォールバックとして働く
      let cameraTrackerStatus: CameraTrackerStatus | null = null;
      if (this.cameraTracker) {
        // OpenCV.jsは数値/ポインタをthrowするため、例外でフレームループの
        // 後続処理（状態機械更新やendFrame）を巻き込まないよう隔離する
        try {
          const trackerResult = this.cameraTracker.update(
            features,
            currentTime,
            this.buildSixDofDepthPriors(features)
          );
          cameraTrackerStatus = trackerResult.status;
          if (trackerResult.status === "tracking" && trackerResult.pose) {
            this.applySixDofPose(trackerResult.pose);
          }
        } catch (error) {
          cameraTrackerStatus = "lost";
          if (!this.sixDofErrorLogged) {
            this.sixDofErrorLogged = true;
            console.error("6DoF camera tracking failed:", error);
          }
        }
      }

      // Phase 2: ドリフト補正器に特徴点情報を更新（IMU有効時も継続）
      if (this.driftCorrector && features.length > 0) {
        this.updateDriftCorrector(features);
      }

      // Phase 2.5: トラッキング品質改善機能を更新
      if (this.stateManager.isPlaneDetected() && features.length > 0) {
        this.updatePhase25Tracking(features);
      }

      // 特徴点品質モニターを更新
      let qualityState = FeatureQualityState.RICH;
      if (this.featureQualityMonitor && this.stateManager.isPlaneDetected()) {
        const previousState = this.featureQualityMonitor.getState();
        qualityState = this.featureQualityMonitor.update(features);

        if (previousState !== qualityState) {
          if (
            qualityState === FeatureQualityState.DROUGHT &&
            this.planeModelPersistence
          ) {
            const planeGroup = this.stateManager.getPlaneGroup();
            if (planeGroup) {
              planeGroup.getWorldPosition(this.reusablePlaneCenter);
              this.planeModelPersistence.lockPosition(
                this.reusablePlaneCenter
              );
            }
          } else if (
            previousState === FeatureQualityState.DROUGHT &&
            this.planeModelPersistence
          ) {
            this.planeModelPersistence.startRecovery();
          }
        }
      }

      // 平面が検出済みの場合、品質状態に応じて位置更新を制御
      if (this.stateManager.isPlaneDetected()) {
        if (this.pendingReposition && centerFeature) {
          this.repositionToCenterFeature(centerFeature);
          this.pendingReposition = false;
        } else if (qualityState === FeatureQualityState.DROUGHT) {
          // DROUGHT: 特徴点ベースの更新をスキップし、平面位置をロック
          if (this.planeModelPersistence) {
            this.planeModelPersistence.updateDuringDrought();
          }
        } else if (features.length > 0 && centerFeature) {
          if (this.imuTrackingEnabled) {
            const baseLerpFactor =
              this.planeModelPersistence?.getLerpFactor(qualityState) ?? 0.5;
            let lerpFactor = baseLerpFactor;

            if (this.planeModelPersistence?.isRecovering()) {
              this.planeModelPersistence.updateRecovery();
              lerpFactor *=
                this.planeModelPersistence.getRecoveryBlendFactor();
            }

            this.updatePlaneWorldPosition(centerFeature, lerpFactor);
          } else {
            this.updateCameraPosition(centerFeature);
          }
        }
      }

      this.stageProfiler.endStage("tracking");
      this.updateTrackingStateMachine(
        centerFeature,
        qualityState,
        cameraTrackerStatus
      );
    }

    if (this.arRenderer) {
      this.stageProfiler.measure("render", () => this.arRenderer!.render());
    }

    this.stageProfiler.endFrame();
  }

  /**
   * 毎フレームの観測に基づいてトラッキング状態機械を更新
   *
   * 既存のシグナル（平面検出、特徴点喪失、特徴点品質）と6DoFトラッカーの
   * 状態を明示的なトラッキング状態に写像する。復帰系の挙動は今後この
   * 状態を参照する。
   */
  private updateTrackingStateMachine(
    centerFeature: InternalFeature | null,
    qualityState: FeatureQualityState,
    cameraTrackerStatus: CameraTrackerStatus | null = null
  ): void {
    const machine = this.trackingStateMachine;

    if (cameraTrackerStatus === "initializing") {
      machine.transition("initializing", "bootstrapping 6DoF landmark map");
      return;
    }
    if (cameraTrackerStatus === "lost") {
      if (this.pendingReposition) {
        machine.transition(
          "relocalizing",
          "redetection triggered by frustum check"
        );
      } else {
        machine.transition("lost", "6DoF camera tracking lost");
      }
      return;
    }

    if (cameraTrackerStatus === null) {
      if (!this.stateManager.isPlaneDetected()) {
        machine.transition("initializing", "waiting for plane detection");
        return;
      }

      const featuresLost =
        this.frameProcessor.hasLostFeatures() || !centerFeature;
      if (featuresLost) {
        if (this.pendingReposition) {
          machine.transition(
            "relocalizing",
            "redetection triggered by frustum check"
          );
        } else {
          machine.transition("lost", "tracked features lost");
        }
        return;
      }
    }

    if (qualityState === FeatureQualityState.DROUGHT) {
      machine.transition("frozen", "feature drought: plane position locked");
    } else if (qualityState === FeatureQualityState.POOR) {
      machine.transition("degraded", "low stable feature count");
    } else {
      machine.transition("tracking", "stable features tracked");
    }
  }

  /**
   * 6DoFカメラトラッカーを初期化
   *
   * PoseEstimator / Triangulator / PnPSolver をフル解像度の内部パラメータで
   * 構築し、ランドマークマップとゲート付き初期化器に接続する。
   */
  private initializeCameraTracker(): void {
    if (!this.video) return;

    const intrinsics = getCameraIntrinsics(
      this.config.plane.cameraIntrinsics,
      this.video.videoWidth,
      this.video.videoHeight
    );

    const poseEstimator = new PoseEstimator(cv, intrinsics);
    const triangulator = new Triangulator(cv, intrinsics);
    const pnpSolver = new PnPSolver(cv, intrinsics);
    // Small window and iteration budget: this runs inside the frame loop
    // (throttled to every few keyframes), not on a worker
    const bundleAdjustment = new LocalBundleAdjustment(intrinsics, {
      windowSize: 5,
      maxIterations: 3,
    });
    this.sixDofComponents = [
      poseEstimator,
      triangulator,
      pnpSolver,
      bundleAdjustment,
    ];

    const mapInitializer = new MapInitializer(
      { poseEstimator, triangulator, intrinsics },
      { minCorrespondences: this.config.tracking.minCorrespondences }
    );

    this.cameraTracker = new CameraTracker(
      {
        mapInitializer,
        landmarkMap: new LandmarkMap(),
        pnpSolver,
        triangulator,
        bundleAdjustment,
      },
      {
        minReferenceFeatures: this.config.tracking.minCorrespondences,
        minTrackedCorrespondences:
          this.config.tracking.minTrackedCorrespondences,
      }
    );

    console.log("6DoF camera tracker initialized");
  }

  /**
   * 6DoF姿勢をレンダリングカメラへ適用（OpenCV基底 → Three.js基底に変換）
   */
  private applySixDofPose(pose: CameraPose): void {
    if (!this.arRenderer) return;

    const camera = this.arRenderer.getCamera();
    const { position, quaternion } = cameraPoseToThreeJs(pose);
    camera.position.copy(position);
    camera.quaternion.copy(quaternion);
  }

  /**
   * 6DoF初期化用の深度事前情報を構築
   *
   * ニューラル深度マップを低頻度で非同期取得してキャッシュし、特徴点ごとに
   * 空間平滑化サンプリングした値を事前情報とする。深度マップが未取得の間は
   * 検出済み平面の深度（P0.z）を粗いフォールバックとして使う。
   */
  private buildSixDofDepthPriors(
    features: InternalFeature[]
  ): Map<string, number> | undefined {
    if (!this.cameraTracker || this.cameraTracker.isInitialized()) {
      return undefined;
    }

    this.refreshSixDofDepthMapCache();

    this.reusableDepthPriors.clear();

    if (this.sixDofDepthMapCache) {
      const sampledPoints = sampleDepthAtFeaturePoints({
        featurePoints: features,
        depthMap: this.sixDofDepthMapCache,
        mapWidth: this.frameProcessor.getCanvasWidth(),
        mapHeight: this.frameProcessor.getCanvasHeight(),
        featureWidth: this.frameProcessor.getOriginalWidth(),
        featureHeight: this.frameProcessor.getOriginalHeight(),
      });
      for (const point of sampledPoints) {
        if (point.z > 0) {
          this.reusableDepthPriors.set(point.id, point.z);
        }
      }
      if (this.reusableDepthPriors.size > 0) {
        return this.reusableDepthPriors;
      }
    }

    // Fallback: coarse constant prior from the detected plane depth
    const planeResult = this.stateManager.getPlaneResult();
    if (!planeResult) {
      return undefined;
    }
    const depth = Math.abs(planeResult.P0.z);
    if (depth <= 0) {
      return undefined;
    }
    for (const feature of features) {
      this.reusableDepthPriors.set(feature.id, depth);
    }
    return this.reusableDepthPriors;
  }

  /**
   * 6DoF初期化用の深度マップキャッシュを低頻度で更新
   *
   * 深度推論は重いため、トラッカーが未初期化の間だけ一定間隔で非同期に
   * 取得する。フレームループはブロックしない。
   */
  private refreshSixDofDepthMapCache(): void {
    const now = performance.now();
    if (
      this.sixDofDepthMapFetching ||
      now - this.sixDofDepthMapFetchedAt < this.sixDofDepthMapRefreshInterval
    ) {
      return;
    }

    this.sixDofDepthMapFetching = true;
    this.frameProcessor
      .getDepthMap()
      .then((depthMap) => {
        if (depthMap) {
          this.sixDofDepthMapCache = depthMap;
        }
      })
      .catch(() => {
        // Depth priors are optional; keep the previous cache or fallback
      })
      .finally(() => {
        this.sixDofDepthMapFetching = false;
        this.sixDofDepthMapFetchedAt = performance.now();
      });
  }

  /**
   * Perform periodic memory reset to prevent memory buildup
   * Clears caches and resets internal state while preserving tracking
   */
  private performMemoryReset(): void {
    console.log("Performing periodic memory reset...");

    // Clear reusable depth3D points Map
    this.reusableDepth3DPoints.clear();

    // Reset drift corrector while keeping stable features
    if (this.driftCorrector) {
      this.driftCorrector.forceReset();
    }

    // Reset complementary filter state
    if (this.complementaryFilter) {
      this.complementaryFilter.reset();
    }

    // Reset distance tracker scale measurements
    if (this.distanceTracker) {
      this.distanceTracker.reset();
      // Restore initial depth if plane is detected
      const planeResult = this.stateManager.getPlaneResult();
      if (planeResult) {
        this.distanceTracker.setInitialDepth(Math.abs(planeResult.P0.z));
      }
    }

    // Clear feature anchor old entries
    if (this.featureAnchor) {
      this.featureAnchor.clearInvalidAnchors();
    }

    // Clear gravity aligner smoothing state
    if (this.gravityAligner) {
      this.gravityAligner.reset();
    }

    // Reset feature quality monitor and plane model persistence
    if (this.featureQualityMonitor) {
      this.featureQualityMonitor.reset();
    }
    if (this.planeModelPersistence) {
      this.planeModelPersistence.reset();
    }

    // Request garbage collection hint (if available)
    if (typeof (globalThis as { gc?: () => void }).gc === "function") {
      (globalThis as { gc: () => void }).gc();
    }

    console.log("Memory reset complete");
  }

  // Frustum判定用のキャッシュ（毎フレーム new を避ける）
  private readonly frustum = new THREE.Frustum();
  private readonly frustumMatrix = new THREE.Matrix4();
  private frustumDebugOverlay: HTMLDivElement | null = null;

  /**
   * Frustum判定でARオブジェクトが画角内にあるかチェックし、再検出をトリガー
   * centerFeatureがnullでオブジェクトが中央60%×60%の領域にあれば再検出を許可
   */
  private checkFrustumForRedetection(): void {
    try {
      // デバッグオーバーレイを初期化
      if (!this.frustumDebugOverlay) {
        this.frustumDebugOverlay = document.createElement("div");
        this.frustumDebugOverlay.style.cssText = `
          position: fixed;
          top: 80px;
          left: 10px;
          background: rgba(0,0,0,0.7);
          color: #ff0;
          font-family: monospace;
          font-size: 14px;
          padding: 10px;
          border-radius: 5px;
          z-index: 9999;
          pointer-events: none;
        `;
        document.body.appendChild(this.frustumDebugOverlay);
      }

      if (!this.arRenderer) {
        this.frustumDebugOverlay.innerHTML = "Frustum: No renderer";
        return;
      }

      const planeGroup = this.stateManager.getPlaneGroup();
      if (!planeGroup) {
        this.frustumDebugOverlay.innerHTML = "Frustum: No planeGroup";
        return;
      }

      const camera = this.arRenderer.getCamera();
      if (!camera) {
        this.frustumDebugOverlay.innerHTML = "Frustum: No camera";
        return;
      }

      // カメラとオブジェクトの行列を更新
      camera.updateMatrixWorld();
      planeGroup.updateMatrixWorld();

      // Frustum を更新
      this.frustumMatrix.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse
      );
      this.frustum.setFromProjectionMatrix(this.frustumMatrix);

      // planeGroup のワールド位置を取得して Frustum 内にあるかチェック
      const planePosition = new THREE.Vector3();
      planeGroup.getWorldPosition(planePosition);
      const isInFrustum = this.frustum.containsPoint(planePosition);

      // スクリーン座標に変換（NDC: -1 to 1）
      const screenPosition = planePosition.clone().project(camera);

      // 中央領域の判定（横60%×縦60%）
      // NDC座標系: 60% → ±0.3
      const centerThreshold = 0.3; // 60% / 2 = 0.3
      const isInCenterRegion =
        Math.abs(screenPosition.x) <= centerThreshold &&
        Math.abs(screenPosition.y) <= centerThreshold;

      // デバッグ表示
      this.frustumDebugOverlay.innerHTML = [
        `Frustum: ${isInFrustum ? "IN VIEW" : "OUT OF VIEW"}`,
        `Center: ${isInCenterRegion ? "YES" : "NO"} (${screenPosition.x.toFixed(2)}, ${screenPosition.y.toFixed(2)})`,
      ].join("<br>");

      if (isInFrustum && isInCenterRegion) {
        // オブジェクトが画角内かつ中央領域にあれば再検出を許可
        this.frustumDebugOverlay.innerHTML += "<br><b>→ REDETECT!</b>";

        // オブジェクト原点のスクリーン座標をターゲットとして設定
        // NDC座標（-1 to 1）をピクセル座標に変換
        const canvasWidth = this.frameProcessor.getCanvasWidth();
        const canvasHeight = this.frameProcessor.getCanvasHeight();
        const targetX = ((screenPosition.x + 1) / 2) * canvasWidth;
        const targetY = ((1 - screenPosition.y) / 2) * canvasHeight; // Y軸反転
        this.frameProcessor.setTargetPosition(targetX, targetY);

        this.frameProcessor.allowRedetection();
        this.pendingReposition = true; // 再配置待ちフラグを設定
      }
    } catch (error) {
      if (this.frustumDebugOverlay) {
        this.frustumDebugOverlay.innerHTML = `Frustum: Error - ${error}`;
      }
    }
  }

  /**
   * IMUからカメラの姿勢を更新（Phase 2: 相補フィルタ対応）
   */
  private updateCameraFromIMU(): void {
    if (!this.deviceMotionTracker || !this.arRenderer) return;

    const imuOrientation = this.deviceMotionTracker.getOrientation();
    if (!imuOrientation) return;

    const camera = this.arRenderer.getCamera();

    // Phase 2: 相補フィルタで視覚情報と融合
    if (this.complementaryFilter && this.driftCorrector) {
      let visualConfidence = this.driftCorrector.getVisualConfidence();

      // 特徴点品質状態に応じてIMU依存度を調整
      if (this.featureQualityMonitor) {
        const state = this.featureQualityMonitor.getState();
        if (state === FeatureQualityState.DROUGHT) {
          visualConfidence = 0;
        } else if (state === FeatureQualityState.POOR) {
          visualConfidence *= 0.3;
        }
      }

      // 相補フィルタで融合（視覚姿勢は現時点ではnull - 将来的に視覚からの姿勢推定を追加）
      const fusedOrientation = this.complementaryFilter.fuse(
        imuOrientation,
        null,
        visualConfidence
      );

      camera.quaternion.copy(fusedOrientation);

      // ドリフト補正チェック
      if (this.driftCorrector.shouldCorrect()) {
        const visualReference = this.driftCorrector.computeVisualReference();
        this.driftCorrector.correctDrift(fusedOrientation, visualReference);
      }
    } else {
      // フォールバック: 相補フィルタなしの場合はIMUのみ使用
      camera.quaternion.copy(imuOrientation);
    }

    // デバッグ: IMU姿勢更新を確認
    if (this.showIMUDebug) {
      const q = camera.quaternion;
      const stats = this.driftCorrector?.getStatistics();
      console.log(
        `IMU: q(${q.x.toFixed(3)}, ${q.y.toFixed(3)}, ${q.z.toFixed(3)}, ${q.w.toFixed(3)}) ` +
          `stable:${stats?.stableFeatures ?? 0} conf:${stats?.averageConfidence.toFixed(2) ?? 0}`
      );
    }
  }

  /**
   * Get or create a reusable Vector3 from pool
   */
  private getPooledVector3(index: number): THREE.Vector3 {
    if (!this.reusableVector3Pool[index]) {
      this.reusableVector3Pool[index] = new THREE.Vector3();
    }
    return this.reusableVector3Pool[index];
  }

  /**
   * ドリフト補正器に特徴点情報を更新
   * Note: Uses reusable objects to prevent GC pressure
   */
  private updateDriftCorrector(features: InternalFeature[]): void {
    if (!this.driftCorrector) return;

    // Reuse Map instead of creating new one
    this.reusableDepth3DPoints.clear();

    // Use original dimensions since features are scaled to original coordinates
    const width = this.frameProcessor.getOriginalWidth() || 640;
    const height = this.frameProcessor.getOriginalHeight() || 480;

    // フレームプロセッサから深度マップを取得して3D位置を計算
    const planeGroup = this.stateManager.getPlaneGroup();
    if (planeGroup) {
      // 平面の中心位置を基準として特徴点の3D位置を推定
      planeGroup.getWorldPosition(this.reusablePlaneCenter);

      for (let i = 0; i < features.length; i++) {
        const feature = features[i];
        // 簡易的な3D位置推定（平面上にあると仮定）
        const normalizedX = (feature.x / width - 0.5) * 2;
        const normalizedY = (feature.y / height - 0.5) * 2;

        // Use pooled Vector3 instead of creating new one
        const position3D = this.getPooledVector3(i);
        position3D.set(
          this.reusablePlaneCenter.x + normalizedX * 0.5,
          this.reusablePlaneCenter.y - normalizedY * 0.5,
          this.reusablePlaneCenter.z
        );

        this.reusableDepth3DPoints.set(feature.id, position3D);
      }
    }

    this.driftCorrector.updateFeatures(features, this.reusableDepth3DPoints);
  }

  /**
   * Phase 2.5 トラッキング機能を更新
   * 重心が中央領域外の場合は更新しない（オブジェクトがついてこない）
   */
  private updatePhase25Tracking(features: InternalFeature[]): void {
    const planeGroup = this.stateManager.getPlaneGroup();
    const planeResult = this.stateManager.getPlaneResult();

    if (!planeGroup || !planeResult) return;

    // 重心が中央領域外の場合は更新をスキップ
    const centroid = this.computeWeightedCentroid(features);
    if (!centroid || !this.isCentroidInCenterRegion(centroid)) {
      return;
    }

    // 1. 距離トラッカーを更新してスケールを計算
    if (this.distanceTracker) {
      // Compute rotation delta from IMU for rotation compensation
      if (this.deviceMotionTracker?.isTracking()) {
        const currentOrientation = this.deviceMotionTracker.getOrientation();
        if (currentOrientation) {
          if (this.hasPreviousOrientationForScale) {
            // delta = inverse(previous) * current
            this.reusableRotationDelta
              .copy(this.previousOrientationForScale)
              .invert()
              .multiply(currentOrientation);
            this.distanceTracker.setRotationDelta(
              this.reusableRotationDelta
            );
          }
          this.previousOrientationForScale.copy(currentOrientation);
          this.hasPreviousOrientationForScale = true;
        }
      }

      const scale = this.distanceTracker.update(features);
      const targetScale = scale * this.initialPlaneScale;
      planeGroup.scale.set(targetScale, targetScale, targetScale);

      // 特徴点の描画サイズもスケールに連動
      this.frameProcessor.setFeatureScale(scale);
    }

    // 2. 特徴点アンカーを更新
    if (this.featureAnchor) {
      // Use original dimensions since features are scaled to original coordinates
      const width = this.frameProcessor.getOriginalWidth();
      const height = this.frameProcessor.getOriginalHeight();

      const get3DPosition = (feature: InternalFeature): THREE.Vector3 | null => {
        // 平面上の3D位置を推定 - reuse planeCenter
        planeGroup.getWorldPosition(this.reusablePlaneCenter);

        const normalizedX = (feature.x / width - 0.5) * 2;
        const normalizedY = -(feature.y / height - 0.5) * 2;

        // Reuse position3D vector
        this.reusablePosition3D.set(
          this.reusablePlaneCenter.x + normalizedX * 0.5,
          this.reusablePlaneCenter.y + normalizedY * 0.5,
          this.reusablePlaneCenter.z
        );
        return this.reusablePosition3D;
      };

      this.featureAnchor.updateAnchors(features, get3DPosition);
    }

    // 3. 重力アライナーを更新（IMU有効時のみ）
    if (this.gravityAligner && this.deviceMotionTracker?.isTracking()) {
      const gravity = this.deviceMotionTracker.getGravityVector();
      if (gravity) {
        // IMUからの重力ベクトルを更新
        this.gravityAligner.updateGravity(gravity);

        // 平面の法線を重力に合わせて補正 - reuse planeNormal
        this.reusablePlaneNormal.copy(planeResult.normal);
        const alignment = this.gravityAligner.alignPlaneNormal(
          this.reusablePlaneNormal
        );

        // 補正済みの法線から目標のquaternionを計算
        const correctedNormal = alignment.correctedNormal;

        // PlaneGeometryはデフォルトでZ+方向を向いているので、
        // その法線を補正済み法線に向けるquaternionを計算 - reuse objects
        this.reusableTargetQuaternion.setFromUnitVectors(
          this.reusableDefaultNormal,
          correctedNormal
        );

        // 現在のquaternionから目標に向かってslerp
        planeGroup.quaternion.slerp(this.reusableTargetQuaternion, 0.1);
      }
    }
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
          listener(...(args as unknown as never[]));
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
    this.trackingStateMachine.reset();
    this.stageProfiler.reset();
    this.cameraTracker?.reset();
    return this;
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

    // デバイスモーショントラッカーを解放
    if (this.deviceMotionTracker) {
      this.deviceMotionTracker.dispose();
      this.deviceMotionTracker = null;
    }

    // Phase 2: 相補フィルタとドリフト補正器を解放
    if (this.complementaryFilter) {
      this.complementaryFilter.dispose();
      this.complementaryFilter = null;
    }
    if (this.driftCorrector) {
      this.driftCorrector.dispose();
      this.driftCorrector = null;
    }

    // Phase 2.5: トラッキング品質改善機能を解放
    if (this.distanceTracker) {
      this.distanceTracker.dispose();
      this.distanceTracker = null;
    }
    if (this.featureAnchor) {
      this.featureAnchor.dispose();
      this.featureAnchor = null;
    }
    if (this.gravityAligner) {
      this.gravityAligner.dispose();
      this.gravityAligner = null;
    }
    if (this.featureQualityMonitor) {
      this.featureQualityMonitor.dispose();
      this.featureQualityMonitor = null;
    }
    if (this.planeModelPersistence) {
      this.planeModelPersistence.dispose();
      this.planeModelPersistence = null;
    }

    // トラッキング状態機械とプロファイラを解放
    this.trackingStateMachine.dispose();
    this.stageProfiler.reset();

    // 6DoFカメラトラッカーとOpenCV依存コンポーネントを解放
    if (this.cameraTracker) {
      this.cameraTracker.dispose();
      this.cameraTracker = null;
    }
    this.sixDofComponents.forEach((component) => component.dispose());
    this.sixDofComponents = [];

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
    const statistics = this.stageProfiler.getStatistics();
    const memory = (
      performance as Performance & { memory?: { usedJSHeapSize: number } }
    ).memory;

    return {
      fps: statistics.fps,
      featureDetectionTime:
        statistics.stages["featureDetection"]?.averageMs ?? 0,
      depthEstimationTime: statistics.stages["depthEstimation"]?.averageMs ?? 0,
      planeFittingTime: statistics.stages["planeFitting"]?.averageMs ?? 0,
      memoryUsage: memory ? memory.usedJSHeapSize / (1024 * 1024) : 0,
    };
  }

  /**
   * ステージ別のフレームバジェット統計を取得
   *
   * 各処理ステージ（imu / featureDetection / tracking / render / planeFitting）の
   * 移動平均・最大値と、フレームバジェット超過率を返します。
   */
  public getFrameBudgetStatistics(): FrameBudgetStatistics {
    return this.stageProfiler.getStatistics();
  }

  /**
   * 現在のトラッキング状態を取得
   *
   * 平面検出前は "initializing"、通常追跡中は "tracking"、
   * 特徴点品質低下時は "degraded"、特徴点枯渇時は "frozen"、
   * 特徴点喪失時は "lost"、再検出中は "relocalizing" を返します。
   */
  public getTrackingState(): TrackingState {
    return this.trackingStateMachine.getState();
  }

  /**
   * 6DoFカメラトラッキングの統計を取得
   *
   * 6DoFトラッキングが無効の場合はnullを返します。
   */
  public getSixDofTrackingStatistics(): {
    isInitialized: boolean;
    landmarks: ReturnType<LandmarkMap["getStatistics"]>;
  } | null {
    if (!this.cameraTracker) {
      return null;
    }
    return {
      isInitialized: this.cameraTracker.isInitialized(),
      landmarks: this.cameraTracker.getLandmarkMap().getStatistics(),
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
   * 特徴点描画の有効/無効を設定
   *
   * @param enabled - 有効にする場合true、無効にする場合false
   * @returns SPALAMインスタンス（メソッドチェーン用）
   */
  public setDrawFeaturesEnabled(enabled: boolean): SPALAM {
    this.frameProcessor.setDrawFeaturesEnabled(enabled);
    return this;
  }

  /**
   * 特徴点描画が有効かどうかを取得
   */
  public isDrawFeaturesEnabled(): boolean {
    return this.frameProcessor.isDrawFeaturesEnabled();
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

  /**
   * IMUトラッキングを有効化
   *
   * デバイスのIMU（加速度計・ジャイロスコープ）を使用して
   * カメラの姿勢をリアルタイムで更新します。
   *
   * @returns Promise<boolean> - 初期化成功時はtrue
   *
   * @example
   * ```typescript
   * const success = await spalam.enableIMUTracking();
   * if (success) {
   *   console.log('IMUトラッキングが有効になりました');
   * }
   * ```
   */
  public async enableIMUTracking(): Promise<boolean> {
    if (this.deviceMotionTracker) {
      this.imuTrackingEnabled = true;
      return true;
    }

    this.deviceMotionTracker = new DeviceMotionTracker();

    // Phase 2: 相補フィルタとドリフト補正器を初期化
    this.complementaryFilter = new ComplementaryFilter({
      alpha: 0.98,
      minVisualConfidence: 0.3,
      smoothingFactor: 0.1,
    });

    this.driftCorrector = new DriftCorrector({
      resetIntervalMs: 1000,
      minTrackedFrames: 10,
      maxStableFeatures: 50,
    });

    this.featureQualityMonitor = new FeatureQualityMonitor();
    this.planeModelPersistence = new PlaneModelPersistence();

    this.deviceMotionTracker.addListener((event: DeviceMotionTrackerEvent) => {
      if (event.type === "stateChange") {
        console.log("IMU state changed:", event.state);
        this.emit("imu:stateChange", event);
      } else if (event.type === "orientationUpdate") {
        // 姿勢データを受信したらトラッキングを有効化
        if (!this.imuTrackingEnabled) {
          this.imuTrackingEnabled = true;
          // 平面の回転をIMU座標系に変換（一度だけ）
          this.adjustPlaneRotationForIMU();
          console.log("IMU tracking enabled (orientation data received)");
        }
      } else if (event.type === "error") {
        console.error("IMU tracking error:", event.error);
      }
    });

    const initialized = await this.deviceMotionTracker.initialize();

    if (initialized) {
      // キャリブレーション完了を待たずに、権限が得られたらすぐに有効化
      // orientationUpdateイベントで最終的に有効化される
      console.log("IMU permission granted, waiting for orientation data...");

      // 短いタイムアウトで最初のイベントを待つ
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (this.imuTrackingEnabled) {
        console.log("IMU tracking enabled with Visual-Inertial Fusion");
        return true;
      }

      // まだ有効化されていなくても、権限があれば成功とみなす
      this.imuTrackingEnabled = true;
      console.log("IMU tracking enabled (permission granted)");
      return true;
    }

    console.warn("IMU tracking initialization failed");
    return false;
  }

  /**
   * IMU有効化時に平面の回転を調整
   *
   * 平面は検出時にカメラ回転=identityを前提に設定されている。
   * IMU有効化時に実際のカメラ回転（IMU姿勢）を適用して、
   * 平面が画面上で同じ向きに見えるように調整する。
   */
  private adjustPlaneRotationForIMU(): void {
    if (!this.deviceMotionTracker || !this.arRenderer) return;

    const planeGroup = this.stateManager.getPlaneGroup();
    if (!planeGroup) return;

    const imuOrientation = this.deviceMotionTracker.getOrientation();
    if (!imuOrientation) return;

    // 平面の回転をIMU座標系に変換
    // 元の回転: R_plane（カメラがidentityの時に設定）
    // IMU回転: R_imu
    // 新しい回転: R_imu * R_plane
    // これにより、IMUで回転したカメラから見た時に同じ向きに見える
    const currentQuaternion = planeGroup.quaternion.clone();
    const newQuaternion = imuOrientation.clone().multiply(currentQuaternion);

    planeGroup.quaternion.copy(newQuaternion);

    console.log("Plane rotation adjusted for IMU");
  }

  /**
   * IMUトラッキングを無効化
   *
   * @returns SPALAMインスタンス（メソッドチェーン用）
   */
  public disableIMUTracking(): SPALAM {
    this.imuTrackingEnabled = false;
    return this;
  }

  /**
   * IMUトラッキングが有効かどうかを取得
   */
  public isIMUTrackingEnabled(): boolean {
    return this.imuTrackingEnabled;
  }

  /**
   * IMUトラッキングが動作中かどうかを取得
   */
  public isIMUTracking(): boolean {
    return (
      this.imuTrackingEnabled && this.deviceMotionTracker?.isTracking() === true
    );
  }

  /**
   * デバイスモーショントラッカーを取得
   */
  public getDeviceMotionTracker(): DeviceMotionTracker | null {
    return this.deviceMotionTracker;
  }

  /**
   * IMUデバッグ表示を有効化/無効化
   */
  public setIMUDebug(enabled: boolean): SPALAM {
    this.showIMUDebug = enabled;
    return this;
  }

  /**
   * IMU初期化の進捗を取得
   */
  public getIMUInitializationProgress(): number {
    if (!this.deviceMotionTracker) return 0;
    return this.deviceMotionTracker.getIMUInitializer().getProgress();
  }

  /**
   * ドリフト統計を取得
   */
  public getIMUDriftStatistics(): ReturnType<
    DeviceMotionTracker["getDriftStatistics"]
  > | null {
    if (!this.deviceMotionTracker) return null;
    return this.deviceMotionTracker.getDriftStatistics();
  }

  /**
   * ドリフト計測をリセット
   */
  public resetIMUDriftMeasurement(): SPALAM {
    this.deviceMotionTracker?.resetDriftMeasurement();
    return this;
  }

  /**
   * Phase 2.5: トラッキング品質統計を取得
   *
   * 距離追跡、特徴点アンカー、重力アライメントの統計情報を返す
   */
  public getTrackingQualityStatistics(): {
    distanceTracker: ReturnType<DistanceTracker["getStatistics"]> | null;
    featureAnchor: ReturnType<FeatureAnchor["getStatistics"]> | null;
    gravityAligner: ReturnType<GravityAligner["getStatistics"]> | null;
  } {
    return {
      distanceTracker: this.distanceTracker?.getStatistics() ?? null,
      featureAnchor: this.featureAnchor?.getStatistics() ?? null,
      gravityAligner: this.gravityAligner?.getStatistics() ?? null,
    };
  }

  /**
   * Phase 2.5: 現在の平面スケールを取得
   */
  public getPlaneScale(): number {
    return this.distanceTracker?.getScale() ?? 1.0;
  }

  /**
   * Phase 2.5: 特徴点アンカーの数を取得
   */
  public getAnchorCount(): { total: number; valid: number } {
    const stats = this.featureAnchor?.getStatistics();
    return {
      total: stats?.totalAnchors ?? 0,
      valid: stats?.validAnchors ?? 0,
    };
  }
}

// デフォルトエクスポート（後方互換性）
export default SPALAM;

// 名前付きエクスポート
export type { SPALAMState } from "./services/StateManager";
export type { SPALAMConfig } from "./config/types";

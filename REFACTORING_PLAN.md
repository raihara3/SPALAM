# SPALAM リファクタリングプラン

## 概要

SPALAM プロジェクトを JavaScript ライブラリとして公開するための適切なクラス設計とコード構造への変更計画です。現在のコードは機能的に動作していますが、責任分離、可読性、保守性、拡張性の観点から改善が必要です。

## 現在の問題点

### 1. 構造上の問題

- **メインクラス肥大化**: `SPALAM.ts`が 470 行となり、複数の責任を持っている
- **ヘルパー関数散在**: `helpers/`ディレクトリに関連する機能がバラバラに配置
- **責任分離不明確**: 各クラスの役割と境界が曖昧
- **型定義分散**: 各機能で使用される型が十分に統合されていない

### 2. API 設計の問題

- **内部実装露出**: ライブラリユーザーが触れるべきでない内部メソッドが公開
- **設定オプション不足**: パラメータのカスタマイズ性が低い
- **エラーハンドリング**: 一貫性のないエラー処理
- **イベントシステム**: 処理進行状況やエラーを外部に通知する仕組みが不十分

## 提案する新しいアーキテクチャ

### 1. コアクラス構造

```
SPALAM (メインAPI)
├── PlaneEstimator (平面推定エンジン)
│   ├── FeatureTracker (特徴点追跡)
│   ├── DepthProcessor (深度処理)
│   └── GeometryProcessor (3D幾何処理)
├── Renderer (描画エンジン)
└── Configuration (設定管理)
```

### 2. 新しいディレクトリ構造

```
src/
├── core/                    # 核となるクラス群
│   ├── SPALAM.ts           # メインAPIクラス
│   ├── PlaneEstimator.ts   # 平面推定エンジン
│   └── Renderer.ts         # 描画エンジン
├── processors/             # 各種処理クラス
│   ├── FeatureTracker.ts   # 特徴点追跡
│   ├── DepthProcessor.ts   # 深度処理
│   └── GeometryProcessor.ts # 3D幾何処理
├── geometry/               # 幾何学計算
│   ├── PlaneGeometry.ts    # 平面関連計算
│   ├── ConvexHull.ts       # 凸包計算
│   └── CoordinateTransforms.ts # 座標変換
├── math/                   # 数学ユーティリティ
│   ├── Statistics.ts       # 統計処理
│   ├── LinearAlgebra.ts    # 線形代数
│   └── RANSAC.ts          # RANSAC実装
├── types/                  # 型定義
│   ├── core.ts            # コア型定義
│   ├── geometry.ts        # 幾何学型
│   └── configuration.ts   # 設定型
├── utils/                  # ユーティリティ
│   ├── Camera.ts          # カメラ制御
│   └── EventEmitter.ts    # イベントシステム
└── index.ts               # エクスポート定義
```

## 詳細リファクタリング計画

### Phase 1: 型定義の統合と整理

#### 1.1 コア型定義の作成 (`types/core.ts`)

```typescript
export interface Point2D {
  u: number;
  v: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
  id?: string;
}

export interface Feature extends Point2D {
  x: number;
  y: number;
  trackingCount: number;
  id: string;
  confidence?: number;
}

export interface PlaneModel {
  a: number;
  b: number;
  c: number;
  d: number;
  confidence?: number;
}
```

#### 1.2 設定型定義の作成 (`types/configuration.ts`)

```typescript
export interface SPALAMConfig {
  camera: CameraConfig;
  featureDetection: FeatureDetectionConfig;
  depthEstimation: DepthEstimationConfig;
  planeEstimation: PlaneEstimationConfig;
  rendering: RenderingConfig;
}

export interface FeatureDetectionConfig {
  maxCorners: number;
  qualityLevel: number;
  minDistance: number;
  trackingFrames: number;
  roiEnabled: boolean;
  roiSize: { width: number; height: number };
}

// その他の設定インターフェース...
```

### Phase 2: 数学・幾何学ライブラリの分離

#### 2.1 RANSAC 実装の分離 (`math/RANSAC.ts`)

```typescript
export class RANSAC<TModel, TData> {
  constructor(
    private modelFitter: ModelFitter<TModel, TData>,
    private config: RANSACConfig
  ) {}

  fit(data: TData[]): RANSACResult<TModel> {
    // 現在のfitPlaneRANSACの汎用化実装
  }
}

export class PlaneRANSAC extends RANSAC<PlaneModel, Point3D> {
  // 平面特化のRANSAC実装
}
```

#### 2.2 幾何学処理の統合 (`geometry/PlaneGeometry.ts`)

```typescript
export class PlaneGeometry {
  static computeFromThreePoints(
    p1: Point3D,
    p2: Point3D,
    p3: Point3D
  ): PlaneModel;
  static distancePointToPlane(point: Point3D, plane: PlaneModel): number;
  static projectPointsToPlane(points: Point3D[], plane: PlaneModel): Point2D[];
  static computeConvexHull2D(points: Point2D[]): Point2D[];
  static liftHull2DTo3D(hull2D: Point2D[], plane: PlaneGeometry): Point3D[];
}
```

#### 2.3 座標変換の統合 (`geometry/CoordinateTransforms.ts`)

```typescript
export class CoordinateTransforms {
  static backProjectPoints(
    points: Point3D[],
    cameraParams: CameraParameters
  ): Point3D[];
  static worldToCamera(points: Point3D[], transformation: Matrix4): Point3D[];
  static cameraToWorld(points: Point3D[], transformation: Matrix4): Point3D[];
}
```

### Phase 3: プロセッサクラスの作成

#### 3.1 特徴点追跡プロセッサ (`processors/FeatureTracker.ts`)

```typescript
export class FeatureTracker extends EventEmitter {
  private config: FeatureDetectionConfig;
  private cv: any;
  private state: FeatureTrackingState;

  constructor(config: FeatureDetectionConfig, cv: any) {
    super();
    this.config = config;
    this.cv = cv;
  }

  async trackFeatures(canvas: HTMLCanvasElement): Promise<Feature[]> {
    // 現在のFeatureDetectorの機能を統合
    const features = this.detectAndTrackFeatures(canvas);
    this.emit("featuresDetected", features);
    return features;
  }

  getCenterFeature(): Feature | null {
    // 中央特徴点取得
  }

  reset(): void {
    // 追跡状態リセット
  }
}
```

#### 3.2 深度処理プロセッサ (`processors/DepthProcessor.ts`)

```typescript
export class DepthProcessor extends EventEmitter {
  private model: any;
  private processor: any;
  private config: DepthEstimationConfig;

  constructor(config: DepthEstimationConfig) {
    super();
    this.config = config;
  }

  async initialize(): Promise<void> {
    // モデル読み込み
    this.emit("modelLoaded");
  }

  async processDepth(canvas: HTMLCanvasElement): Promise<Float32Array> {
    // 深度推定実行
    const depthMap = await this.estimateDepth(canvas);
    this.emit("depthProcessed", depthMap);
    return depthMap;
  }

  sampleDepthAtPoints(
    features: Feature[],
    depthMap: Float32Array,
    mapSize: { width: number; height: number }
  ): Point3D[] {
    // 空間平滑化を含む深度サンプリング
  }
}
```

#### 3.3 幾何処理プロセッサ (`processors/GeometryProcessor.ts`)

```typescript
export class GeometryProcessor extends EventEmitter {
  private config: PlaneEstimationConfig;
  private ransac: PlaneRANSAC;

  constructor(config: PlaneEstimationConfig) {
    super();
    this.config = config;
    this.ransac = new PlaneRANSAC(config.ransac);
  }

  estimatePlane(points3D: Point3D[]): PlaneEstimationResult {
    // フィルタリング
    const filteredPoints = this.filterPoints(points3D);

    // RANSAC実行
    const ransacResult = this.ransac.fit(filteredPoints);

    // 重み付きリファインメント
    const refinedPlane = this.refineWithWeighting(ransacResult);

    // 凸包計算
    const convexHull = this.computeConvexHull(
      ransacResult.inliers,
      refinedPlane
    );

    const result = {
      plane: refinedPlane,
      hull2D: convexHull.hull2D,
      hull3D: convexHull.hull3D,
      confidence: this.calculateConfidence(ransacResult),
    };

    this.emit("planeEstimated", result);
    return result;
  }
}
```

### Phase 4: コアエンジンクラスの作成

#### 4.1 平面推定エンジン (`core/PlaneEstimator.ts`)

```typescript
export class PlaneEstimator extends EventEmitter {
  private featureTracker: FeatureTracker;
  private depthProcessor: DepthProcessor;
  private geometryProcessor: GeometryProcessor;
  private config: SPALAMConfig;
  private state: EstimationState;

  constructor(config: SPALAMConfig, cv: any) {
    super();
    this.config = config;
    this.featureTracker = new FeatureTracker(config.featureDetection, cv);
    this.depthProcessor = new DepthProcessor(config.depthEstimation);
    this.geometryProcessor = new GeometryProcessor(config.planeEstimation);
    this.setupEventHandlers();
  }

  async initialize(): Promise<void> {
    await this.depthProcessor.initialize();
    this.emit("initialized");
  }

  async estimateFrame(
    canvas: HTMLCanvasElement
  ): Promise<PlaneEstimationResult | null> {
    try {
      // 1. 特徴点追跡
      const features = await this.featureTracker.trackFeatures(canvas);

      // 2. 深度推定
      const depthMap = await this.depthProcessor.processDepth(canvas);

      // 3. 深度サンプリング
      const points3D = this.depthProcessor.sampleDepthAtPoints(
        features,
        depthMap,
        { width: canvas.width, height: canvas.height }
      );

      // 4. 平面推定
      const result = this.geometryProcessor.estimatePlane(points3D);

      // 5. 結果の安定化（複数フレーム平均化）
      const stabilizedResult = this.stabilizeResult(result);

      this.emit("frameProcessed", stabilizedResult);
      return stabilizedResult;
    } catch (error) {
      this.emit("error", error);
      return null;
    }
  }

  private stabilizeResult(
    result: PlaneEstimationResult
  ): PlaneEstimationResult {
    // 複数フレーム結果の平均化ロジック
  }
}
```

#### 4.2 描画エンジン (`core/Renderer.ts`)

```typescript
export class Renderer extends EventEmitter {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private config: RenderingConfig;

  constructor(config: RenderingConfig) {
    super();
    this.config = config;
    this.initialize();
  }

  private initialize(): void {
    // Three.js初期化
  }

  renderPlane(result: PlaneEstimationResult): void {
    // 平面描画
    const planeGroup = this.createPlaneGeometry(result);
    this.updateScene(planeGroup);
    this.render();
    this.emit("rendered", result);
  }

  private createPlaneGeometry(result: PlaneEstimationResult): THREE.Group {
    // 現在のcreatePlaneGeometriesロジック
  }
}
```

### Phase 5: メイン API クラスの簡素化

#### 5.1 新しい SPALAM クラス (`core/SPALAM.ts`)

```typescript
export class SPALAM extends EventEmitter {
  private config: SPALAMConfig;
  private camera: Camera;
  private planeEstimator: PlaneEstimator;
  private renderer: Renderer;
  private isRunning: boolean = false;

  constructor(config?: Partial<SPALAMConfig>) {
    super();
    this.config = this.mergeConfig(config);
    this.camera = new Camera();
  }

  async initialize(video?: HTMLVideoElement): Promise<void> {
    try {
      // カメラ初期化
      if (!video) {
        await this.camera.initialize();
        video = this.camera.getVideoElement();
      }

      // CV初期化待ち
      await this.waitForOpenCV();

      // エンジン初期化
      this.planeEstimator = new PlaneEstimator(this.config, cv);
      this.renderer = new Renderer(this.config.rendering);

      await this.planeEstimator.initialize();

      this.setupEventHandlers();
      this.emit("initialized");
    } catch (error) {
      this.emit("error", error);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (!this.planeEstimator || !this.renderer) {
      throw new Error("SPALAM not initialized. Call initialize() first.");
    }

    this.isRunning = true;
    this.emit("started");
    this.renderLoop();
  }

  stop(): void {
    this.isRunning = false;
    this.emit("stopped");
  }

  private async renderLoop(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const canvas = this.camera.getCanvas();
      const result = await this.planeEstimator.estimateFrame(canvas);

      if (result) {
        this.renderer.renderPlane(result);
      }
    } catch (error) {
      this.emit("error", error);
    }

    requestAnimationFrame(() => this.renderLoop());
  }

  // Public API methods
  updateConfig(config: Partial<SPALAMConfig>): void {
    this.config = this.mergeConfig(config);
    // 各コンポーネントに設定反映
  }

  getCurrentPlane(): PlaneEstimationResult | null {
    return this.planeEstimator?.getCurrentResult() || null;
  }
}
```

### Phase 6: ライブラリ化のための最終調整

#### 6.1 エクスポート定義 (`index.ts`)

```typescript
// メインクラス
export { SPALAM } from "./core/SPALAM";

// 設定インターフェース
export type {
  SPALAMConfig,
  FeatureDetectionConfig,
  DepthEstimationConfig,
  PlaneEstimationConfig,
  RenderingConfig,
} from "./types/configuration";

// 結果型
export type {
  PlaneEstimationResult,
  Point2D,
  Point3D,
  Feature,
  PlaneModel,
} from "./types/core";

// プロセッサ（上級者向け）
export {
  PlaneEstimator,
  FeatureTracker,
  DepthProcessor,
  GeometryProcessor,
} from "./processors";

// ユーティリティ
export { PlaneGeometry, CoordinateTransforms } from "./geometry";
```

#### 6.2 設定のデフォルト値定義

```typescript
export const DEFAULT_CONFIG: SPALAMConfig = {
  camera: {
    facingMode: "environment",
    resolution: { width: 640, height: 480 },
  },
  featureDetection: {
    maxCorners: 800,
    qualityLevel: 0.001,
    minDistance: 5,
    trackingFrames: 5,
    roiEnabled: true,
    roiSize: { width: 0.5, height: 0.5 },
  },
  // ... その他のデフォルト値
};
```

## 段階的移行戦略

### 段階 1: 基盤整備（1-2 週間）

1. 新しいディレクトリ構造の作成
2. 型定義の統合・整理
3. 設定システムの構築
4. イベントシステムの実装

### 段階 2: プロセッサ分離（2-3 週間）

1. FeatureTracker クラスの作成・移行
2. DepthProcessor クラスの作成・移行
3. GeometryProcessor クラスの作成・移行
4. 各プロセッサのテスト作成

### 段階 3: エンジン統合（2 週間）

1. PlaneEstimator クラスの作成
2. Renderer クラスの作成
3. プロセッサ間の連携実装
4. 統合テストの作成

### 段階 4: API 整理（1 週間）

1. 新しい SPALAM クラスの実装
2. 旧 API との互換性確保
3. ドキュメント作成
4. 使用例の作成

### 段階 5: 最適化・最終調整（1 週間）

1. パフォーマンス最適化
2. エラーハンドリング強化
3. TypeScript 型の完善
4. ライブラリビルド設定

## 期待される効果

### 1. 保守性の向上

- **単一責任原則**: 各クラスが明確な責任を持つ
- **依存性の分離**: コンポーネント間の結合度を下げる
- **テスタビリティ**: 各機能を独立してテスト可能

### 2. 拡張性の向上

- **プラグイン化**: 深度推定手法や特徴点検出手法の差し替えが容易
- **設定の柔軟性**: 用途に応じた細かな調整が可能
- **イベント駆動**: カスタム処理の挿入が容易

### 3. 使いやすさの向上

- **シンプルな API**: 基本的な使用では最小限のコード
- **型安全性**: TypeScript による開発時支援
- **ドキュメント**: 明確な API 仕様書

### 4. パフォーマンス向上

- **最適化の余地**: 各処理段階での個別最適化
- **メモリ管理**: より精密なリソース管理
- **並列処理**: 非依存処理の並列実行

## 注意点・リスク

### 1. 移行時のリスク

- **デグレード**: 既存機能の動作に影響する可能性
- **パフォーマンス低下**: 抽象化によるオーバーヘッド
- **移行コスト**: 大規模な構造変更による工数

### 2. 緩和策

- **段階的移行**: 機能ごとの漸進的な変更
- **後方互換性**: 旧 API との併存期間を設ける
- **十分なテスト**: 各段階での動作検証
- **パフォーマンステスト**: ベンチマークによる性能確認

このリファクタリングプランにより、SPALAM は保守性、拡張性、使いやすさを兼ね備えた高品質な JavaScript ライブラリとして生まれ変わります。

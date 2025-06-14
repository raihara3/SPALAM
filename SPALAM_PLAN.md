# SPALAM 平面トラッキング実装計画

## 概要

現在のSPALAMシステムは平面検出は実装されているが、カメラの動きに対して平面がトラッキングされず、画面中央に固定されている。本計画では、検出した平面を実世界の位置に固定し、カメラの動きに追従する機能を実装する。

## 現在の実装状況

### 実装済み機能

- OpenCV.jsによる特徴点検出とオプティカルフロー
- Hugging Face Transformersによる深度推定
- RANSAC平面フィッティング
- Three.jsによるAR描画
- 空間スムージング（3回反復平均化）

### 問題点

- 平面が画面中央に固定されている
- カメラの姿勢変化に対するトラッキングが未実装
- 時間的一貫性の欠如

## 実装アプローチ

### Phase 1: デバイスモーション統合（優先度：高）

#### 1.1 WebXR Device Motion API実装

```typescript
// 新規ファイル: src/utils/DeviceMotionTracker.ts
class DeviceMotionTracker {
  private orientation: DeviceOrientationData;
  private acceleration: DeviceMotionData;

  initializeTracking(): Promise<boolean>;
  getCurrentPose(): Matrix4x4;
  getRotationMatrix(): Matrix3x3;
}
```

#### 1.2 Three.jsカメラ制御拡張

```typescript
// 拡張: src/utils/CameraController.ts
class CameraController {
  updateFromDeviceOrientation(alpha: number, beta: number, gamma: number): void;
  updateFromSLAMPose(pose: Matrix4x4): void;
  fusePoseEstimates(devicePose: Matrix4x4, visualPose: Matrix4x4): Matrix4x4;
}
```

#### 実装タスク

- [ ] DeviceMotionTracker.tsの作成
- [ ] CameraController.tsの拡張
- [ ] デバイス権限要求の実装
- [ ] フォールバック機能の実装

### Phase 2: Visual-Inertial Odometry（VIO）実装（優先度：高）

#### 2.1 キーフレーム管理システム

```typescript
// 新規ファイル: src/tracking/KeyframeManager.ts
class KeyframeManager {
  private keyframes: Keyframe[] = [];
  private planeDescriptors: Map<number, Float32Array> = new Map();

  addKeyframe(frame: Keyframe): boolean;
  findBestMatch(currentFrame: Keyframe): Keyframe | null;
  maintainKeyframes(): void; // メモリ管理
}
```

#### 2.2 特徴追跡の拡張

```typescript
// 拡張: src/FeatureDetector.ts
class FeatureDetector {
  private planeFeatures: Map<number, TrackedFeature[]> = new Map();

  trackPlaneFeatures(planeId: number, features: cv.Point2f[]): boolean;
  calculateStabilityScore(features: TrackedFeature[]): number;
  updateFeatureTracking(frame: cv.Mat): TrackingResult;
}
```

#### 実装タスク

- [ ] KeyframeManager.tsの作成
- [ ] FeatureDetector.tsの拡張
- [ ] 平面特異的特徴追跡の実装
- [ ] 安定性スコア計算の実装

### Phase 3: 姿勢推定とバンドル調整（優先度：中）

#### 3.1 簡易バンドル調整

```typescript
// 新規ファイル: src/tracking/BundleAdjustment.ts
class BundleAdjustment {
  optimizePlaneParameters(
    planePoints: Point3D[],
    cameraParameters: CameraIntrinsics,
    iterations: number
  ): OptimizedPlane;

  computeJacobian(points: Point3D[], plane: Plane): Matrix;
  solveLevenbergMarquardt(jacobian: Matrix, residuals: Vector): Vector;
}
```

#### 3.2 ループクロージャ検出

```typescript
// 新規ファイル: src/tracking/LoopClosureDetector.ts
class LoopClosureDetector {
  detectLoopClosure(currentFrame: Keyframe): LoopClosureResult | null;
  validateLoopClosure(frame1: Keyframe, frame2: Keyframe): boolean;
  correctDrift(loopClosure: LoopClosureResult): void;
}
```

#### 実装タスク

- [ ] BundleAdjustment.tsの作成
- [ ] LoopClosureDetector.tsの作成
- [ ] 姿勢グラフ最適化の実装
- [ ] ドリフト補正機能の実装

### Phase 4: 統合追跡システム（優先度：中）

#### 4.1 統合追跡管理

```typescript
// 新規ファイル: src/tracking/IntegratedTracker.ts
class IntegratedTracker {
  private slamTracker?: AlvaAR; // オプション
  private featureTracker: FeatureDetector;
  private deviceMotion: DeviceMotionTracker;
  private bundleAdjustment: BundleAdjustment;

  async processFrame(frame: ImageData): Promise<TrackingResult>;
  fuseSensorData(visual: PoseData, inertial: PoseData): PoseData;
  updatePlaneTracking(planes: Plane[], pose: Matrix4x4): TrackedPlane[];
}
```

#### 4.2 SPALAMメインループの拡張

```typescript
// 拡張: src/SPALAM.ts
class SPALAM {
  private integratedTracker: IntegratedTracker;
  private trackedPlanes: Map<number, TrackedPlane> = new Map();

  private async processFrameWithTracking(frame: ImageData): Promise<void>;
  private updatePlanePositions(trackingResult: TrackingResult): void;
  private renderTrackedPlanes(): void;
}
```

#### 実装タスク

- [ ] IntegratedTracker.tsの作成
- [ ] SPALAM.tsの拡張
- [ ] センサーフュージョンの実装
- [ ] リアルタイム性能最適化

### Phase 5: 高度な追跡機能（優先度：低）

#### 5.1 WebXR統合（対応デバイスのみ）

```typescript
// 新規ファイル: src/tracking/WebXRPlaneTracker.ts
class WebXRPlaneTracker {
  private session: XRSession | null = null;
  private trackedPlanes: Map<XRPlane, PlaneData> = new Map();

  async initializeXRSession(): Promise<boolean>;
  processXRFrame(frame: XRFrame): XRTrackingResult;
  fallbackToCustomTracking(): void;
}
```

#### 5.2 外部SLAM統合（AlvaAR等）

```typescript
// 新規ファイル: src/tracking/SLAMIntegration.ts
class SLAMIntegration {
  private slam?: AlvaAR;

  async initializeSLAM(): Promise<boolean>;
  processFrameWithSLAM(frame: ImageData): SLAMResult;
  integrateSLAMWithCustomTracking(slamResult: SLAMResult): void;
}
```

#### 実装タスク

- [ ] WebXRPlaneTracker.tsの作成
- [ ] SLAMIntegration.tsの作成（オプション）
- [ ] プログレッシブエンハンスメントの実装
- [ ] パフォーマンス最適化

## 技術仕様

### 新規依存関係

```json
{
  "dependencies": {
    "@mediapipe/tasks-vision": "^0.10.0", // 姿勢推定（オプション）
    "alva-ar": "^1.0.0" // SLAM（オプション）
  }
}
```

### ファイル構造拡張

```
src/
├── tracking/
│   ├── DeviceMotionTracker.ts
│   ├── KeyframeManager.ts
│   ├── BundleAdjustment.ts
│   ├── LoopClosureDetector.ts
│   ├── IntegratedTracker.ts
│   ├── WebXRPlaneTracker.ts
│   └── SLAMIntegration.ts
├── types/
│   ├── Tracking.ts
│   ├── Keyframe.ts
│   └── TrackingResult.ts
└── utils/
    └── PoseFusion.ts
```

### パフォーマンス目標

- フレームレート: 30fps維持
- 追跡精度: < 5cm位置誤差、< 5度回転誤差
- 初期化時間: < 3秒
- メモリ使用量: < 500MB

## 実装順序

### Week 1-2: Phase 1実装

1. DeviceMotionTrackerの実装
2. CameraControllerの拡張
3. 基本的なデバイスモーション統合

### Week 3-4: Phase 2実装

1. KeyframeManagerの実装
2. FeatureDetectorの拡張
3. 基本的なVIO実装

### Week 5-6: Phase 3実装

1. BundleAdjustmentの実装
2. ループクロージャ検出
3. 姿勢最適化

### Week 7-8: Phase 4実装

1. IntegratedTrackerの実装
2. SPALAM統合
3. パフォーマンス最適化

### Week 9-10: Phase 5実装（オプション）

1. WebXR統合
2. 外部SLAM統合
3. 最終調整

## テスト戦略

### 単体テスト

- [ ] DeviceMotionTracker機能テスト
- [ ] KeyframeManager機能テスト
- [ ] BundleAdjustment精度テスト

### 統合テスト

- [ ] 追跡精度評価
- [ ] パフォーマンステスト
- [ ] 異なるデバイスでの互換性テスト

### ユーザビリティテスト

- [ ] 実環境での追跡安定性
- [ ] ユーザーエクスペリエンス評価
- [ ] エラーハンドリングの確認

## リスク評価

### 高リスク

- デバイスモーション許可の取得失敗
- パフォーマンス劣化
- 追跡精度の不安定性

### 中リスク

- ブラウザ互換性問題
- メモリリーク
- WebGL描画性能

### 低リスク

- WebXR対応デバイスの限定性
- 外部ライブラリの依存関係

## 成功指標

1. **機能性**: 平面が実世界位置で安定追跡される
2. **性能**: 30fps維持、500MB以下メモリ使用
3. **精度**: 位置誤差5cm以下、回転誤差5度以下
4. **安定性**: 10分間の連続使用でクラッシュなし
5. **互換性**: 主要ブラウザ（Chrome、Safari、Firefox）で動作

## 実装の技術的詳細

### カメラ姿勢推定アルゴリズム

1. **Essential Matrix推定**: 連続フレーム間の特徴点マッチングから基礎行列を計算
2. **PnP問題**: 3D点群と2D投影の対応から最適化によりカメラポーズを復元
3. **Bundle Adjustment**: 複数フレームにわたる最小二乗法による姿勢とマップ点の同時最適化
4. **RANSAC**: 外れ値に頑健なモデル推定

### センサーフュージョン

1. **カルマンフィルタ**: デバイスモーションと視覚情報の確率的融合
2. **相補フィルタ**: 高周波成分（ジャイロ）と低周波成分（視覚）の組み合わせ
3. **IMUプリインテグレーション**: 連続する慣性測定値の事前積分

### 平面追跡戦略

1. **ホモグラフィ推定**: 平面上の特徴点変換行列から平面の姿勢変化を計算
2. **特徴点ライフサイクル管理**: 新規検出、追跡、消失の状態管理
3. **平面安定性評価**: 特徴点分布、追跡精度、時間的一貫性による品質スコア

この計画により、SPALAMは現在の静的平面検出から動的平面追跡システムへと進化し、真のAR体験を提供できるようになります。

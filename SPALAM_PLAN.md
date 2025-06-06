# SPALAM 平面トラッキング機能実装計画

## 概要

現在のSPALAMは平面の初回検出のみで動作が停止し、カメラ移動に対する連続的なトラッキングができていません。本計画は、真のSLAM（Simultaneous Localization and Mapping）システムとして、カメラポーズ推定と平面の連続トラッキング機能を実装するための詳細な技術計画書です。

## 現状分析

### 現在の問題点

1. **一回限りの平面生成**: 平面検出後に処理が停止（`processPlaneDetection()`のearly exit）
2. **カメラポーズ推定なし**: 固定カメラ位置 `(0, 0, 3)` で動的な位置更新なし
3. **平面の静的配置**: 世界座標に一度配置後、カメラ移動に追従しない
4. **SLAM機能欠如**: 特徴点追跡データがカメラモーション推定に利用されていない
5. **状態管理の制限**: `PLANE_DETECTED`状態で停止し、継続トラッキング状態がない

### 技術的課題

- OpenCV.jsの制約内での高精度カメラポーズ推定
- WebGLレンダリングでのリアルタイム性能確保
- ブラウザ環境でのメモリ効率的なSLAM実装
- 平面特徴点の安定したトラッキング

## 技術要件

### 1. カメラポーズ推定
- **Essential Matrix / Fundamental Matrix**: 連続フレーム間のカメラ運動推定
- **PnP (Perspective-n-Point)**: 3D点群からのカメラポーズ回復
- **Bundle Adjustment**: 複数フレームでのポーズ最適化
- **Keyframe Management**: メモリ効率化のためのキーフレーム選択

### 2. 平面トラッキング
- **Plane-specific Feature Tracking**: 平面上の特徴点の専用トラッキング
- **Homography Estimation**: 平面の変位推定
- **Tracking Quality Assessment**: トラッキング品質評価と再初期化判定
- **Scale Estimation**: 距離に応じた平面スケール調整

### 3. AR レンダリング
- **Dynamic Camera Matrix**: カメラポーズに基づく動的視点変更
- **World-to-Camera Transformation**: 世界座標系からカメラ座標系への変換
- **Real-time Projection**: 平面オブジェクトの正確な投影表示
- **Occlusion Handling**: 遮蔽関係の処理（将来拡張）

## 実装計画

### フェーズ 1: カメラポーズ推定基盤（優先度：最高）

#### 1.1 CameraPoseEstimator クラス実装
```typescript
interface CameraPose {
  position: Point3D;
  rotation: {
    x: number; y: number; z: number; w: number; // Quaternion
  };
  timestamp: number;
  confidence: number;
}

class CameraPoseEstimator {
  estimatePoseFromFeatures(currentFeatures: Feature[], previousFeatures: Feature[]): CameraPose | null;
  computeEssentialMatrix(matches: FeatureMatch[]): cv.Mat;
  recoverPoseFromEssential(E: cv.Mat, points1: cv.Point2f[], points2: cv.Point2f[]): CameraPose;
  validatePose(pose: CameraPose): boolean;
}
```

#### 1.2 Feature Matching システム
```typescript
interface FeatureMatch {
  current: Feature;
  previous: Feature;
  distance: number;
  isInlier: boolean;
}

class FeatureMatcher {
  matchFeatures(features1: Feature[], features2: Feature[]): FeatureMatch[];
  filterMatches(matches: FeatureMatch[]): FeatureMatch[];
  computeReprojectionError(match: FeatureMatch, pose: CameraPose): number;
}
```

#### 1.3 実装詳細
- **OpenCV.js の `cv.findEssentialMat()` 利用**
- **RANSAC による外れ値除去**
- **最小5点アルゴリズムでのポーズ回復**
- **カメラ内部パラメータ行列の活用**

### フェーズ 2: 平面トラッキングシステム（優先度：高）

#### 2.1 PlaneTracker クラス実装
```typescript
interface PlaneTrackingState {
  plane: PlaneModel;
  features: Feature[];
  lastUpdateTime: number;
  trackingQuality: number;
  isActive: boolean;
}

class PlaneTracker {
  trackPlane(currentFeatures: Feature[], cameraPose: CameraPose): PlaneTrackingState;
  updatePlanePosition(plane: PlaneModel, cameraPose: CameraPose): PlaneModel;
  assessTrackingQuality(features: Feature[]): number;
  handleTrackingLoss(): void;
}
```

#### 2.2 Homography ベース平面追跡
```typescript
class HomographyTracker {
  computeHomography(srcPoints: cv.Point2f[], dstPoints: cv.Point2f[]): cv.Mat;
  decomposeHomography(H: cv.Mat, cameraMatrix: cv.Mat): {
    rotations: cv.Mat[];
    translations: cv.Mat[];
    normals: cv.Mat[];
  };
  selectBestSolution(solutions: any[], plane: PlaneModel): any;
}
```

#### 2.3 実装詳細
- **`cv.findHomography()` でのRANSAC実装**
- **平面上特徴点の優先的トラッキング**
- **Homography分解による平面姿勢更新**
- **トラッキング品質による適応的処理**

### フェーズ 3: SLAM統合システム（優先度：中）

#### 3.1 SLAMManager クラス設計
```typescript
interface Keyframe {
  id: string;
  features: Feature[];
  cameraPose: CameraPose;
  timestamp: number;
  depthMap?: Float32Array;
}

class SLAMManager {
  private keyframes: Map<string, Keyframe>;
  private currentPose: CameraPose;
  private planeTracker: PlaneTracker;
  
  processFrame(features: Feature[], depthData?: Float32Array): void;
  shouldCreateKeyframe(currentPose: CameraPose): boolean;
  performBundleAdjustment(): void;
  detectLoopClosure(): boolean;
}
```

#### 3.2 状態管理の拡張
```typescript
enum SPALAMState {
  // 既存の状態
  INITIALIZING = "initializing",
  FEATURE_DETECTION = "feature_detection", 
  PLANE_ESTIMATION = "plane_estimation",
  PLANE_DETECTED = "plane_detected",
  
  // 新規追加
  CAMERA_TRACKING = "camera_tracking",
  PLANE_TRACKING = "plane_tracking", 
  TRACKING_LOST = "tracking_lost",
  RELOCALIZATION = "relocalization"
}
```

#### 3.3 実装詳細
- **適応的キーフレーム選択アルゴリズム**
- **メモリ効率的なBundle Adjustment**
- **トラッキング失敗時の再ローカライゼーション**
- **ループクロージャー検出（簡易版）**

### フェーズ 4: AR レンダリング強化（優先度：中）

#### 4.1 DynamicARRenderer クラス
```typescript
class DynamicARRenderer extends ARRenderer {
  updateCameraView(pose: CameraPose): void;
  transformPlaneToCamera(plane: PlaneModel, pose: CameraPose): PlaneModel;
  adjustPlaneScale(plane: PlaneModel, distance: number): PlaneModel;
  renderTrackedPlanes(planes: PlaneTrackingState[]): void;
}
```

#### 4.2 座標変換システム
```typescript
class CoordinateTransform {
  worldToCamera(point: Point3D, pose: CameraPose): Point3D;
  cameraToWorld(point: Point3D, pose: CameraPose): Point3D;
  projectToScreen(point3D: Point3D, cameraMatrix: number[]): Point2D;
  unprojectFromScreen(point2D: Point2D, depth: number, cameraMatrix: number[]): Point3D;
}
```

#### 4.3 実装詳細
- **Three.js カメラの動的更新**
- **リアルタイム座標変換**
- **距離ベースのスケーリング**
- **平滑化された視点変更**

### フェーズ 5: パフォーマンス最適化（優先度：低）

#### 5.1 計算効率化
- **Web Worker による並列計算**
- **GPU加速 (WebGLコンピュートシェーダー)**
- **メモリプール管理**
- **適応的品質調整**

#### 5.2 アルゴリズム最適化
- **特徴点数の動的調整**
- **ROIベース処理領域限定**
- **カスケード式トラッキング**
- **予測ベース特徴点探索**

## 技術実装仕様

### カメラ内部パラメータ
```typescript
interface CameraIntrinsics {
  fx: number;  // 焦点距離 (x方向)
  fy: number;  // 焦点距離 (y方向) 
  cx: number;  // 主点 (x座標)
  cy: number;  // 主点 (y座標)
  k1: number;  // 径方向歪み係数1
  k2: number;  // 径方向歪み係数2
  p1: number;  // 接線歪み係数1
  p2: number;  // 接線歪み係数2
}
```

### 数値計算パラメータ
```typescript
interface TrackingConfig {
  // ポーズ推定
  ransacIterations: number;        // default: 1000
  ransacThreshold: number;         // default: 1.0
  minMatchesForPose: number;       // default: 8
  
  // 平面トラッキング  
  homographyThreshold: number;     // default: 3.0
  trackingQualityThreshold: number; // default: 0.7
  maxTrackingDistance: number;     // default: 50.0
  
  // キーフレーム管理
  keyframeDistance: number;        // default: 0.2
  keyframeAngle: number;          // default: 20.0 (degrees)
  maxKeyframes: number;           // default: 50
}
```

### エラーハンドリング
```typescript
enum TrackingError {
  INSUFFICIENT_FEATURES = "insufficient_features",
  POSE_ESTIMATION_FAILED = "pose_estimation_failed", 
  TRACKING_QUALITY_LOW = "tracking_quality_low",
  HOMOGRAPHY_DEGENERATE = "homography_degenerate"
}

interface TrackingResult {
  success: boolean;
  error?: TrackingError;
  pose?: CameraPose;
  planeState?: PlaneTrackingState;
  confidence: number;
}
```

## 開発スケジュール

### スプリント 1 (Week 1-2): 基盤実装
- [ ] `CameraPoseEstimator` クラス実装
- [ ] `FeatureMatcher` クラス実装  
- [ ] Essential Matrix 計算ロジック
- [ ] 基本的なポーズ推定テスト

### スプリント 2 (Week 3-4): 平面トラッキング
- [ ] `PlaneTracker` クラス実装
- [ ] `HomographyTracker` クラス実装
- [ ] 平面特徴点管理システム
- [ ] トラッキング品質評価

### スプリント 3 (Week 5-6): SLAM統合
- [ ] `SLAMManager` クラス実装
- [ ] 状態管理システム拡張
- [ ] キーフレーム管理
- [ ] Bundle Adjustment (簡易版)

### スプリント 4 (Week 7-8): AR強化とテスト
- [ ] `DynamicARRenderer` クラス実装
- [ ] 座標変換システム
- [ ] 統合テストとデバッグ
- [ ] パフォーマンス最適化

## 成功指標

### 技術指標
1. **トラッキング継続率**: 95%以上のフレームで安定したトラッキング
2. **ポーズ推定精度**: 回転誤差 < 5度、位置誤差 < 10cm
3. **リアルタイム性能**: 30fps での安定動作
4. **メモリ使用量**: 増加率 < 50MB/分

### 機能指標  
1. **平面の視点追従**: カメラ移動に対する正確な平面表示
2. **スケール適応**: 距離変化に応じた適切な平面サイズ調整
3. **トラッキング回復**: 失敗時の自動再初期化成功率 > 80%
4. **多角度対応**: 平面を様々な角度から安定して表示

## リスク評価と対策

### 技術リスク

#### 高リスク
1. **OpenCV.js制約**: ネイティブOpenCVの一部機能が利用不可
   - **対策**: 代替アルゴリズムの事前実装、WebAssembly版検討

2. **ブラウザ性能制限**: 重い計算によるフレームレート低下
   - **対策**: Web Worker並列化、適応的品質調整

#### 中リスク  
3. **カメラキャリブレーション**: ユーザーデバイスごとの内部パラメータ差異
   - **対策**: 自動キャリブレーション機能、デフォルト値での近似

4. **照明変化**: 環境光変化による特徴点追跡失敗
   - **対策**: 適応的特徴点検出、輝度正規化

### 開発リスク

#### 中リスク
5. **複雑性増加**: SLAM実装の技術的複雑さ
   - **対策**: 段階的実装、最小限のMVP版先行開発

6. **デバッグ困難**: 3D空間での視覚的デバッグの難しさ  
   - **対策**: 詳細ログシステム、可視化ツール開発

## 将来拡張計画

### 短期拡張 (3-6ヶ月)
- **マルチプレーン対応**: 複数平面の同時検出・トラッキング
- **オクルージョン処理**: 平面間の遮蔽関係処理
- **動的オブジェクト**: 平面上の3Dオブジェクト配置

### 長期拡張 (6-12ヶ月)  
- **Dense SLAM**: 密な3D復元機能
- **セマンティックSLAM**: AI物体認識との統合
- **マルチユーザーAR**: 共有AR空間の実現

---

本計画により、SPALAMは単純な平面検出システムから、真のSLAMベースAR플랫폼へと進化し、リアルタイムでの平面トラッキングと自然なAR体験を提供できるようになります。
# SPALAM 平面トラッキング実装計画

## 概要

現在のSPALAMシステムは平面検出とAR描画は実装されているが、本格的なSLAM機能（自己位置推定、最適化処理、地図作成）は限定的。本計画では、検出した平面を実世界の位置に固定し、カメラの動きに追従する機能を実装する。

---

## 現在の実装状況

### 全体進捗: 約38%

```
■■■■□□□□□□ 38%
```

---

### 1. 自己位置推定（Localization / Tracking）

| 機能 | 状態 | 進捗 | 実装ファイル |
|------|------|------|--------------|
| 特徴点抽出 | ✅ 完了 | 100% | `src/services/FeatureDetectionService.ts` |
| オプティカルフロー追跡 | ✅ 完了 | 100% | `src/FeatureDetector.ts` |
| 複数アルゴリズム対応 | ✅ 完了 | 100% | Harris, Shi-Tomasi, FAST, ORB, SIFT |
| 2D→3D逆投影 | ✅ 完了 | 100% | `src/helpers/backProjectPoints.ts` |
| カメラ内部パラメータ | ✅ 完了 | 100% | `src/configuration.ts` |
| 簡易カメラ位置推定 | ⚠️ 部分的 | 30% | `src/SPALAM.ts:708-739` |
| Essential Matrix計算 | ❌ 未実装 | 0% | - |
| Fundamental Matrix計算 | ❌ 未実装 | 0% | - |
| PnP (solvePnP) | ❌ 未実装 | 0% | - |
| 6DoFポーズ推定 | ❌ 未実装 | 0% | - |
| 特徴点記述子マッチング | ❌ 未実装 | 0% | - |

**サブカテゴリ進捗:**
- 特徴点抽出・トラッキング: **75%**
- カメラポーズ推定: **20%**
- PnP計算: **30%**

---

### 2. 最適化処理（Optimization）

| 機能 | 状態 | 進捗 | 実装ファイル |
|------|------|------|--------------|
| 線形最小二乗法 | ✅ 完了 | 100% | `src/helpers/weightedPlaneFit2D.ts` |
| 重み付き平面フィッティング | ✅ 完了 | 100% | `src/services/PlaneFittingService.ts` |
| バンドル調整 | ❌ 未実装 | 0% | - |
| ポーズグラフ最適化 | ❌ 未実装 | 0% | - |
| Levenberg-Marquardtソルバー | ❌ 未実装 | 0% | - |
| ヤコビアン計算 | ❌ 未実装 | 0% | - |

**サブカテゴリ進捗:**
- 非線形最適化ソルバー: **40%**（線形のみ）
- バンドル調整: **0%**
- ポーズグラフ最適化: **0%**

---

### 3. 環境理解と地図作成（Mapping）

| 機能 | 状態 | 進捗 | 実装ファイル |
|------|------|------|--------------|
| RANSAC平面フィッティング | ✅ 完了 | 100% | `src/helpers/fitPlaneRANSAC.ts` |
| 凸包計算 | ✅ 完了 | 100% | `src/helpers/computeConvexHull2D.ts` |
| 2D凸包→3D変換 | ✅ 完了 | 100% | `src/helpers/liftHull2DTo3D.ts` |
| 深度推定 | ✅ 完了 | 100% | `src/services/DepthEstimationService.ts` |
| Three.jsメッシュ生成 | ✅ 完了 | 100% | `src/SPALAM.ts` |
| 空間スムージング | ✅ 完了 | 100% | 3回反復平均化 |
| 単一平面検出 | ✅ 完了 | 100% | - |
| 複数平面同時検出 | ❌ 未実装 | 0% | - |
| キーフレーム管理 | ❌ 未実装 | 0% | - |
| ループ閉鎖検出 | ❌ 未実装 | 0% | - |
| ドリフト補正 | ❌ 未実装 | 0% | - |
| セマンティック情報 | ❌ 未実装 | 0% | - |

**サブカテゴリ進捗:**
- 平面検出: **70%**
- 環境地図構築: **35%**
- ループ閉鎖検出: **0%**

---

## 実装計画

### Phase 1: デバイスモーション統合

**状態: ❌ 未着手**

#### 目標
デバイスのIMU（加速度計・ジャイロスコープ）を利用した姿勢推定の基盤構築

#### タスク

- [ ] `src/tracking/DeviceMotionTracker.ts` の作成
  - [ ] WebXR Device Motion API実装
  - [ ] 権限要求ハンドリング
  - [ ] フォールバック機能
- [ ] `src/utils/CameraController.ts` の拡張
  - [ ] デバイス姿勢からカメラ更新
  - [ ] 座標系変換

#### 設計

```typescript
class DeviceMotionTracker {
  private orientation: DeviceOrientationData;
  private acceleration: DeviceMotionData;

  initializeTracking(): Promise<boolean>;
  getCurrentPose(): Matrix4x4;
  getRotationMatrix(): Matrix3x3;
}
```

---

### Phase 2: Visual-Inertial Odometry（VIO）実装

**状態: ❌ 未着手**

#### 目標
視覚情報とIMUを組み合わせた連続的なポーズ推定

#### タスク

- [ ] `src/tracking/KeyframeManager.ts` の作成
  - [ ] キーフレーム選択基準の実装
  - [ ] メモリ管理（古いキーフレームの破棄）
- [ ] `src/FeatureDetector.ts` の拡張
  - [ ] 特徴点IDの永続化
  - [ ] 平面特異的特徴追跡
  - [ ] 安定性スコア計算
- [ ] Essential Matrix / Fundamental Matrix計算
- [ ] solvePnP実装（OpenCV.js利用）

#### 設計

```typescript
class KeyframeManager {
  private keyframes: Keyframe[] = [];
  private planeDescriptors: Map<number, Float32Array> = new Map();

  addKeyframe(frame: Keyframe): boolean;
  findBestMatch(currentFrame: Keyframe): Keyframe | null;
  maintainKeyframes(): void;
}
```

---

### Phase 3: 姿勢推定とバンドル調整

**状態: ❌ 未着手**

#### 目標
複数フレームにわたる最適化による精度向上

#### タスク

- [ ] `src/tracking/BundleAdjustment.ts` の作成
  - [ ] ヤコビアン計算機構
  - [ ] Levenberg-Marquardtソルバー
  - [ ] 再投影誤差最小化
- [ ] `src/tracking/LoopClosureDetector.ts` の作成
  - [ ] 特徴点記述子マッチング（Bag of Words等）
  - [ ] ループ検出アルゴリズム
  - [ ] ドリフト補正機構
- [ ] ポーズグラフ最適化

#### 設計

```typescript
class BundleAdjustment {
  optimizePlaneParameters(
    planePoints: Point3D[],
    cameraParameters: CameraIntrinsics,
    iterations: number
  ): OptimizedPlane;

  computeJacobian(points: Point3D[], plane: Plane): Matrix;
  solveLevenbergMarquardt(jacobian: Matrix, residuals: Vector): Vector;
}

class LoopClosureDetector {
  detectLoopClosure(currentFrame: Keyframe): LoopClosureResult | null;
  validateLoopClosure(frame1: Keyframe, frame2: Keyframe): boolean;
  correctDrift(loopClosure: LoopClosureResult): void;
}
```

---

### Phase 4: 統合追跡システム

**状態: ❌ 未着手**

#### 目標
各モジュールの統合と実用的なトラッキングシステムの完成

#### タスク

- [ ] `src/tracking/IntegratedTracker.ts` の作成
  - [ ] センサーフュージョン（カルマンフィルタ）
  - [ ] 視覚・慣性データの統合
- [ ] `src/SPALAM.ts` の拡張
  - [ ] 複数平面の同時管理
  - [ ] 平面の永続的ID管理
- [ ] パフォーマンス最適化

#### 設計

```typescript
class IntegratedTracker {
  private featureTracker: FeatureDetector;
  private deviceMotion: DeviceMotionTracker;
  private bundleAdjustment: BundleAdjustment;

  async processFrame(frame: ImageData): Promise<TrackingResult>;
  fuseSensorData(visual: PoseData, inertial: PoseData): PoseData;
  updatePlaneTracking(planes: Plane[], pose: Matrix4x4): TrackedPlane[];
}
```

---

### Phase 5: 高度な追跡機能（オプション）

**状態: ❌ 未着手**

#### 目標
WebXR対応デバイスでのネイティブ機能活用、外部SLAM統合

#### タスク

- [ ] `src/tracking/WebXRPlaneTracker.ts` の作成
  - [ ] XRSession初期化
  - [ ] ネイティブ平面検出の利用
  - [ ] カスタム実装へのフォールバック
- [ ] `src/tracking/SLAMIntegration.ts` の作成（オプション）
  - [ ] AlvaAR等の外部ライブラリ統合

---

## 技術仕様

### 新規依存関係

```json
{
  "dependencies": {
    "@mediapipe/tasks-vision": "^0.10.0"
  },
  "optionalDependencies": {
    "alva-ar": "^1.0.0"
  }
}
```

### ファイル構造拡張

```
src/
├── tracking/                    # 新規ディレクトリ
│   ├── DeviceMotionTracker.ts   # Phase 1
│   ├── KeyframeManager.ts       # Phase 2
│   ├── BundleAdjustment.ts      # Phase 3
│   ├── LoopClosureDetector.ts   # Phase 3
│   ├── IntegratedTracker.ts     # Phase 4
│   ├── WebXRPlaneTracker.ts     # Phase 5
│   └── SLAMIntegration.ts       # Phase 5 (オプション)
├── types/
│   ├── Tracking.ts              # 新規
│   ├── Keyframe.ts              # 新規
│   └── TrackingResult.ts        # 新規
└── utils/
    └── PoseFusion.ts            # 新規
```

### パフォーマンス目標

| 指標 | 目標値 |
|------|--------|
| フレームレート | 30fps維持 |
| 位置誤差 | < 5cm |
| 回転誤差 | < 5度 |
| 初期化時間 | < 3秒 |
| メモリ使用量 | < 500MB |

---

## 実装の技術的詳細

### カメラ姿勢推定アルゴリズム

1. **Essential Matrix推定**: 連続フレーム間の特徴点マッチングから基礎行列を計算
2. **PnP問題**: 3D点群と2D投影の対応から最適化によりカメラポーズを復元
3. **Bundle Adjustment**: 複数フレームにわたる最小二乗法による姿勢とマップ点の同時最適化
4. **RANSAC**: 外れ値に頑健なモデル推定（✅ 実装済み）

### センサーフュージョン

1. **カルマンフィルタ**: デバイスモーションと視覚情報の確率的融合
2. **相補フィルタ**: 高周波成分（ジャイロ）と低周波成分（視覚）の組み合わせ
3. **IMUプリインテグレーション**: 連続する慣性測定値の事前積分

### 平面追跡戦略

1. **ホモグラフィ推定**: 平面上の特徴点変換行列から平面の姿勢変化を計算
2. **特徴点ライフサイクル管理**: 新規検出、追跡、消失の状態管理
3. **平面安定性評価**: 特徴点分布、追跡精度、時間的一貫性による品質スコア

---

## テスト戦略

### 単体テスト

- [ ] DeviceMotionTracker機能テスト
- [ ] KeyframeManager機能テスト
- [ ] BundleAdjustment精度テスト
- [ ] LoopClosureDetector検出精度テスト

### 統合テスト

- [ ] 追跡精度評価（Ground Truth比較）
- [ ] パフォーマンステスト（フレームレート、メモリ）
- [ ] 異なるデバイスでの互換性テスト

### ユーザビリティテスト

- [ ] 実環境での追跡安定性
- [ ] ユーザーエクスペリエンス評価
- [ ] エラーハンドリングの確認

---

## リスク評価

### 高リスク

| リスク | 対策 |
|--------|------|
| デバイスモーション許可の取得失敗 | 視覚のみのフォールバック実装 |
| パフォーマンス劣化 | Worker分離、処理間引き |
| 追跡精度の不安定性 | 複数アルゴリズム併用、閾値調整 |

### 中リスク

| リスク | 対策 |
|--------|------|
| ブラウザ互換性問題 | Polyfill、機能検出 |
| メモリリーク | キーフレーム上限、定期GC |
| WebGL描画性能 | LOD、カリング最適化 |

### 低リスク

| リスク | 対策 |
|--------|------|
| WebXR対応デバイスの限定性 | カスタム実装併用 |
| 外部ライブラリの依存関係 | オプショナル統合 |

---

## 成功指標

1. **機能性**: 平面が実世界位置で安定追跡される
2. **性能**: 30fps維持、500MB以下メモリ使用
3. **精度**: 位置誤差5cm以下、回転誤差5度以下
4. **安定性**: 10分間の連続使用でクラッシュなし
5. **互換性**: 主要ブラウザ（Chrome、Safari、Firefox）で動作

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2025-12-29 | 実装状況の詳細調査を反映、進捗表記を追加 |

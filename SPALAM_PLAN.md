# SPALAM 平面トラッキング実装計画

## 概要

現在のSPALAMシステムは平面検出とAR描画は実装されているが、本格的なSLAM機能（自己位置推定、最適化処理、地図作成）は限定的。本計画では、検出した平面を実世界の位置に固定し、カメラの動きに追従する機能を実装する。

---

## 現在の実装状況

### 全体進捗: 約50%

```
■■■■■□□□□□ 50%
```

---

### 1. 自己位置推定（Localization / Tracking）

| 機能                   | 状態      | 進捗 | 実装ファイル                              |
| ---------------------- | --------- | ---- | ----------------------------------------- |
| 特徴点抽出             | ✅ 完了   | 100% | `src/services/FeatureDetectionService.ts` |
| オプティカルフロー追跡 | ✅ 完了   | 100% | `src/FeatureDetector.ts`                  |
| 複数アルゴリズム対応   | ✅ 完了   | 100% | Harris, Shi-Tomasi, FAST, ORB, SIFT       |
| 2D→3D逆投影            | ✅ 完了   | 100% | `src/helpers/backProjectPoints.ts`        |
| カメラ内部パラメータ   | ✅ 完了   | 100% | `src/configuration.ts`                    |
| 簡易カメラ位置推定     | ⚠️ 部分的 | 30%  | `src/SPALAM.ts:708-739`                   |
| Essential Matrix計算   | ❌ 未実装 | 0%   | -                                         |
| Fundamental Matrix計算 | ❌ 未実装 | 0%   | -                                         |
| PnP (solvePnP)         | ❌ 未実装 | 0%   | -                                         |
| 6DoFポーズ推定         | ❌ 未実装 | 0%   | -                                         |
| 特徴点記述子マッチング | ❌ 未実装 | 0%   | -                                         |

**サブカテゴリ進捗:**

- 特徴点抽出・トラッキング: **75%**
- カメラポーズ推定: **20%**
- PnP計算: **30%**

---

### 2. 最適化処理（Optimization）

| 機能                        | 状態      | 進捗 | 実装ファイル                          |
| --------------------------- | --------- | ---- | ------------------------------------- |
| 線形最小二乗法              | ✅ 完了   | 100% | `src/helpers/weightedPlaneFit2D.ts`   |
| 重み付き平面フィッティング  | ✅ 完了   | 100% | `src/services/PlaneFittingService.ts` |
| バンドル調整                | ❌ 未実装 | 0%   | -                                     |
| ポーズグラフ最適化          | ❌ 未実装 | 0%   | -                                     |
| Levenberg-Marquardtソルバー | ❌ 未実装 | 0%   | -                                     |
| ヤコビアン計算              | ❌ 未実装 | 0%   | -                                     |

**サブカテゴリ進捗:**

- 非線形最適化ソルバー: **40%**（線形のみ）
- バンドル調整: **0%**
- ポーズグラフ最適化: **0%**

---

### 3. 環境理解と地図作成（Mapping）

| 機能                     | 状態      | 進捗 | 実装ファイル                             |
| ------------------------ | --------- | ---- | ---------------------------------------- |
| RANSAC平面フィッティング | ✅ 完了   | 100% | `src/helpers/fitPlaneRANSAC.ts`          |
| 凸包計算                 | ✅ 完了   | 100% | `src/helpers/computeConvexHull2D.ts`     |
| 2D凸包→3D変換            | ✅ 完了   | 100% | `src/helpers/liftHull2DTo3D.ts`          |
| 深度推定                 | ✅ 完了   | 100% | `src/services/DepthEstimationService.ts` |
| Three.jsメッシュ生成     | ✅ 完了   | 100% | `src/SPALAM.ts`                          |
| 空間スムージング         | ✅ 完了   | 100% | 3回反復平均化                            |
| 単一平面検出             | ✅ 完了   | 100% | -                                        |
| 複数平面同時検出         | ❌ 未実装 | 0%   | -                                        |
| キーフレーム管理         | ❌ 未実装 | 0%   | -                                        |
| ループ閉鎖検出           | ❌ 未実装 | 0%   | -                                        |
| ドリフト補正             | ❌ 未実装 | 0%   | -                                        |
| セマンティック情報       | ❌ 未実装 | 0%   | -                                        |

**サブカテゴリ進捗:**

- 平面検出: **70%**
- 環境地図構築: **35%**
- ループ閉鎖検出: **0%**

---

## 実装計画

> **技術アドバイザーからの注意事項** (`memo/phase1.md`)
>
> - IMU単独では時間経過とともにドリフト（誤差累積）が発生する
> - Visual-Inertial Fusion（視覚+慣性統合）が必須
> - 初期化プロセスの最適化が重要
> - リー群表現（SE(3)/SO(3)）の活用を推奨

---

### Phase 1: デバイスモーション統合

**状態: ✅ 完了**

#### 目標

デバイスのIMU（加速度計・ジャイロスコープ）を利用した姿勢推定の基盤構築

#### ⚠️ 重要な制約

| 制約               | 説明                                                | 対策（Phase 2で実施）              |
| ------------------ | --------------------------------------------------- | ---------------------------------- |
| **ドリフト問題**   | IMU単独では誤差が累積し、数秒〜数十秒で位置がずれる | Phase 2でVIO（視覚統合）により補正 |
| **スケール不定性** | 加速度からの位置推定では絶対スケールが不明          | 視覚情報との融合で解決             |
| **初期化の難しさ** | 重力方向・初期姿勢の正確な推定が必要                | 静止状態検出による初期化           |

#### タスク

**1.1 DeviceMotionTracker の作成**

- [x] `src/tracking/DeviceMotionTracker.ts` の作成
  - [x] DeviceOrientation API実装（alpha, beta, gamma取得）
  - [x] DeviceMotion API実装（加速度、回転速度取得）
  - [x] iOS Safari向け権限要求（`DeviceOrientationEvent.requestPermission()`）
  - [x] Android Chrome対応
  - [x] HTTPS環境チェック（センサーAPIはSecure Context必須）
- [x] `src/types/DeviceMotion.ts` の作成（型定義）

**1.2 姿勢表現と座標変換**

- [x] `src/tracking/PoseRepresentation.ts` の作成
  - [x] クォータニオン ↔ オイラー角変換
  - [x] デバイス座標系 → Three.js座標系変換
  - [x] 重力方向の検出と補正
- [x] Three.jsカメラへの姿勢適用

**1.3 初期化プロセス**

- [x] `src/tracking/IMUInitializer.ts` の作成
  - [x] 静止状態検出（加速度の分散が閾値以下）
  - [x] 重力ベクトルの推定
  - [x] 初期姿勢のキャリブレーション
  - [x] 初期化完了の判定基準

**1.4 ドリフト可視化（デバッグ用）**

- [x] ドリフト量の計測・表示機能
- [x] Phase 2でのVIO統合後に比較検証するための基準データ記録

#### 設計

```typescript
// src/tracking/DeviceMotionTracker.ts
class DeviceMotionTracker {
  private orientation: DeviceOrientationData | null = null;
  private motion: DeviceMotionData | null = null;
  private initialized: boolean = false;
  private gravityVector: Vector3 | null = null;

  // 初期化（権限要求含む）
  async initialize(): Promise<boolean>;

  // 現在の姿勢取得（クォータニオン）
  getOrientation(): Quaternion | null;

  // 現在の回転行列取得（Three.js互換）
  getRotationMatrix(): Matrix4 | null;

  // 加速度取得（重力除去済み）
  getLinearAcceleration(): Vector3 | null;

  // 角速度取得
  getAngularVelocity(): Vector3 | null;

  // デバイス座標系 → ワールド座標系変換
  deviceToWorld(deviceVector: Vector3): Vector3;

  // リソース解放
  dispose(): void;
}

// src/tracking/IMUInitializer.ts
class IMUInitializer {
  private samples: MotionSample[] = [];
  private readonly requiredSamples: number = 50; // 約1秒分

  // サンプル追加
  addSample(acceleration: Vector3, angularVelocity: Vector3): void;

  // 静止状態判定
  isStationary(): boolean;

  // 初期化完了判定
  isReady(): boolean;

  // 重力ベクトル取得
  getGravityVector(): Vector3 | null;

  // 初期姿勢取得
  getInitialOrientation(): Quaternion | null;
}
```

#### ブラウザ互換性

| ブラウザ          | DeviceOrientation | DeviceMotion | 権限要求 |
| ----------------- | ----------------- | ------------ | -------- |
| Chrome (Android)  | ✅                | ✅           | 不要     |
| Safari (iOS 13+)  | ✅                | ✅           | **必須** |
| Firefox (Android) | ✅                | ✅           | 不要     |
| Chrome (Desktop)  | ❌                | ❌           | -        |
| Safari (Desktop)  | ❌                | ❌           | -        |

#### Phase 1 完了基準

- [x] スマートフォンでデバイスを傾けるとThree.jsカメラが追従する（実装完了）
- [x] iOS Safari、Android Chromeで動作確認（iOS Safari動作確認済み）
- [x] 初期化プロセスが安定して完了する（実装完了）
- [x] ドリフト量が計測・可視化できる（この時点ではドリフトは許容）

#### Phase 1 期待される動作（正解の状態）

**1. 基本動作**

| 操作                       | 期待される結果                                 |
| -------------------------- | ---------------------------------------------- |
| スマートフォンを水平に持つ | カメラが正面を向く（Three.jsシーンの原点方向） |
| デバイスを上に傾ける       | カメラが上を向く（空方向）                     |
| デバイスを下に傾ける       | カメラが下を向く（地面方向）                   |
| デバイスを左に回す         | カメラが左を向く                               |
| デバイスを右に回す         | カメラが右を向く                               |
| デバイスを時計回りに傾ける | カメラがロール（傾き）する                     |

**2. 初期化フロー**

```
1. ユーザーが許可ボタンをタップ（iOS Safariでは必須）
2. enableIMUTracking() を呼び出す
3. iOS Safariの場合、センサーアクセス権限ダイアログが表示される
4. ユーザーが許可すると、即座にIMUトラッキングが有効化される
5. isIMUTracking() が true を返す
6. カメラがデバイスの姿勢に追従し始める
```

> **注**: iOS Safariではセンサーアクセスの許可要求はユーザージェスチャー（ボタンクリック）から
> 行う必要があるため、許可ボタンを表示しています。

**3. デバッグ確認方法**

```typescript
// 初期化進捗の確認
const progress = spalam.getIMUInitializationProgress();
console.log(`初期化進捗: ${(progress * 100).toFixed(0)}%`);

// トラッキング状態の確認
console.log(`トラッキング中: ${spalam.isIMUTracking()}`);

// ドリフト統計の確認（10秒後に実行）
const stats = spalam.getIMUDriftStatistics();
console.log(`最大姿勢ドリフト: ${stats?.maxOrientationDrift} rad`);
```

**4. 許容される挙動（Phase 1時点）**

| 挙動                                    | 許容？  | 備考                            |
| --------------------------------------- | ------- | ------------------------------- |
| デバイスの傾きにカメラが追従する        | ✅ 必須 | これがPhase 1の主目的           |
| 時間経過で姿勢がずれる（ドリフト）      | ✅ 許容 | Phase 2で視覚情報と統合して補正 |
| IMU有効時、特徴点ベースの位置追跡が無効 | ✅ 許容 | Phase 2でVIO統合予定            |
| デスクトップで動作しない                | ✅ 許容 | IMUはモバイルデバイス専用       |
| HTTPSでないと動作しない                 | ✅ 許容 | Sensor APIの仕様                |

> **注意**: IMUトラッキング有効時は、平面メッシュの位置はワールド座標に固定されます。
> 特徴点ベースの位置追跡は無効になるため、平面がカメラに追従しません。
> これはPhase 2でVIO（Visual-Inertial Odometry）を実装して解決します。

**5. 不正解の状態（バグ）**

| 症状                               | 原因の可能性                                      |
| ---------------------------------- | ------------------------------------------------- |
| カメラが全く動かない               | 権限が拒否された / IMU初期化失敗                  |
| カメラが逆方向に動く               | 座標系変換のバグ                                  |
| カメラが激しく振動する             | ノイズフィルタリング不足                          |
| 初期化が永遠に完了しない           | 静止状態検出の閾値が厳しすぎる                    |
| iOS Safariで権限ダイアログが出ない | HTTPS環境でない / requestPermissionの呼び出しミス |

**6. テストシナリオ**

```typescript
// テスト用コード
const spalam = createSPALAM().build();
await spalam.start();

// IMUトラッキング開始
const success = await spalam.enableIMUTracking();
console.log(`IMU初期化: ${success ? "成功" : "失敗"}`);

// 10秒間、姿勢データをログ出力
const tracker = spalam.getDeviceMotionTracker();
if (tracker) {
  setInterval(() => {
    const orientation = tracker.getOrientation();
    if (orientation) {
      console.log(
        `姿勢: x=${orientation.x.toFixed(2)}, y=${orientation.y.toFixed(2)}, z=${orientation.z.toFixed(2)}, w=${orientation.w.toFixed(2)}`
      );
    }
  }, 1000);
}
```

---

### Phase 2: Visual-Inertial Fusion（簡易VIO）実装

**状態: ✅ 完了**

#### 目標

視覚情報とIMUを組み合わせた**ドリフト補正**と**平面位置の安定化**

#### 設計方針

専門家アドバイス（`memo/ADVICE.md`）を参考に、SPALAMのスコープに適した**簡略化アプローチ**を採用：

| アドバイス項目 | SPALAMでの対応 | 理由 |
| -------------- | -------------- | ---- |
| 密結合最適化（Ceres/G2O） | **相補フィルタ**で代替 | C++ライブラリのWasm化は過剰 |
| ループ閉鎖検出 | **スキップ** | 単一平面トラッキングでは不要 |
| マルチマップシステム | **スキップ** | SPALAMのスコープ外 |
| IMU-カメラキャリブレーション | **時間同期のみ** | 空間キャリブレーションはスマホでは固定 |

#### ⚠️ Phase 1からの改善点

| 課題 | Phase 2での解決策 |
| ---- | ----------------- |
| IMUドリフト | 特徴点ベースの定期リセット |
| 平面位置のズレ | 視覚情報で平面位置を再計算・補正 |
| スケール不定性 | 深度推定値を基準スケールとして使用 |

#### タスク

**2.1 相補フィルタの実装**

- [x] `src/tracking/ComplementaryFilter.ts` の作成
  - [x] 高周波成分（IMU姿勢）と低周波成分（視覚姿勢）の融合
  - [x] 適応的な重み調整（視覚信頼度に基づく）
  - [x] スムージング処理

**2.2 視覚ベースのドリフトリセット**

- [x] `src/tracking/DriftCorrector.ts` の作成
  - [x] 特徴点の安定性評価（追跡フレーム数、移動量）
  - [x] 安定特徴点からの基準姿勢計算
  - [x] IMU姿勢の定期リセット（例：1秒ごと）

**2.3 平面位置の視覚補正**

- [x] `src/SPALAM.ts` の拡張
  - [x] IMU有効時も特徴点追跡を継続
  - [x] 特徴点位置から平面の3D位置を再計算（`updatePlaneWorldPosition`）
  - [x] 平面位置のスムーズな更新（急激なジャンプ防止）
  - [x] IMU有効化時の平面回転調整（`adjustPlaneRotationForIMU`）

**2.4 時間同期**

- [x] IMUイベントとカメラフレームのタイムスタンプ同期
  - [x] ブラウザでの遅延測定（約16ms想定）
  - [x] 補間による同期

#### 設計

```typescript
// src/tracking/ComplementaryFilter.ts
class ComplementaryFilter {
  private alpha: number = 0.98; // IMU重み（高周波）

  constructor(options?: { alpha?: number });

  // IMU姿勢と視覚姿勢を融合
  fuse(
    imuOrientation: THREE.Quaternion,
    visualOrientation: THREE.Quaternion | null,
    visualConfidence: number
  ): THREE.Quaternion;

  // 視覚信頼度に基づいて重みを動的調整
  updateAlpha(visualConfidence: number): void;
}

// src/tracking/DriftCorrector.ts
class DriftCorrector {
  private referenceFeatures: StableFeature[] = [];
  private lastResetTimestamp: number = 0;
  private resetIntervalMs: number = 1000; // 1秒ごとにリセット

  // 安定した特徴点を記録
  updateReferenceFeatures(features: Feature[], trackingInfo: TrackingInfo): void;

  // ドリフト補正が必要か判定
  shouldCorrect(): boolean;

  // 視覚情報から基準姿勢を計算してドリフトを補正
  correctDrift(
    currentIMUOrientation: THREE.Quaternion,
    stableFeatures: StableFeature[]
  ): THREE.Quaternion;
}

// 安定特徴点の型
interface StableFeature {
  id: number;
  position2D: { x: number; y: number };
  position3D: THREE.Vector3;
  trackedFrames: number; // 連続追跡フレーム数
  confidence: number;    // 0-1
}
```

#### Phase 2 完了基準

- [x] 相補フィルタが動作し、IMUと視覚が融合されている
- [x] 10秒以上の使用でもドリフトが視覚的に気にならないレベル
- [x] 平面メッシュが特徴点の位置に表示される
- [x] デバイスを動かしても平面が安定して追従する
- [x] IMU有効化時に平面の向きが維持される

#### Phase 2 期待される動作

| 操作 | 期待される結果 |
| ---- | -------------- |
| デバイスを回転 | 平面が正しい角度から見える（Phase 1と同様） |
| デバイスを左右に移動 | 平面が特徴点の位置に留まる |
| 10秒間使用 | ドリフトによる大きなズレがない |
| 特徴点が見えなくなる | IMUのみで追跡継続（ドリフトは許容） |
| 特徴点が再び見える | 視覚情報でドリフトがリセットされる |

---

### Phase 2.5: トラッキング品質改善

**状態: ❌ 未着手**

#### 目標

Phase 2で実現した基本的なVisual-Inertial Fusionの品質を向上させる

#### 既知の課題と改善項目

| 課題 | 説明 | 優先度 |
| ---- | ---- | ------ |
| **距離に応じた平面サイズ** | カメラを近づけたり離したりしても平面メッシュのサイズが変わらない | 高 |
| **特徴点の固定化** | 検出した特徴点が動いてしまう。一度検出したら固定したい | 中 |
| **平面角度の精度** | 推定された平面の角度が実際の机の角度と若干異なる | 中 |

#### タスク

**2.5.1 距離追跡と平面スケール更新**

- [ ] カメラ距離の推定
  - [ ] 特徴点のスケール変化から相対距離を計算
  - [ ] 複数の安定特徴点間の距離比率で深度を更新
  - [ ] IMU加速度計は使用しない（ドリフトが大きすぎるため）
- [ ] 平面メッシュのスケール更新
  - [ ] 深度変化に応じた平面サイズの動的調整
  - [ ] スムーズなスケール変化（急激な変化を防止）

**2.5.2 特徴点の固定化**

- [ ] 特徴点ロック機構の実装
  - [ ] 初回検出時の特徴点位置を基準として保存
  - [ ] 追跡中の特徴点の位置更新を制限
  - [ ] ロックされた特徴点が見えなくなった場合の再取得戦略
- [ ] 特徴点の安定性評価強化
  - [ ] 追跡品質に基づく特徴点の選別
  - [ ] 不安定な特徴点の除外

**2.5.3 平面角度の精度向上**

- [ ] 平面フィッティングの改善
  - [ ] より多くの特徴点を使用した平面推定
  - [ ] 外れ値除去の強化（RANSAC閾値調整）
  - [ ] 時間的なスムージング（複数フレームの平均）
- [ ] IMU重力ベクトルとの整合性チェック
  - [ ] 水平面の場合、重力方向と法線の関係を利用
  - [ ] 角度の微調整

#### 設計メモ

**距離推定のアプローチ**

```
方法1: 特徴点スケール変化
- 同じ特徴点の見かけのサイズ変化を追跡
- 近づく → 特徴点間の距離が増加
- 離れる → 特徴点間の距離が減少

方法2: 深度推定モデルの継続利用
- 毎フレーム深度を再推定（計算コスト高）
- 差分のみを利用してスケール更新
```

**特徴点固定のアプローチ**

```
現状: 毎フレーム特徴点を再検出 → 位置が微妙にずれる
改善:
1. 初回検出時に「アンカー特徴点」を設定
2. 以降はオプティカルフロー追跡のみ使用
3. 追跡が失敗した場合のみ再検出
```

#### Phase 2.5 完了基準

- [ ] カメラを近づけると平面メッシュが大きく見える
- [ ] カメラを離すと平面メッシュが小さく見える
- [ ] 特徴点が安定して固定される（フレーム間でジッターしない）
- [ ] 平面の角度が実際の面により近い

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

| 指標           | 目標値    |
| -------------- | --------- |
| フレームレート | 30fps維持 |
| 位置誤差       | < 5cm     |
| 回転誤差       | < 5度     |
| 初期化時間     | < 3秒     |
| メモリ使用量   | < 500MB   |

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

| リスク                           | 対策                                     |
| -------------------------------- | ---------------------------------------- |
| **IMUドリフト**                  | Phase 2でVIO統合、視覚情報による定期補正 |
| デバイスモーション許可の取得失敗 | 視覚のみのフォールバック実装             |
| パフォーマンス劣化               | Worker分離、処理間引き                   |
| 追跡精度の不安定性               | 複数アルゴリズム併用、閾値調整           |

### 中リスク

| リスク             | 対策                     |
| ------------------ | ------------------------ |
| ブラウザ互換性問題 | Polyfill、機能検出       |
| メモリリーク       | キーフレーム上限、定期GC |
| WebGL描画性能      | LOD、カリング最適化      |

### 低リスク

| リスク                    | 対策             |
| ------------------------- | ---------------- |
| WebXR対応デバイスの限定性 | カスタム実装併用 |
| 外部ライブラリの依存関係  | オプショナル統合 |

---

## 成功指標

1. **機能性**: 平面が実世界位置で安定追跡される
2. **性能**: 30fps維持、500MB以下メモリ使用
3. **精度**: 位置誤差5cm以下、回転誤差5度以下
4. **安定性**: 10分間の連続使用でクラッシュなし
5. **互換性**: 主要ブラウザ（Chrome、Safari、Firefox）で動作

---

## 変更履歴

| 日付       | 内容                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------- |
| 2025-12-29 | **Phase 2実装完了**: ComplementaryFilter, DriftCorrector, 視覚補正統合                   |
| 2025-12-29 | **Phase 2.5追加**: 距離追跡、特徴点固定化、平面角度精度向上の計画                        |
| 2025-12-29 | **Phase 1実装完了**: DeviceMotionTracker, PoseRepresentation, IMUInitializer, SPALAM統合 |
| 2025-12-29 | Phase 1詳細化、専門家アドバイス反映、ドリフト対策を明記                                  |
| 2025-12-29 | 実装状況の詳細調査を反映、進捗表記を追加                                                 |

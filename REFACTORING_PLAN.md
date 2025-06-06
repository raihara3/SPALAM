# SPALAM リファクタリング計画

## 概要

SPALAM のリファクタリング計画。現状の課題を整理し、段階的な改善を目指す。

## 現状分析

### 1. 機能面の課題

- **機能不足**: SPALAM の機能が限定的
- **拡張性**: 新機能追加が困難
- **保守性**: コードが複雑化
- **依存関係**: OpenCV 等の依存が強い

### 2. 技術的課題

- **型安全性**: 型定義が不十分
- **テスト不足**: 単体テストが少ない
- **パフォーマンス**: 処理速度に課題
- **依存管理**: OpenCV 依存の最適化

## リファクタリング方針

### フェーズ 1: 基盤整備（11 月）

#### 1.1 開発環境整備

- [x] ESLint と Prettier の導入
- [x] TypeScript の strict mode 有効化
- [ ] Jest による単体テスト導入
- [ ] GitHub Actions による CI/CD 構築

#### 1.2 設定管理

- [x] `Config`の型定義整理
- [x] 設定ファイルの分離
- [x] 環境変数管理の導入

#### 1.3 コード品質向上

- [x] コード整形の自動化
- [x] コメント整備
- [x] 不要コードの削除

### フェーズ 2: 機能リファクタリング（11 月〜12 月）

#### 2.1 機能分割

- [x] `PlaneFittingService`の分離・最適化
- [x] `FrameProcessor`の責務分離・整理
- [x] `StateManager`の保守性向上

#### 2.2 非同期処理最適化

- [x] `EventEmitter`の型安全化
- [x] 非同期処理の Promise/async-await 化
- [x] エラーハンドリング強化

#### 2.3 依存性注入

- [x] DI コンテナの導入検討
- [x] 外部依存の抽象化
- [x] テスト容易性の向上

### フェーズ 3: 新機能追加（12 月〜1 月）

#### 3.1 FeatureDetector 拡張

- [x] 新しい特徴点検出アルゴリズムの追加
- [x] 設定項目の拡張
- [x] Web Worker 対応

#### 3.2 DepthEstimation 拡張

- [x] 新モデルの追加
- [x] 推論エンジンの切り替え
- [x] 並列処理の最適化

#### 3.3 ARRenderer 拡張

- [x] レンダリング最適化
- [x] 新機能追加
- [x] 設定項目の拡張

### フェーズ 4: API・公開対応（1 月）

#### 4.1 外部 API 設計

- [x] 直感的な Fluent API 設計
- [x] TypeScript 型定義の充実
- [x] JSDoc による API ドキュメント

#### 4.2 モジュール対応

- [ ] ESModule と CommonJS 両対応
- [ ] Tree-shaking 対応
- [ ] バンドルサイズ最適化

#### 4.3 公開準備

- [ ] npm 公開準備
- [ ] 公開用ドキュメント整備
- [ ] サンプルコード追加

### フェーズ 5: テスト・品質保証（1 月）

#### 5.1 テスト拡充

- [ ] 単体テストカバレッジ: 80%以上
- [ ] UI テスト
- [ ] E2E テスト

#### 5.2 品質保証

- [ ] API 互換性テスト
- [ ] 機能テスト
- [ ] パフォーマンステスト

#### 5.3 ドキュメント

- [ ] 開発者向けドキュメント整備
- [ ] 利用者向けガイド作成
- [ ] サンプルコード追加

## 設計例

### 型定義・クラス設計例

```typescript
// 設定型定義
interface SPALAMConfig {
  features: {
    maxCorners: number;
    qualityLevel: number;
    minDistance: number;
    // ...
  };
  depth: {
    modelId: string;
    device: "cpu" | "webgpu";
    // ...
  };
  plane: {
    ransacIterations: number;
    ransacThreshold: number;
    smoothingIterations: number;
    // ...
  };
}

// イベント型定義
interface SPALAMEvents {
  "frame:processed": (data: FrameData) => void;
  "plane:detected": (plane: PlaneData) => void;
  error: (error: Error) => void;
}

// クラス設計例
class SPALAM extends EventEmitter<SPALAMEvents> {
  private config: SPALAMConfig;
  private frameProcessor: FrameProcessor;
  private planeEstimator: PlaneEstimator;

  constructor(config?: Partial<SPALAMConfig>) {
    super();
    this.config = mergeWithDefaults(config);
    // 初期化
    this.frameProcessor = new FrameProcessor(this.config);
    this.planeEstimator = new PlaneEstimator(this.config);
  }

  async start(video: HTMLVideoElement): Promise<void> {
    await this.initialize();
    this.frameProcessor.on("frame", (frame) => {
      this.processFrame(frame);
    });
    this.frameProcessor.start(video);
  }

  // ...
}
```

## 優先度

1. **高**: フェーズ 1 基盤整備 - 早期着手
2. **中**: フェーズ 2.1 機能分割 - 機能リファクタリング
3. **中**: フェーズ 3 新機能追加 - 並行実施
4. **中**: フェーズ 4 API・公開 - 公開準備
5. **低**: フェーズ 5 テスト・品質保証 - 最終段階

## 課題とリスク

### 課題

1. **API 設計の難しさ**: 直感的な API 設計が必要
2. **新機能追加の難易度**: 機能追加時の設計負荷
3. **テスト拡充**: テスト自動化体制の整備

### リスク

1. **技術的負債**: 古い API や設計の残存
2. **開発遅延**: フェーズ間の依存による遅延
3. **品質低下**: テスト不足によるバグ混入

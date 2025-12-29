import * as THREE from "three";

/**
 * 相補フィルタの設定オプション
 */
export interface ComplementaryFilterOptions {
  /** IMU重み（0-1、高いほどIMUを信頼）デフォルト: 0.98 */
  alpha?: number;
  /** 最小視覚信頼度（これ以下では視覚を無視）デフォルト: 0.3 */
  minVisualConfidence?: number;
  /** スムージング係数（0-1、高いほど滑らか）デフォルト: 0.1 */
  smoothingFactor?: number;
}

/**
 * 相補フィルタ
 *
 * IMU（高周波・ドリフトあり）と視覚（低周波・安定）を組み合わせて
 * 安定した姿勢推定を実現する
 *
 * 融合式: output = alpha * imu + (1 - alpha) * visual
 * - alpha が高い（0.98）: IMUの高速応答を維持しつつ、視覚でドリフト補正
 * - alpha が低い（0.5）: 視覚をより信頼（ただし遅延が増える）
 */
export class ComplementaryFilter {
  private alpha: number;
  private baseAlpha: number;
  private minVisualConfidence: number;
  private smoothingFactor: number;

  private previousOutput: THREE.Quaternion | null = null;
  private lastVisualTimestamp: number = 0;

  constructor(options?: ComplementaryFilterOptions) {
    this.alpha = options?.alpha ?? 0.98;
    this.baseAlpha = this.alpha;
    this.minVisualConfidence = options?.minVisualConfidence ?? 0.3;
    this.smoothingFactor = options?.smoothingFactor ?? 0.1;
  }

  /**
   * IMU姿勢と視覚姿勢を融合
   *
   * @param imuOrientation IMUからの姿勢（クォータニオン）
   * @param visualOrientation 視覚からの姿勢（null可）
   * @param visualConfidence 視覚の信頼度（0-1）
   * @returns 融合された姿勢
   */
  public fuse(
    imuOrientation: THREE.Quaternion,
    visualOrientation: THREE.Quaternion | null,
    visualConfidence: number
  ): THREE.Quaternion {
    // 視覚情報がない、または信頼度が低い場合はIMUのみ使用
    if (!visualOrientation || visualConfidence < this.minVisualConfidence) {
      return this.applySmoothing(imuOrientation);
    }

    // 視覚情報のタイムスタンプを記録
    this.lastVisualTimestamp = Date.now();

    // 信頼度に基づいてalphaを動的調整
    this.updateAlpha(visualConfidence);

    // クォータニオンのSLERP（球面線形補間）で融合
    const fusedOrientation = new THREE.Quaternion();
    fusedOrientation.slerpQuaternions(
      visualOrientation,
      imuOrientation,
      this.alpha
    );

    return this.applySmoothing(fusedOrientation);
  }

  /**
   * 視覚信頼度に基づいてalphaを動的調整
   *
   * 高信頼度: alphaを下げて視覚を重視
   * 低信頼度: alphaを上げてIMUを重視
   */
  public updateAlpha(visualConfidence: number): void {
    // 信頼度が高いほどalphaを下げる（視覚を重視）
    // 例: confidence=1.0 -> alpha=0.90, confidence=0.5 -> alpha=0.95
    const adjustmentRange = 0.1; // baseAlphaからの調整幅
    const adjustment = adjustmentRange * (1 - visualConfidence);
    this.alpha = Math.max(
      0.5,
      Math.min(0.99, this.baseAlpha - adjustmentRange + adjustment)
    );
  }

  /**
   * スムージングを適用
   * 急激な姿勢変化を滑らかにする
   */
  private applySmoothing(orientation: THREE.Quaternion): THREE.Quaternion {
    if (!this.previousOutput) {
      this.previousOutput = orientation.clone();
      return orientation;
    }

    // SLERPでスムージング
    const smoothed = new THREE.Quaternion();
    smoothed.slerpQuaternions(
      this.previousOutput,
      orientation,
      1 - this.smoothingFactor
    );

    this.previousOutput = smoothed.clone();
    return smoothed;
  }

  /**
   * ドリフト補正用：視覚姿勢で強制リセット
   *
   * @param visualOrientation 基準となる視覚姿勢
   */
  public resetToVisual(visualOrientation: THREE.Quaternion): void {
    this.previousOutput = visualOrientation.clone();
    this.lastVisualTimestamp = Date.now();
  }

  /**
   * 最後の視覚更新からの経過時間を取得
   */
  public getTimeSinceLastVisualUpdate(): number {
    if (this.lastVisualTimestamp === 0) {
      return Infinity;
    }
    return Date.now() - this.lastVisualTimestamp;
  }

  /**
   * 視覚情報が古くなっているか判定
   *
   * @param thresholdMs 閾値（ミリ秒）デフォルト: 1000ms
   */
  public isVisualStale(thresholdMs: number = 1000): boolean {
    return this.getTimeSinceLastVisualUpdate() > thresholdMs;
  }

  /**
   * 現在のalpha値を取得
   */
  public getAlpha(): number {
    return this.alpha;
  }

  /**
   * 設定をリセット
   */
  public reset(): void {
    this.alpha = this.baseAlpha;
    this.previousOutput = null;
    this.lastVisualTimestamp = 0;
  }

  /**
   * リソース解放
   */
  public dispose(): void {
    this.reset();
  }
}

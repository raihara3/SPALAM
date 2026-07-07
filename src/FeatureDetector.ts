/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

// types
import { Feature } from "./types";

// helpers
import { selectFeaturesByGrid } from "./helpers/selectFeaturesByGrid";
import { computeForwardBackwardMask } from "./helpers/computeForwardBackwardMask";

/**
 * 特徴点検出領域
 * - "center": 中央60%×60%のROI（従来動作）
 * - "full":   全画面（縁5%マージンを除く）。環境全体のマップ構築用
 */
export type FeatureDetectionRegion = "center" | "full";

/**
 * グリッドバケッティングの設定
 */
export interface FeatureGridOptions {
  /** グリッド行数 */
  rows: number;
  /** グリッド列数 */
  columns: number;
  /** セルあたり最大特徴点数（0で自動: 均等割り当ての2倍） */
  maxFeaturesPerCell: number;
}

export class FeatureDetector {
  readonly cv: typeof cv;
  readonly video: HTMLVideoElement;
  // Display canvas - full resolution for high quality display
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  // Processing canvas - scaled resolution for OpenCV (not displayed)
  private readonly processCanvas: HTMLCanvasElement;
  private readonly processCtx: CanvasRenderingContext2D;

  // Resolution scale factor for performance (0.5 = half resolution = 4x fewer pixels)
  private readonly resolutionScale: number = 0.5;
  // Store original video dimensions for coordinate conversion
  private readonly originalWidth: number;
  private readonly originalHeight: number;

  private readonly maxCorners: number = 800; // 最大特徴点数
  private readonly qualityLevel: number = 0.001; // 特徴点の質。小さいほど高品質
  private readonly minDistance: number = 5; // 特徴点間の最小距離。密集するのを防ぐ
  private readonly blockSize: number = 3; // 特徴点検出のための近傍領域のサイズ。奇数である必要がある
  private readonly useHarrisDetector: boolean = false; // Harrisコーナー検出器を使用するかどうか
  private readonly k: number = 0.04; // Harrisコーナー検出器のパラメータ。一般的に0.04から0.06の範囲で使用される
  private readonly disableRedetection: boolean = true; // 初回検出後の再検出を無効化するか
  private readonly detectionRegion: FeatureDetectionRegion; // 特徴点検出領域
  private readonly forwardBackwardThreshold: number; // FBチェックの往復誤差しきい値（処理解像度px、0以下で無効）
  private readonly grid: FeatureGridOptions | null; // グリッドバケッティング設定（nullで無効）

  private prevGray: cv.Mat | null = null; // 前フレームのグレースケール画像
  private prevFeatures: Feature[] = []; // 前フレームの特徴点
  private nextFeatureId: number = 0;
  private redetectionAllowed: boolean = false; // 外部から再検出が許可されているか

  trackedFeatures: Feature[] = []; // トラッキングされた特徴点
  centerFeature: Feature | null = null; // 中心特徴点
  private debugOverlay: HTMLDivElement | null = null; // デバッグ表示用
  private targetPosition: { x: number; y: number } | null = null; // 再配置時のターゲット座標
  private drawFeaturesEnabled: boolean = false; // 特徴点描画の有効/無効フラグ
  private trackingStarted: boolean = false; // 追跡が開始されたかどうか
  private currentScale: number = 1.0; // 現在のスケール値（描画サイズに反映）

  // Reusable OpenCV Mat objects to prevent memory allocation every frame
  private pooledMask: cv.Mat | null = null;
  private pooledGray: cv.Mat | null = null;
  private pooledSrc: cv.Mat | null = null;
  // ORB extractor for relocalization descriptors (lazily created)
  private orbExtractor: cv.Feature2D | null = null;
  private lastPooledWidth: number = 0;
  private lastPooledHeight: number = 0;

  constructor({
    cv: cvInstance,
    video,
    canvas = null,
    showFeatures = false,
    disableRedetection = true,
    detectionRegion = "center",
    forwardBackwardThreshold = 0,
    grid = null,
  }: {
    cv: typeof cv;
    video: HTMLVideoElement;
    canvas?: HTMLCanvasElement | null;
    showFeatures: boolean;
    disableRedetection?: boolean;
    detectionRegion?: FeatureDetectionRegion;
    forwardBackwardThreshold?: number;
    grid?: FeatureGridOptions | null;
  }) {
    this.cv = cvInstance;
    this.video = video;
    this.disableRedetection = disableRedetection;
    this.detectionRegion = detectionRegion;
    this.forwardBackwardThreshold = forwardBackwardThreshold;
    this.grid = grid;

    // Store original dimensions for coordinate conversion
    this.originalWidth = video.videoWidth;
    this.originalHeight = video.videoHeight;

    // Display canvas - full resolution for high quality video display
    this.canvas = canvas || document.createElement("canvas");
    this.canvas.id = "featureCanvas";
    this.canvas.width = video.videoWidth;
    this.canvas.height = video.videoHeight;
    this.ctx = this.canvas.getContext("2d")!;

    // Processing canvas - scaled resolution for OpenCV feature detection
    this.processCanvas = document.createElement("canvas");
    this.processCanvas.id = "featureProcessCanvas";
    this.processCanvas.width = Math.floor(
      video.videoWidth * this.resolutionScale
    );
    this.processCanvas.height = Math.floor(
      video.videoHeight * this.resolutionScale
    );
    this.processCtx = this.processCanvas.getContext("2d")!;

    console.log(
      `FeatureDetector: Display ${this.canvas.width}x${this.canvas.height}, ` +
        `Processing ${this.processCanvas.width}x${this.processCanvas.height} ` +
        `(scale: ${this.resolutionScale})`
    );

    if (showFeatures) {
      document.body.appendChild(this.canvas);
    }

    // デバッグオーバーレイを作成
    this.debugOverlay = document.createElement("div");
    this.debugOverlay.id = "featureDebugOverlay";
    this.debugOverlay.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(0,0,0,0.7);
      color: #0f0;
      font-family: monospace;
      font-size: 14px;
      padding: 10px;
      border-radius: 5px;
      z-index: 9999;
      pointer-events: none;
    `;
    document.body.appendChild(this.debugOverlay);

    this.render();
  }

  private updateDebugOverlay(info: Record<string, unknown>): void {
    if (!this.debugOverlay) return;
    const lines = Object.entries(info).map(([k, v]) => `${k}: ${v}`);
    this.debugOverlay.innerHTML = lines.join("<br>");
  }

  public render() {
    // Draw video at full resolution to display canvas
    this.ctx.drawImage(this.video, 0, 0);

    // Draw video at scaled resolution to processing canvas (for OpenCV)
    this.processCtx.drawImage(
      this.video,
      0,
      0,
      this.processCanvas.width,
      this.processCanvas.height
    );

    try {
      const features = this.detectAndTrackFeatures();
      this.drawFeatures(features);
    } catch (error) {
      console.error("Feature detection error:", error);
      // エラーが発生しても映像は更新される
    }
  }

  /**
   * Get original video width (before scaling)
   */
  public getOriginalWidth(): number {
    return this.originalWidth;
  }

  /**
   * Get original video height (before scaling)
   */
  public getOriginalHeight(): number {
    return this.originalHeight;
  }

  /**
   * Get resolution scale factor
   */
  public getResolutionScale(): number {
    return this.resolutionScale;
  }

  private generateFeatureId(): string {
    return `feature_${this.nextFeatureId++}`;
  }

  /**
   * Get or create pooled Mat objects to avoid allocation every frame
   */
  private getPooledMats(
    width: number,
    height: number
  ): { mask: cv.Mat; gray: cv.Mat; src: cv.Mat } {
    // Check if we need to recreate (size changed)
    const needsRecreate =
      width !== this.lastPooledWidth || height !== this.lastPooledHeight;

    if (needsRecreate) {
      // Delete old mats if they exist
      if (this.pooledMask) this.pooledMask.delete();
      if (this.pooledGray) this.pooledGray.delete();
      if (this.pooledSrc) this.pooledSrc.delete();

      // Create new mats
      this.pooledMask = this.cv.Mat.zeros(height, width, this.cv.CV_8UC1);
      this.pooledGray = new this.cv.Mat();
      this.pooledSrc = new this.cv.Mat();

      this.lastPooledWidth = width;
      this.lastPooledHeight = height;
    }

    return {
      mask: this.pooledMask!,
      gray: this.pooledGray!,
      src: this.pooledSrc!,
    };
  }

  /**
   * goodFeaturesToTrackで特徴点を検出し、グリッドバケッティングで
   * 空間分布を整えた特徴点リストを返す
   *
   * 姿勢推定の精度は特徴点の空間分布に強く依存するため、品質順の
   * 候補からセルごとのクォータ内で選択して密集を抑える。
   */
  private detectNewFeatures(
    gray: cv.Mat,
    mask: cv.Mat,
    maxCount: number
  ): Feature[] {
    const points = new this.cv.Mat();
    try {
      this.cv.goodFeaturesToTrack(
        gray,
        points,
        maxCount,
        this.qualityLevel,
        this.minDistance,
        mask,
        this.blockSize,
        this.useHarrisDetector,
        this.k
      );

      // goodFeaturesToTrackは品質順（強い順）に返す
      const candidates: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < points.rows; i++) {
        candidates.push({
          x: points.data32F[i * 2],
          y: points.data32F[i * 2 + 1],
        });
      }

      const selected = this.grid
        ? selectFeaturesByGrid(candidates, {
            imageWidth: gray.cols,
            imageHeight: gray.rows,
            rows: this.grid.rows,
            columns: this.grid.columns,
            maxFeatures: maxCount,
            maxFeaturesPerCell: this.grid.maxFeaturesPerCell,
          })
        : candidates;

      return selected.map((point) => ({
        x: point.x,
        y: point.y,
        trackingCount: 1,
        id: this.generateFeatureId(),
      }));
    } finally {
      points.delete();
    }
  }

  /**
   * 画像から特徴点を検出し、前フレームの特徴点と照合
   */
  private detectAndTrackFeatures(): Feature[] {
    // 1) 入力サイズ取得 (processing canvas - scaled resolution)
    const W = this.processCanvas.width;
    const H = this.processCanvas.height;

    // Get pooled Mat objects
    const { mask, gray } = this.getPooledMats(W, H);

    // 2) マスクを作成（"center": 中央60%×60%のみ、"full": 縁5%を除く全画面）
    // Reset mask to zeros first
    mask.setTo(new this.cv.Scalar(0));
    // roi()が返すMatヘッダはOpenCV.jsでは明示的にdeleteが必要
    let maskRoi: cv.Mat;
    if (this.detectionRegion === "full") {
      const marginX = Math.floor(W * 0.05);
      const marginY = Math.floor(H * 0.05);
      maskRoi = mask.roi(
        new this.cv.Rect(marginX, marginY, W - marginX * 2, H - marginY * 2)
      );
    } else {
      const roiX = Math.floor(W * 0.2);
      const roiY = Math.floor(H * 0.2);
      const roiW = Math.floor(W * 0.6);
      const roiH = Math.floor(H * 0.6);
      maskRoi = mask.roi(new this.cv.Rect(roiX, roiY, roiW, roiH));
    }
    maskRoi.setTo(new this.cv.Scalar(255));
    maskRoi.delete();

    // 3) グレースケール画像を作成 - read from processing canvas (scaled)
    const src = this.cv.imread(this.processCanvas);
    this.cv.cvtColor(src, gray, this.cv.COLOR_RGBA2GRAY);

    // 4) Convert to gradient magnitude image so that optical flow
    //    tracks structural edges (high gradient) rather than shadows
    //    (low, smooth gradient). This makes tracking shadow-invariant.
    const gradX = new this.cv.Mat();
    const gradY = new this.cv.Mat();
    this.cv.Sobel(gray, gradX, this.cv.CV_16S, 1, 0);
    this.cv.Sobel(gray, gradY, this.cv.CV_16S, 0, 1);
    this.cv.convertScaleAbs(gradX, gradX);
    this.cv.convertScaleAbs(gradY, gradY);
    this.cv.addWeighted(gradX, 0.5, gradY, 0.5, 0, gray);
    gradX.delete();
    gradY.delete();

    try {
      // 4) 初回検出 or 追跡点不足時の特徴点検出
      if (!this.prevGray) {
        const features = this.detectNewFeatures(gray, mask, this.maxCorners);
        this.prevFeatures = features;
        this.prevGray = gray.clone();
        return features;
      }

      // 5) 追跡する特徴点がない場合の処理
      if (this.prevFeatures.length === 0) {
        this.updateDebugOverlay({
          status: "LOST",
          redetectionAllowed: this.redetectionAllowed,
          features: 0,
        });

        // 外部から再検出が許可されていない場合は待機
        if (!this.redetectionAllowed) {
          this.prevGray.delete();
          this.prevGray = gray.clone();
          this.trackedFeatures = [];
          return [];
        }

        // 再検出を実行
        const features = this.detectNewFeatures(gray, mask, this.maxCorners);

        // 特徴点が検出された場合のみ状態をリセット
        if (features.length > 0) {
          this.updateDebugOverlay({
            status: "REDETECTED",
            features: features.length,
          });
          this.redetectionAllowed = false; // 再検出完了後はフラグをリセット
          this.prevFeatures = features;
          this.prevGray.delete();
          this.prevGray = gray.clone();
          this.trackedFeatures = features;
          return features;
        }

        // 特徴点が検出されなかった場合は引き続き待機
        this.prevGray.delete();
        this.prevGray = gray.clone();
        this.trackedFeatures = [];
        return [];
      }

      // 6) オプティカルフローで追跡
      // OpenCV例外時のMatリークを防ぐため、確保したMatはfinallyで解放する
      const flowMats: cv.Mat[] = [];
      const allocateMat = (rows?: number, cols?: number, type?: number) => {
        const mat =
          rows !== undefined && cols !== undefined && type !== undefined
            ? new this.cv.Mat(rows, cols, type)
            : new this.cv.Mat();
        flowMats.push(mat);
        return mat;
      };

      const trackedFeatures: Feature[] = [];
      try {
        const prevPoints = allocateMat(
          this.prevFeatures.length,
          1,
          this.cv.CV_32FC2
        );
        for (let i = 0; i < this.prevFeatures.length; i++) {
          prevPoints.data32F[i * 2] = this.prevFeatures[i].x;
          prevPoints.data32F[i * 2 + 1] = this.prevFeatures[i].y;
        }

        const nextPoints = allocateMat();
        const status = allocateMat();
        const err = allocateMat();

        this.cv.calcOpticalFlowPyrLK(
          this.prevGray,
          gray,
          prevPoints,
          nextPoints,
          status,
          err
        );

        // 6.5) Forward-Backwardチェック: curr → prev に逆追跡し、往復誤差が
        //      しきい値を超える点（オクルージョン境界や繰り返しテクスチャで
        //      別の構造に滑った点）を棄却する
        let forwardBackwardMask: boolean[] | null = null;
        if (this.forwardBackwardThreshold > 0) {
          const backwardPoints = allocateMat();
          const backwardStatus = allocateMat();
          const backwardError = allocateMat();
          this.cv.calcOpticalFlowPyrLK(
            gray,
            this.prevGray,
            nextPoints,
            backwardPoints,
            backwardStatus,
            backwardError
          );

          const backwardPositions: Array<{ x: number; y: number }> = [];
          for (let i = 0; i < this.prevFeatures.length; i++) {
            backwardPositions.push({
              x: backwardPoints.data32F[i * 2],
              y: backwardPoints.data32F[i * 2 + 1],
            });
          }
          forwardBackwardMask = computeForwardBackwardMask({
            previousPoints: this.prevFeatures,
            backwardPoints: backwardPositions,
            forwardStatus: status.data,
            backwardStatus: backwardStatus.data,
            threshold: this.forwardBackwardThreshold,
          });
        }

        // 追跡結果を配列に変換
        for (let i = 0; i < status.rows; i++) {
          const isTracked = forwardBackwardMask
            ? forwardBackwardMask[i]
            : status.data[i] === 1;
          if (isTracked) {
            // 追跡成功
            trackedFeatures.push({
              x: nextPoints.data32F[i * 2],
              y: nextPoints.data32F[i * 2 + 1],
              trackingCount: this.prevFeatures[i].trackingCount + 1,
              id: this.prevFeatures[i].id,
            });
          }
        }
      } finally {
        flowMats.forEach((mat) => mat.delete());
      }

      // 7) 追跡点が少なければ追加検出（disableRedetection が true の場合はスキップ）
      if (
        !this.disableRedetection &&
        trackedFeatures.length < this.maxCorners * 0.3
      ) {
        trackedFeatures.push(
          ...this.detectNewFeatures(
            gray,
            mask,
            this.maxCorners - trackedFeatures.length
          )
        );
      }

      // 8) フレーム更新
      this.prevGray.delete();
      this.prevGray = gray.clone();
      this.prevFeatures = trackedFeatures;

      this.trackedFeatures = trackedFeatures;

      this.updateDebugOverlay({
        status: "TRACKING",
        features: trackedFeatures.length,
      });

      return trackedFeatures;
    } finally {
      // Only delete src - gray and mask are pooled and reused
      src.delete();
    }
  }

  public reset() {
    if (this.prevGray) {
      this.prevGray.delete();
      this.prevGray = null;
    }
    this.prevFeatures = [];
    this.redetectionAllowed = false;
    this.trackingStarted = false;
    this.centerFeature = null;
  }

  /**
   * Cleanup pooled Mat objects - call when detector is no longer needed
   */
  public dispose(): void {
    this.reset();
    if (this.pooledMask) {
      this.pooledMask.delete();
      this.pooledMask = null;
    }
    if (this.pooledGray) {
      this.pooledGray.delete();
      this.pooledGray = null;
    }
    if (this.pooledSrc) {
      this.pooledSrc.delete();
      this.pooledSrc = null;
    }
    if (this.orbExtractor) {
      this.orbExtractor.delete();
      this.orbExtractor = null;
    }
    this.lastPooledWidth = 0;
    this.lastPooledHeight = 0;
  }

  /**
   * 特徴点が失われているかどうかを返す
   */
  public hasLostFeatures(): boolean {
    return this.prevGray !== null && this.prevFeatures.length === 0;
  }

  /**
   * 再検出を許可する（外部から呼び出し）
   * Frustum判定などで画角内にオブジェクトが入ったときに呼び出す
   */
  public allowRedetection(): void {
    this.redetectionAllowed = true;
  }

  /**
   * 再配置時のターゲット座標を設定
   * 設定された座標に最も近い特徴点がcenterFeatureとして選択される
   * @param x スクリーンX座標（ピクセル）
   * @param y スクリーンY座標（ピクセル）
   */
  public setTargetPosition(x: number, y: number): void {
    this.targetPosition = { x, y };
  }

  /**
   * ターゲット座標をクリア（画面中央を使用するようにリセット）
   */
  public clearTargetPosition(): void {
    this.targetPosition = null;
  }

  /**
   * 特徴点の描画
   * Features are in processCanvas coordinates (scaled), scaled up for display canvas
   */
  private drawFeatures(features: Feature[]): void {
    // centerFeatureの選択は常に実行（描画の有無に関わらず必要）
    if (this.trackedFeatures) {
      this.findNearestStableFeature(this.trackedFeatures);
    }

    // 描画が無効の場合はスキップ
    if (!this.drawFeaturesEnabled) {
      return;
    }

    // Scale factor to convert from processCanvas to display canvas coordinates
    const scaleUp = 1 / this.resolutionScale;

    features.forEach((feature) => {
      const isCenter =
        this.centerFeature && feature.id === this.centerFeature.id;

      // Scale up coordinates for display canvas
      const displayX = feature.x * scaleUp;
      const displayY = feature.y * scaleUp;

      // Scale-aware feature point size (base: 5px for center, 3px for others)
      const baseRadius = isCenter ? 5 : 3;
      const scaledRadius = Math.max(1, baseRadius * this.currentScale);

      this.ctx.beginPath();
      this.ctx.arc(displayX, displayY, scaledRadius, 0, 2 * Math.PI);
      this.ctx.fillStyle = isCenter ? "#FFFF00" : "#FF0000";
      this.ctx.fill();
    });
  }

  /**
   * 特徴点描画の有効/無効を設定
   */
  public setDrawFeaturesEnabled(enabled: boolean): void {
    this.drawFeaturesEnabled = enabled;
  }

  /**
   * 特徴点描画が有効かどうかを取得
   */
  public isDrawFeaturesEnabled(): boolean {
    return this.drawFeaturesEnabled;
  }

  /**
   * 現在のスケール値を設定（描画サイズに反映）
   */
  public setScale(scale: number): void {
    this.currentScale = scale;
  }

  /**
   * 現在のスケール値を取得
   */
  public getScale(): number {
    return this.currentScale;
  }

  /**
   * ターゲット座標に最も近い安定した特徴点を見つける
   * ターゲットが設定されていない場合は画面中央を使用
   */
  private findNearestStableFeature(features: Feature[]): Feature | null {
    // 追跡が開始済みで centerFeature が null の場合、
    // 明示的な再配置要求（targetPosition）がない限り新しい特徴点を探さない
    if (this.trackingStarted && !this.centerFeature && !this.targetPosition) {
      return null;
    }

    // 現在の中心特徴点が存在し、ターゲット座標が設定されていない場合（通常の追跡中）
    if (this.centerFeature && !this.targetPosition) {
      const currentFeature = features.find(
        (f) => f.id === this.centerFeature!.id && this.isFeatureValid(f)
      );
      if (currentFeature) {
        // 現在の centerFeature が有効なら継続使用
        this.centerFeature = currentFeature;
        return currentFeature;
      } else {
        // centerFeature が無効になった場合は null にする
        // 自動で新しい特徴点を探さない（オブジェクトは固定位置に留まる）
        this.centerFeature = null;
        return null;
      }
    }

    // 以下は初回検出時 または 再配置時（targetPosition が設定されている場合）のみ実行
    // ターゲット座標が設定されている場合はそれを使用、なければ画面中央
    // Note: targetPosition is in display canvas coordinates, convert to processCanvas coordinates
    const targetX =
      (this.targetPosition?.x ?? this.canvas.width / 2) * this.resolutionScale;
    const targetY =
      (this.targetPosition?.y ?? this.canvas.height / 2) * this.resolutionScale;
    let nearestFeature: Feature | null = null;
    let minDistance = Infinity;

    // ターゲット座標に最も近い特徴点を探す
    features.forEach((feature) => {
      if (!this.isFeatureValid(feature)) return;

      const distance = Math.sqrt(
        Math.pow(feature.x - targetX, 2) + Math.pow(feature.y - targetY, 2)
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestFeature = feature;
      }
    });

    // 新しい特徴点が見つかった場合、それを中心特徴点として設定
    if (nearestFeature) {
      this.centerFeature = nearestFeature;
      this.trackingStarted = true;
      // ターゲット座標をクリア（再配置完了）
      if (this.targetPosition) {
        this.targetPosition = null;
      }
    } else {
      this.centerFeature = null;
    }

    return nearestFeature;
  }

  /**
   * 特徴点が有効かどうかを判定
   * Note: Features are in processCanvas coordinates (scaled)
   */
  private isFeatureValid(feature: Feature): boolean {
    const w = this.processCanvas.width;
    const h = this.processCanvas.height;
    return (
      // 画面内に収まっているか
      feature.x >= 0 &&
      feature.x <= w &&
      feature.y >= 0 &&
      feature.y <= h &&
      // 一定フレーム以上追跡できているか
      feature.trackingCount >= 5 && // 安定性を高めるため5フレームに増やす
      // 画面端すぎない位置にあるか
      feature.x > w * 0.1 &&
      feature.x < w * 0.9 &&
      feature.y > h * 0.1 &&
      feature.y < h * 0.9
    );
  }

  /**
   * 指定した特徴点位置のORB記述子を現在の内部画像上で計算する
   *
   * relocalization用。記述子は勾配強度画像（オプティカルフローと同じ表現）
   * 上で計算されるため、保存側と照合側で一貫していれば有効に機能する。
   * 画像端に近いキーポイントはORBにより間引かれるため、返るidsは
   * 記述子Matの行と正確に整列した部分集合になる。
   *
   * @param features 特徴点（元解像度座標）
   * @returns 記述子Mat（呼び出し側がdeleteする）と行対応の特徴点IDリスト。
   *          計算できない場合はnull
   */
  public computeDescriptorsForFeatures(
    features: Feature[]
  ): { descriptors: cv.Mat; ids: string[] } | null {
    if (!this.prevGray || features.length === 0) {
      return null;
    }
    if (!this.orbExtractor) {
      this.orbExtractor = new this.cv.ORB();
    }

    const keypoints = new this.cv.KeyPointVector();
    const featureIdByPosition = new Map<string, string>();
    const positionKey = (x: number, y: number) =>
      `${Math.round(x * 10)},${Math.round(y * 10)}`;

    try {
      for (const feature of features) {
        const x = feature.x * this.resolutionScale;
        const y = feature.y * this.resolutionScale;
        keypoints.push_back({
          pt: { x, y },
          size: 31,
          angle: -1,
          response: 0,
          octave: 0,
          class_id: -1,
        });
        featureIdByPosition.set(positionKey(x, y), feature.id);
      }

      let descriptors: cv.Mat | null = null;
      try {
        descriptors = new this.cv.Mat();
        this.orbExtractor.compute(this.prevGray, keypoints, descriptors);

        const ids: string[] = [];
        let aligned = true;
        for (let i = 0; i < keypoints.size(); i++) {
          const keypoint = keypoints.get(i);
          const id = featureIdByPosition.get(
            positionKey(keypoint.pt.x, keypoint.pt.y)
          );
          if (!id) {
            aligned = false;
            break;
          }
          ids.push(id);
        }

        if (!aligned || descriptors.rows !== ids.length || ids.length === 0) {
          descriptors.delete();
          return null;
        }
        return { descriptors, ids };
      } catch (error) {
        descriptors?.delete();
        console.warn("Descriptor computation failed:", error);
        return null;
      }
    } finally {
      keypoints.delete();
    }
  }

  public getTrackedFeaturePoints(): Feature[] {
    const inverseScale = 1 / this.resolutionScale;
    return this.trackedFeatures
      .filter((feature) => feature.trackingCount >= 5)
      .map((feature) => ({
        ...feature,
        // Scale coordinates back to original video dimensions
        x: feature.x * inverseScale,
        y: feature.y * inverseScale,
      }));
  }

  /**
   * Get center feature with coordinates scaled to original video dimensions
   */
  public getCenterFeatureScaled(): Feature | null {
    if (!this.centerFeature) return null;
    const inverseScale = 1 / this.resolutionScale;
    return {
      ...this.centerFeature,
      x: this.centerFeature.x * inverseScale,
      y: this.centerFeature.y * inverseScale,
    };
  }
}

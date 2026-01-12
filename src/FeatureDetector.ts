// types
import { Feature } from "./types";

export class FeatureDetector {
  readonly cv: typeof cv;
  readonly video: HTMLVideoElement;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

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

  // Reusable OpenCV Mat objects to prevent memory allocation every frame
  private pooledMask: cv.Mat | null = null;
  private pooledGray: cv.Mat | null = null;
  private pooledSrc: cv.Mat | null = null;
  private lastPooledWidth: number = 0;
  private lastPooledHeight: number = 0;

  constructor({
    cv: cvInstance,
    video,
    canvas = null,
    showFeatures = false,
    disableRedetection = true,
  }: {
    cv: typeof cv;
    video: HTMLVideoElement;
    canvas?: HTMLCanvasElement | null;
    showFeatures: boolean;
    disableRedetection?: boolean;
  }) {
    this.cv = cvInstance;
    this.video = video;
    this.disableRedetection = disableRedetection;

    // Store original dimensions for coordinate conversion
    this.originalWidth = video.videoWidth;
    this.originalHeight = video.videoHeight;

    this.canvas = canvas || document.createElement("canvas");
    this.canvas.id = "featureCanvas";
    // Use scaled resolution for better performance (0.5 = half resolution)
    this.canvas.width = Math.floor(video.videoWidth * this.resolutionScale);
    this.canvas.height = Math.floor(video.videoHeight * this.resolutionScale);

    console.log(
      `FeatureDetector: Using scaled resolution ${this.canvas.width}x${this.canvas.height} ` +
        `(original: ${this.originalWidth}x${this.originalHeight}, scale: ${this.resolutionScale})`
    );

    this.ctx = this.canvas.getContext("2d")!;

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
    // Draw video scaled to canvas size
    this.ctx.drawImage(
      this.video,
      0,
      0,
      this.canvas.width,
      this.canvas.height
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
   * 画像から特徴点を検出し、前フレームの特徴点と照合
   */
  private detectAndTrackFeatures(): Feature[] {
    // 1) 入力サイズ取得
    const W = this.canvas.width;
    const H = this.canvas.height;

    // Get pooled Mat objects
    const { mask, gray } = this.getPooledMats(W, H);

    // 2) マスクを作成（中央60%×60%だけ検出許可）
    // Reset mask to zeros first
    mask.setTo(new this.cv.Scalar(0));
    const roiX = Math.floor(W * 0.2);
    const roiY = Math.floor(H * 0.2);
    const roiW = Math.floor(W * 0.6);
    const roiH = Math.floor(H * 0.6);
    mask
      .roi(new this.cv.Rect(roiX, roiY, roiW, roiH))
      .setTo(new this.cv.Scalar(255));

    // 3) グレースケール画像を作成 - use imread which creates new Mat each time
    // but reuse gray Mat for cvtColor output
    const src = this.cv.imread(this.canvas);
    this.cv.cvtColor(src, gray, this.cv.COLOR_RGBA2GRAY);

    try {
      // 4) 初回検出 or 追跡点不足時の特徴点検出
      if (!this.prevGray) {
        const points = new this.cv.Mat();
        this.cv.goodFeaturesToTrack(
          gray,
          points,
          this.maxCorners,
          this.qualityLevel,
          this.minDistance,
          mask, // ← マスクを渡す
          this.blockSize,
          this.useHarrisDetector,
          this.k
        );

        // 特徴点を配列に変換
        const features: Feature[] = [];
        for (let i = 0; i < points.rows; i++) {
          features.push({
            x: points.data32F[i * 2],
            y: points.data32F[i * 2 + 1],
            trackingCount: 1,
            id: this.generateFeatureId(),
          });
        }
        points.delete();
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
        const points = new this.cv.Mat();
        this.cv.goodFeaturesToTrack(
          gray,
          points,
          this.maxCorners,
          this.qualityLevel,
          this.minDistance,
          mask,
          this.blockSize,
          this.useHarrisDetector,
          this.k
        );

        const features: Feature[] = [];
        for (let i = 0; i < points.rows; i++) {
          features.push({
            x: points.data32F[i * 2],
            y: points.data32F[i * 2 + 1],
            trackingCount: 1,
            id: this.generateFeatureId(),
          });
        }
        points.delete();

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
      const prevPoints = new this.cv.Mat(
        this.prevFeatures.length,
        1,
        this.cv.CV_32FC2
      );
      for (let i = 0; i < this.prevFeatures.length; i++) {
        prevPoints.data32F[i * 2] = this.prevFeatures[i].x;
        prevPoints.data32F[i * 2 + 1] = this.prevFeatures[i].y;
      }

      const nextPoints = new this.cv.Mat();
      const status = new this.cv.Mat();
      const err = new this.cv.Mat();

      this.cv.calcOpticalFlowPyrLK(
        this.prevGray,
        gray,
        prevPoints,
        nextPoints,
        status,
        err
      );
      prevPoints.delete();
      err.delete();

      // 追跡結果を配列に変換
      const trackedFeatures: Feature[] = [];
      for (let i = 0; i < status.rows; i++) {
        if (status.data[i] === 1) {
          // 追跡成功
          trackedFeatures.push({
            x: nextPoints.data32F[i * 2],
            y: nextPoints.data32F[i * 2 + 1],
            trackingCount: this.prevFeatures[i].trackingCount + 1,
            id: this.prevFeatures[i].id,
          });
        }
      }
      nextPoints.delete();
      status.delete();

      // 7) 追跡点が少なければ追加検出（disableRedetection が true の場合はスキップ）
      if (
        !this.disableRedetection &&
        trackedFeatures.length < this.maxCorners * 0.3
      ) {
        const points = new this.cv.Mat();
        this.cv.goodFeaturesToTrack(
          gray,
          points,
          this.maxCorners - trackedFeatures.length,
          this.qualityLevel,
          this.minDistance,
          mask, // ← こちらもマスクを渡す
          this.blockSize,
          this.useHarrisDetector,
          this.k
        );

        for (let i = 0; i < points.rows; i++) {
          trackedFeatures.push({
            x: points.data32F[i * 2],
            y: points.data32F[i * 2 + 1],
            trackingCount: 1,
            id: this.generateFeatureId(),
          });
        }
        points.delete();
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

    features.forEach((feature) => {
      const isCenter =
        this.centerFeature && feature.id === this.centerFeature.id;

      this.ctx.beginPath();
      this.ctx.arc(feature.x, feature.y, isCenter ? 5 : 3, 0, 2 * Math.PI);
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
    const targetX = this.targetPosition?.x ?? this.canvas.width / 2;
    const targetY = this.targetPosition?.y ?? this.canvas.height / 2;
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
   */
  private isFeatureValid(feature: Feature): boolean {
    return (
      // 画面内に収まっているか
      feature.x >= 0 &&
      feature.x <= this.canvas.width &&
      feature.y >= 0 &&
      feature.y <= this.canvas.height &&
      // 一定フレーム以上追跡できているか
      feature.trackingCount >= 5 && // 安定性を高めるため5フレームに増やす
      // 画面端すぎない位置にあるか
      feature.x > this.canvas.width * 0.1 &&
      feature.x < this.canvas.width * 0.9 &&
      feature.y > this.canvas.height * 0.1 &&
      feature.y < this.canvas.height * 0.9
    );
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

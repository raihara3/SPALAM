// types
import { Feature } from "./types";

export class FeatureDetector {
  readonly cv: any;
  readonly video: HTMLVideoElement;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  private readonly maxCorners: number = 800; // 最大特徴点数
  private readonly qualityLevel: number = 0.001; // 特徴点の質。小さいほど高品質
  private readonly minDistance: number = 5; // 特徴点間の最小距離。密集するのを防ぐ
  private readonly blockSize: number = 3; // 特徴点検出のための近傍領域のサイズ。奇数である必要がある
  private readonly useHarrisDetector: boolean = false; // Harrisコーナー検出器を使用するかどうか
  private readonly k: number = 0.04; // Harrisコーナー検出器のパラメータ。一般的に0.04から0.06の範囲で使用される

  private prevGray: any = null; // 前フレームのグレースケール画像
  private prevFeatures: Feature[] = []; // 前フレームの特徴点
  private nextFeatureId: number = 0;

  trackedFeatures: Feature[] = []; // トラッキングされた特徴点
  centerFeature: Feature | null = null; // 中心特徴点

  constructor({
    cv,
    video,
    canvas = null,
    showFeatures = false,
  }: {
    cv: any;
    video: HTMLVideoElement;
    canvas?: HTMLCanvasElement | null;
    showFeatures: boolean;
  }) {
    this.cv = cv;
    this.video = video;

    this.canvas = canvas || document.createElement("canvas");
    this.canvas.id = "featureCanvas";
    this.canvas.width = video.videoWidth;
    this.canvas.height = video.videoHeight;

    this.ctx = this.canvas.getContext("2d")!;

    if (showFeatures) {
      document.body.appendChild(this.canvas);
    }
    this.render();
  }

  public render() {
    this.ctx.drawImage(this.video, 0, 0);
    const features = this.detectAndTrackFeatures();
    this.drawFeatures(features);
  }

  private generateFeatureId(): string {
    return `feature_${this.nextFeatureId++}`;
  }

  /**
   * 画像から特徴点を検出し、前フレームの特徴点と照合
   */
  private detectAndTrackFeatures(): Feature[] {
    // 1) 入力サイズ取得
    const W = this.canvas.width;
    const H = this.canvas.height;

    // 2) マスクを作成（中央50%×50%だけ検出許可）
    const mask = new this.cv.Mat.zeros(H, W, this.cv.CV_8UC1);
    const roiX = Math.floor(W * 0.25);
    const roiY = Math.floor(H * 0.25);
    const roiW = Math.floor(W * 0.5);
    const roiH = Math.floor(H * 0.5);
    mask
      .roi(new this.cv.Rect(roiX, roiY, roiW, roiH))
      .setTo(new this.cv.Scalar(255));

    // 3) グレースケール画像を作成
    const src = this.cv.imread(this.canvas);
    const gray = new this.cv.Mat();
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

      // 5) オプティカルフローで追跡
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

      // 6) 追跡点が少なければ追加検出
      if (trackedFeatures.length < this.maxCorners * 0.5) {
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

      // 7) フレーム更新
      this.prevGray.delete();
      this.prevGray = gray.clone();
      this.prevFeatures = trackedFeatures;

      this.trackedFeatures = trackedFeatures;
      return trackedFeatures;
    } finally {
      // 必ず解放
      src.delete();
      gray.delete();
      mask.delete();
    }
  }

  public reset() {
    if (this.prevGray) {
      this.prevGray.delete();
      this.prevGray = null;
    }
    this.prevFeatures = [];
  }

  /**
   * 特徴点の描画
   */
  private drawFeatures(features: Feature[]): void {
    if (this.trackedFeatures) {
      this.findNearestStableFeature(this.trackedFeatures);
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
   * 画面中央に最も近い安定した特徴点を見つける
   */
  private findNearestStableFeature(features: Feature[]): Feature | null {
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;
    let nearestFeature: Feature | null = null;
    let minDistance = Infinity;

    // 現在の中心特徴点が有効な場合はそれを継続して使用
    if (this.centerFeature) {
      const currentFeature = features.find(
        (f) => f.id === this.centerFeature!.id && this.isFeatureValid(f)
      );
      if (currentFeature) {
        this.centerFeature = currentFeature;
        return currentFeature;
      }
    }

    // 新しい中心特徴点を探す
    features.forEach((feature) => {
      if (!this.isFeatureValid(feature)) return;

      const distance = Math.sqrt(
        Math.pow(feature.x - centerX, 2) + Math.pow(feature.y - centerY, 2)
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestFeature = feature;
      }
    });

    // 新しい特徴点が見つかった場合、それを中心特徴点として設定
    if (nearestFeature) {
      this.centerFeature = nearestFeature;
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
    return this.trackedFeatures;
  }
}

export interface Feature {
  x: number;
  y: number;
  trackingCount: number; // 追跡されているフレーム数
  id?: string;
}

export class FeatureDetector {
  private readonly maxCorners: number = 150;
  private readonly qualityLevel: number = 0.01;
  private readonly minDistance: number = 10;
  private readonly blockSize: number = 3;
  private readonly useHarrisDetector: boolean = false;
  private readonly k: number = 0.04;

  private prevGray: any = null; // 前フレームのグレースケール画像
  private prevFeatures: Feature[] = []; // 前フレームの特徴点

  constructor(private readonly cv: any) {}

  /**
   * 画像から特徴点を検出し、前フレームの特徴点と照合
   */
  public detectAndTrackFeatures(canvas: HTMLCanvasElement): Feature[] {
    // 画像をOpenCV.jsのMat形式に変換
    const src = this.cv.imread(canvas);
    const gray = new this.cv.Mat();
    const mask = new this.cv.Mat();

    try {
      // グレースケール変換
      this.cv.cvtColor(src, gray, this.cv.COLOR_RGBA2GRAY);

      // 前フレームがない場合は新規に特徴点を検出
      if (!this.prevGray) {
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

        // 特徴点を配列に変換
        const features: Feature[] = [];
        for (let i = 0; i < points.rows; i++) {
          features.push({
            x: points.data32F[i * 2],
            y: points.data32F[i * 2 + 1],
            trackingCount: 1,
          });
        }
        points.delete();
        this.prevFeatures = features;
        this.prevGray = gray.clone();
        return features;
      }

      // オプティカルフローで特徴点を追跡
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

      // 追跡結果を配列に変換
      const trackedFeatures: Feature[] = [];
      for (let i = 0; i < status.rows; i++) {
        if (status.data[i] === 1) {
          // 追跡成功
          trackedFeatures.push({
            x: nextPoints.data32F[i * 2],
            y: nextPoints.data32F[i * 2 + 1],
            trackingCount: this.prevFeatures[i].trackingCount + 1,
          });
        }
      }

      // 追跡点が少なくなったら新しい特徴点を追加
      if (trackedFeatures.length < this.maxCorners * 0.5) {
        const points = new this.cv.Mat();
        this.cv.goodFeaturesToTrack(
          gray,
          points,
          this.maxCorners - trackedFeatures.length,
          this.qualityLevel,
          this.minDistance,
          mask,
          this.blockSize,
          this.useHarrisDetector,
          this.k
        );

        for (let i = 0; i < points.rows; i++) {
          trackedFeatures.push({
            x: points.data32F[i * 2],
            y: points.data32F[i * 2 + 1],
            trackingCount: 1,
          });
        }
        points.delete();
      }

      // メモリ解放とフレーム更新
      prevPoints.delete();
      nextPoints.delete();
      status.delete();
      err.delete();
      this.prevGray.delete();
      this.prevGray = gray.clone();
      this.prevFeatures = trackedFeatures;

      return trackedFeatures;
    } finally {
      // メモリ解放
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
}

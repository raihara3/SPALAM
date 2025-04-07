export class FeatureDetector {
  private readonly maxCorners: number = 100;
  private readonly qualityLevel: number = 0.01;
  private readonly minDistance: number = 10;
  private readonly blockSize: number = 3;
  private readonly useHarrisDetector: boolean = false;
  private readonly k: number = 0.04;

  constructor(private readonly cv: any) {}

  /**
   * 画像から特徴点を検出
   * @param canvas 入力画像のcanvas要素
   * @returns 検出された特徴点の配列 [{x: number, y: number}]
   */
  public detectFeatures(canvas: HTMLCanvasElement): { x: number; y: number }[] {
    // 画像をOpenCV.jsのMat形式に変換
    const src = this.cv.imread(canvas);
    const gray = new this.cv.Mat();
    const mask = new this.cv.Mat();
    const points = new this.cv.Mat();

    try {
      // グレースケール変換
      this.cv.cvtColor(src, gray, this.cv.COLOR_RGBA2GRAY);

      // 特徴点検出
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

      // 検出した特徴点を配列に変換
      const features: { x: number; y: number }[] = [];
      for (let i = 0; i < points.rows; i++) {
        features.push({
          x: points.data32F[i * 2],
          y: points.data32F[i * 2 + 1]
        });
      }

      return features;
    } finally {
      // メモリ解放
      src.delete();
      gray.delete();
      points.delete();
      mask.delete();
    }
  }
}
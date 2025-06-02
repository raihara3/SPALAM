declare namespace cv {
  class Mat {
    constructor();
    delete(): void;
  }

  class KeyPoint {
    point: Point2f;
    size: number;
    angle: number;
    response: number;
    octave: number;
    class_id: number;
  }

  class Point2f {
    x: number;
    y: number;
  }

  function imread(image: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement): Mat;
  function imshow(canvasSource: string | HTMLCanvasElement, mat: Mat): void;
  function goodFeaturesToTrack(
    image: Mat,
    corners: Mat,
    maxCorners: number,
    qualityLevel: number,
    minDistance: number,
    mask?: Mat,
    blockSize?: number,
    useHarrisDetector?: boolean,
    k?: number
  ): void;
  function cvtColor(src: Mat, dst: Mat, code: number, dstCn?: number): void;
  const COLOR_RGBA2GRAY: number;
}

declare const cv: any;
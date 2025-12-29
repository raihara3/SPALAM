/**
 * OpenCV.js Type Definitions
 * Based on OpenCV.js 4.x API
 */
declare namespace cv {
  // Mat type constants
  const CV_8UC1: number;
  const CV_8UC3: number;
  const CV_8UC4: number;
  const CV_32FC1: number;
  const CV_32FC2: number;
  const CV_64FC1: number;

  // Color conversion codes
  const COLOR_RGBA2GRAY: number;
  const COLOR_RGB2GRAY: number;
  const COLOR_BGR2GRAY: number;
  const COLOR_GRAY2RGB: number;
  const COLOR_GRAY2RGBA: number;

  // ORB score types
  const ORB_HARRIS_SCORE: number;
  const ORB_FAST_SCORE: number;

  // FAST detector types
  const FastFeatureDetector_TYPE_5_8: number;
  const FastFeatureDetector_TYPE_7_12: number;
  const FastFeatureDetector_TYPE_9_16: number;

  // TermCriteria types
  const TERM_CRITERIA_EPS: number;
  const TERM_CRITERIA_MAX_ITER: number;
  const TERM_CRITERIA_COUNT: number;

  // Initialize callback
  let onRuntimeInitialized: (() => void) | undefined;

  /**
   * Matrix class - the core data structure
   */
  interface MatConstructor {
    new (): Mat;
    new (rows: number, cols: number, type: number): Mat;
    new (
      rows: number,
      cols: number,
      type: number,
      scalar: Scalar | number[]
    ): Mat;
    zeros(rows: number, cols: number, type: number): Mat;
    ones(rows: number, cols: number, type: number): Mat;
    eye(rows: number, cols: number, type: number): Mat;
  }

  interface Mat {
    rows: number;
    cols: number;
    data: Uint8Array;
    data8S: Int8Array;
    data16U: Uint16Array;
    data16S: Int16Array;
    data32S: Int32Array;
    data32F: Float32Array;
    data64F: Float64Array;

    clone(): Mat;
    copyTo(dst: Mat, mask?: Mat): void;
    convertTo(dst: Mat, rtype: number, alpha?: number, beta?: number): void;
    setTo(value: Scalar | number[], mask?: Mat): Mat;
    roi(rect: Rect): Mat;
    delete(): void;

    size(): Size;
    type(): number;
    channels(): number;
    empty(): boolean;

    at(row: number, col: number): number;
    floatAt(row: number, col: number): number;
    intAt(row: number, col: number): number;
    ucharAt(row: number, col: number): number;
  }

  class MatVector {
    constructor();
    push_back(mat: Mat): void;
    get(index: number): Mat;
    size(): number;
    delete(): void;
  }

  class Point {
    x: number;
    y: number;
    constructor(x: number, y: number);
  }

  class Point2f {
    x: number;
    y: number;
    constructor(x?: number, y?: number);
  }

  class Size {
    width: number;
    height: number;
    constructor(width: number, height: number);
  }

  class Rect {
    x: number;
    y: number;
    width: number;
    height: number;
    constructor(x: number, y: number, width: number, height: number);
  }

  class Scalar {
    constructor(v0?: number, v1?: number, v2?: number, v3?: number);
  }

  class TermCriteria {
    constructor(type: number, maxCount: number, epsilon: number);
  }

  /**
   * KeyPoint class for feature detection
   */
  class KeyPoint {
    pt: Point2f;
    size: number;
    angle: number;
    response: number;
    octave: number;
    class_id: number;
  }

  interface KeyPointVector {
    push_back(keypoint: KeyPoint): void;
    get(index: number): KeyPoint;
    size(): number;
    delete(): void;
  }

  // Image I/O
  function imread(
    image: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement
  ): Mat;
  function imshow(canvasSource: string | HTMLCanvasElement, mat: Mat): void;
  function matFromImageData(imageData: ImageData): Mat;
  function matFromArray(
    rows: number,
    cols: number,
    type: number,
    data: number[] | Float32Array | Uint8Array
  ): Mat;

  // Color conversion
  function cvtColor(src: Mat, dst: Mat, code: number, dstCn?: number): void;

  // Feature detection
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

  function cornerHarris(
    src: Mat,
    dst: Mat,
    blockSize: number,
    ksize: number,
    k: number,
    borderType?: number
  ): void;

  // Optical flow
  function calcOpticalFlowPyrLK(
    prevImg: Mat,
    nextImg: Mat,
    prevPts: Mat,
    nextPts: Mat,
    status: Mat,
    err: Mat,
    winSize?: Size,
    maxLevel?: number,
    criteria?: TermCriteria,
    flags?: number,
    minEigThreshold?: number
  ): void;

  // Thresholding
  function threshold(
    src: Mat,
    dst: Mat,
    thresh: number,
    maxval: number,
    type: number
  ): number;

  // Morphological operations
  function dilate(
    src: Mat,
    dst: Mat,
    kernel: Mat,
    anchor?: Point,
    iterations?: number
  ): void;

  // Geometry
  function normalize(
    src: Mat,
    dst: Mat,
    alpha: number,
    beta: number,
    normType: number,
    dtype?: number,
    mask?: Mat
  ): void;
  function minMaxLoc(
    src: Mat,
    mask?: Mat
  ): {
    minVal: number;
    maxVal: number;
    minLoc: Point;
    maxLoc: Point;
  };

  // Matrix operations
  function getStructuringElement(
    shape: number,
    ksize: Size,
    anchor?: Point
  ): Mat;

  /**
   * Feature detector classes
   */
  interface FeatureDetector {
    detect(image: Mat, keypoints: KeyPointVector, mask?: Mat): void;
    delete(): void;
  }

  interface Feature2D extends FeatureDetector {
    detectAndCompute(
      image: Mat,
      mask: Mat,
      keypoints: KeyPointVector,
      descriptors: Mat
    ): void;
  }

  // Constructors exposed as values
  const Mat: MatConstructor;
  const KeyPointVector: KeyPointVectorConstructor;

  interface KeyPointVectorConstructor {
    new (): KeyPointVector;
  }

  // Build information function
  function getBuildInformation(): string;

  function FastFeatureDetector_create(
    threshold?: number,
    nonmaxSuppression?: boolean,
    type?: number
  ): FeatureDetector;

  function ORB_create(
    nfeatures?: number,
    scaleFactor?: number,
    nlevels?: number,
    edgeThreshold?: number,
    firstLevel?: number,
    WTA_K?: number,
    scoreType?: number,
    patchSize?: number,
    fastThreshold?: number
  ): Feature2D;

  function SIFT_create(
    nfeatures?: number,
    nOctaveLayers?: number,
    contrastThreshold?: number,
    edgeThreshold?: number,
    sigma?: number
  ): Feature2D;
}

/**
 * Global cv object - typed as the cv namespace
 */
declare const cv: typeof cv & {
  onRuntimeInitialized?: () => void;
};

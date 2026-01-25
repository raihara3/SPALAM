/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

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

  // ============================================
  // Phase 4: Camera Pose Estimation Extensions
  // ============================================

  // Norm types for descriptor matching
  const NORM_INF: number;
  const NORM_L1: number;
  const NORM_L2: number;
  const NORM_L2SQR: number;
  const NORM_HAMMING: number;
  const NORM_HAMMING2: number;

  // RANSAC and robust estimation methods
  const RANSAC: number;
  const LMEDS: number;
  const RHO: number;

  // solvePnP method flags
  const SOLVEPNP_ITERATIVE: number;
  const SOLVEPNP_P3P: number;
  const SOLVEPNP_AP3P: number;
  const SOLVEPNP_EPNP: number;
  const SOLVEPNP_DLS: number;
  const SOLVEPNP_UPNP: number;
  const SOLVEPNP_IPPE: number;
  const SOLVEPNP_IPPE_SQUARE: number;
  const SOLVEPNP_SQPNP: number;

  // Decompose homography flags
  const DECOMP_LU: number;
  const DECOMP_SVD: number;
  const DECOMP_CHOLESKY: number;

  /**
   * DMatch class for descriptor matching results
   */
  class DMatch {
    queryIdx: number;
    trainIdx: number;
    imgIdx: number;
    distance: number;
    constructor();
  }

  /**
   * Vector of DMatch
   */
  class DMatchVector {
    constructor();
    push_back(match: DMatch): void;
    get(index: number): DMatch;
    size(): number;
    delete(): void;
  }

  /**
   * Vector of DMatchVector (for knnMatch)
   */
  class DMatchVectorVector {
    constructor();
    push_back(matches: DMatchVector): void;
    get(index: number): DMatchVector;
    size(): number;
    delete(): void;
  }

  interface DMatchVectorConstructor {
    new (): DMatchVector;
  }

  interface DMatchVectorVectorConstructor {
    new (): DMatchVectorVector;
  }

  const DMatchVector: DMatchVectorConstructor;
  const DMatchVectorVector: DMatchVectorVectorConstructor;

  /**
   * BFMatcher - Brute-Force descriptor matcher
   */
  interface BFMatcher {
    /**
     * Find the best match for each descriptor
     */
    match(
      queryDescriptors: Mat,
      trainDescriptors: Mat,
      matches: DMatchVector,
      mask?: Mat
    ): void;

    /**
     * Find the k best matches for each descriptor
     */
    knnMatch(
      queryDescriptors: Mat,
      trainDescriptors: Mat,
      matches: DMatchVectorVector,
      k: number,
      mask?: Mat,
      compactResult?: boolean
    ): void;

    /**
     * Release resources
     */
    delete(): void;
  }

  /**
   * Create a BFMatcher instance
   * @param normType Norm type (NORM_HAMMING for binary descriptors like ORB)
   * @param crossCheck If true, only returns matches (i,j) where descriptor i matches j and j matches i
   */
  function BFMatcher_create(normType?: number, crossCheck?: boolean): BFMatcher;

  /**
   * Find essential matrix from corresponding points
   * @param points1 Array of N points from first image (Nx2 or Nx1x2)
   * @param points2 Array of N points from second image (Nx2 or Nx1x2)
   * @param cameraMatrix Camera intrinsic matrix (3x3)
   * @param method RANSAC or LMEDS
   * @param prob Confidence probability (0-1)
   * @param threshold RANSAC threshold in pixels
   * @param mask Output inlier mask
   * @returns Essential matrix (3x3)
   */
  function findEssentialMat(
    points1: Mat,
    points2: Mat,
    cameraMatrix: Mat,
    method?: number,
    prob?: number,
    threshold?: number,
    maxIters?: number,
    mask?: Mat
  ): Mat;

  /**
   * Recover relative camera rotation and translation from essential matrix
   * @param essentialMatrix Essential matrix (3x3)
   * @param points1 Points from first image
   * @param points2 Points from second image
   * @param cameraMatrix Camera intrinsic matrix (3x3)
   * @param R Output rotation matrix (3x3)
   * @param t Output translation vector (3x1)
   * @param mask Input/output inlier mask
   * @returns Number of inliers that pass the cheirality check
   */
  function recoverPose(
    essentialMatrix: Mat,
    points1: Mat,
    points2: Mat,
    cameraMatrix: Mat,
    R: Mat,
    t: Mat,
    mask?: Mat
  ): number;

  /**
   * Find fundamental matrix from corresponding points
   * @param points1 Points from first image (Nx2)
   * @param points2 Points from second image (Nx2)
   * @param method FM_7POINT, FM_8POINT, RANSAC, or LMEDS
   * @param ransacReprojThreshold Maximum distance for inlier
   * @param confidence Confidence level
   * @param mask Output inlier mask
   * @returns Fundamental matrix (3x3)
   */
  function findFundamentalMat(
    points1: Mat,
    points2: Mat,
    method?: number,
    ransacReprojThreshold?: number,
    confidence?: number,
    mask?: Mat
  ): Mat;

  /**
   * Solve PnP problem (find object pose from 3D-2D point correspondences)
   * @param objectPoints Array of 3D object points (Nx3)
   * @param imagePoints Array of 2D image points (Nx2)
   * @param cameraMatrix Camera intrinsic matrix (3x3)
   * @param distCoeffs Distortion coefficients (can be empty Mat)
   * @param rvec Output rotation vector (3x1)
   * @param tvec Output translation vector (3x1)
   * @param useExtrinsicGuess Use rvec/tvec as initial guess
   * @param flags Method: SOLVEPNP_ITERATIVE, SOLVEPNP_P3P, etc.
   * @returns true if solution found
   */
  function solvePnP(
    objectPoints: Mat,
    imagePoints: Mat,
    cameraMatrix: Mat,
    distCoeffs: Mat,
    rvec: Mat,
    tvec: Mat,
    useExtrinsicGuess?: boolean,
    flags?: number
  ): boolean;

  /**
   * Solve PnP problem with RANSAC
   * @param objectPoints Array of 3D object points (Nx3)
   * @param imagePoints Array of 2D image points (Nx2)
   * @param cameraMatrix Camera intrinsic matrix (3x3)
   * @param distCoeffs Distortion coefficients
   * @param rvec Output rotation vector
   * @param tvec Output translation vector
   * @param useExtrinsicGuess Use rvec/tvec as initial guess
   * @param iterationsCount Number of RANSAC iterations
   * @param reprojectionError Maximum reprojection error for inliers
   * @param confidence Confidence level (0-1)
   * @param inliers Output inlier indices
   * @param flags solvePnP method
   * @returns true if solution found
   */
  function solvePnPRansac(
    objectPoints: Mat,
    imagePoints: Mat,
    cameraMatrix: Mat,
    distCoeffs: Mat,
    rvec: Mat,
    tvec: Mat,
    useExtrinsicGuess?: boolean,
    iterationsCount?: number,
    reprojectionError?: number,
    confidence?: number,
    inliers?: Mat,
    flags?: number
  ): boolean;

  /**
   * Refine pose using Levenberg-Marquardt optimization
   * @param objectPoints 3D object points
   * @param imagePoints 2D image points
   * @param cameraMatrix Camera intrinsic matrix
   * @param distCoeffs Distortion coefficients
   * @param rvec Input/output rotation vector
   * @param tvec Input/output translation vector
   * @param criteria Termination criteria
   */
  function solvePnPRefineLM(
    objectPoints: Mat,
    imagePoints: Mat,
    cameraMatrix: Mat,
    distCoeffs: Mat,
    rvec: Mat,
    tvec: Mat,
    criteria?: TermCriteria
  ): void;

  /**
   * Triangulate 3D points from two views
   * @param projMatr1 First projection matrix (3x4)
   * @param projMatr2 Second projection matrix (3x4)
   * @param projPoints1 Points in first image (2xN)
   * @param projPoints2 Points in second image (2xN)
   * @param points4D Output 4D homogeneous points (4xN)
   */
  function triangulatePoints(
    projMatr1: Mat,
    projMatr2: Mat,
    projPoints1: Mat,
    projPoints2: Mat,
    points4D: Mat
  ): void;

  /**
   * Convert rotation vector to rotation matrix or vice versa
   * @param src Input rotation vector (3x1) or rotation matrix (3x3)
   * @param dst Output rotation matrix (3x3) or rotation vector (3x1)
   * @param jacobian Optional output Jacobian matrix
   */
  function Rodrigues(src: Mat, dst: Mat, jacobian?: Mat): void;

  /**
   * Project 3D points to image plane
   * @param objectPoints 3D object points (Nx3)
   * @param rvec Rotation vector
   * @param tvec Translation vector
   * @param cameraMatrix Camera intrinsic matrix
   * @param distCoeffs Distortion coefficients
   * @param imagePoints Output 2D image points
   * @param jacobian Optional output Jacobian
   */
  function projectPoints(
    objectPoints: Mat,
    rvec: Mat,
    tvec: Mat,
    cameraMatrix: Mat,
    distCoeffs: Mat,
    imagePoints: Mat,
    jacobian?: Mat
  ): void;

  /**
   * Undistort 2D points
   * @param src Distorted points (Nx2)
   * @param dst Undistorted points
   * @param cameraMatrix Camera intrinsic matrix
   * @param distCoeffs Distortion coefficients
   * @param R Optional rectification transformation
   * @param P Optional new camera matrix
   */
  function undistortPoints(
    src: Mat,
    dst: Mat,
    cameraMatrix: Mat,
    distCoeffs: Mat,
    R?: Mat,
    P?: Mat
  ): void;

  /**
   * Decompose essential matrix into possible rotations and translation
   * @param E Essential matrix (3x3)
   * @param R1 First possible rotation matrix
   * @param R2 Second possible rotation matrix
   * @param t Translation vector (up to sign)
   */
  function decomposeEssentialMat(E: Mat, R1: Mat, R2: Mat, t: Mat): void;

  /**
   * Find homography matrix between two planes
   * @param srcPoints Source points (Nx2)
   * @param dstPoints Destination points (Nx2)
   * @param method 0, RANSAC, LMEDS, or RHO
   * @param ransacReprojThreshold Maximum reprojection error
   * @param mask Output inlier mask
   * @param maxIters Maximum RANSAC iterations
   * @param confidence Confidence level
   * @returns Homography matrix (3x3)
   */
  function findHomography(
    srcPoints: Mat,
    dstPoints: Mat,
    method?: number,
    ransacReprojThreshold?: number,
    mask?: Mat,
    maxIters?: number,
    confidence?: number
  ): Mat;

  /**
   * Compute the optimal new camera matrix
   * @param cameraMatrix Input camera matrix
   * @param distCoeffs Distortion coefficients
   * @param imageSize Image size
   * @param alpha Free scaling parameter (0-1)
   * @param newImageSize New image size
   * @param validPixROI Output ROI for valid pixels
   * @param centerPrincipalPoint Whether to center principal point
   * @returns New camera matrix
   */
  function getOptimalNewCameraMatrix(
    cameraMatrix: Mat,
    distCoeffs: Mat,
    imageSize: Size,
    alpha: number,
    newImageSize?: Size,
    validPixROI?: Rect,
    centerPrincipalPoint?: boolean
  ): Mat;

  /**
   * Compute the fundamental matrix from camera matrices
   * @param K1 First camera intrinsic matrix
   * @param R1 First camera rotation
   * @param T1 First camera translation
   * @param K2 Second camera intrinsic matrix
   * @param R2 Second camera rotation
   * @param T2 Second camera translation
   * @param F Output fundamental matrix
   */
  function computeCorrespondEpilines(
    points: Mat,
    whichImage: number,
    F: Mat,
    lines: Mat
  ): void;

  /**
   * Invert a matrix
   * @param src Input matrix
   * @param dst Output inverted matrix
   * @param flags Inversion method (DECOMP_LU, DECOMP_SVD, etc.)
   * @returns Non-zero if successful
   */
  function invert(src: Mat, dst: Mat, flags?: number): number;

  /**
   * Matrix multiplication: dst = src1 * src2
   */
  function gemm(
    src1: Mat,
    src2: Mat,
    alpha: number,
    src3: Mat,
    beta: number,
    dst: Mat,
    flags?: number
  ): void;

  /**
   * Transpose a matrix
   */
  function transpose(src: Mat, dst: Mat): void;

  /**
   * Compute determinant of a matrix
   */
  function determinant(src: Mat): number;

  /**
   * Solve linear system or least-squares problem
   * @param src1 Left-hand side matrix
   * @param src2 Right-hand side matrix
   * @param dst Solution
   * @param flags Decomposition method
   * @returns true if solution found
   */
  function solve(src1: Mat, src2: Mat, dst: Mat, flags?: number): boolean;

  /**
   * Compute SVD of a matrix
   * @param src Input matrix
   * @param w Singular values
   * @param u Left singular vectors
   * @param vt Transposed right singular vectors
   * @param flags Flags
   */
  function SVDecomp(src: Mat, w: Mat, u: Mat, vt: Mat, flags?: number): void;
}

/**
 * Global cv object - typed as the cv namespace
 */
declare const cv: typeof cv & {
  onRuntimeInitialized?: () => void;
};

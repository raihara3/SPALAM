/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Offline tracking regression harness
 *
 * Replays a frame sequence through the real OpenCV.js build and the built
 * tracking core (CameraTracker + PnPSolver + LandmarkMap), and reports
 * numeric pose stability — so tracking changes can be evaluated without
 * on-device rounds.
 *
 * Modes:
 *   --synthetic static|retreat|lateral   Rendered textured-plane sequence
 *                                        with a ground-truth trajectory
 *   --gray <file> --width <w> --height <h>
 *                                        Raw 8-bit grayscale frames
 *                                        (see README for ffmpeg extraction)
 *
 * Prerequisite: npm run build (imports from dist/).
 */

import { createRequire } from "node:module";
import { existsSync, appendFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const harnessDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(harnessDirectory, "..", "..");

// Synchronous file trace: pipe buffering can hide stdout/stderr entirely,
// so progress is also appended to trace.log where it is always visible
const TRACE_FILE = join(harnessDirectory, "trace.log");
const trace = (message) => {
  const line = `${new Date().toISOString()} ${message}`;
  appendFileSync(TRACE_FILE, line + "\n");
  process.stderr.write(line + "\n");
};

const OPENCV_URL =
  "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js";
// .cjs suffix: the repository package.json declares "type": "module", and
// opencv.js must be loaded as CommonJS
const OPENCV_CACHE = join(harnessDirectory, "opencv.cjs");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const parseArguments = (argv) => {
  const options = {
    synthetic: null,
    gray: null,
    width: 640,
    height: 360,
    fps: 30,
    frames: 150,
    static: false,
    replenish: false,
    bundleAdjustment: false,
    json: null,
    maxDrift: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const argument = argv[i];
    switch (argument) {
      case "--synthetic": options.synthetic = argv[++i]; break;
      case "--gray": options.gray = argv[++i]; break;
      case "--width": options.width = Number(argv[++i]); break;
      case "--height": options.height = Number(argv[++i]); break;
      case "--fps": options.fps = Number(argv[++i]); break;
      case "--frames": options.frames = Number(argv[++i]); break;
      case "--static": options.static = true; break;
      case "--replenish": options.replenish = true; break;
      case "--ba": options.bundleAdjustment = true; break;
      case "--json": options.json = argv[++i]; break;
      case "--max-drift": options.maxDrift = Number(argv[++i]); break;
      default:
        console.error(`Unknown argument: ${argument}`);
        process.exit(2);
    }
  }
  if (!options.synthetic && !options.gray) {
    console.error(
      "Usage:\n" +
        "  node tools/tracking-harness/run.mjs --synthetic static|retreat|lateral [--frames N] [--replenish] [--ba]\n" +
        "  node tools/tracking-harness/run.mjs --gray frames.gray --width 640 --height 360 [--static]\n" +
        "Options: --json out.json --max-drift 0.05"
    );
    process.exit(2);
  }
  return options;
};

// ---------------------------------------------------------------------------
// OpenCV.js loading (cached download, same pinned build as index.html)
// ---------------------------------------------------------------------------

const loadOpenCv = async () => {
  if (!existsSync(OPENCV_CACHE)) {
    console.log(`Downloading OpenCV.js (~10MB) to ${OPENCV_CACHE} ...`);
    const response = await fetch(OPENCV_URL);
    if (!response.ok) {
      throw new Error(`OpenCV.js download failed: HTTP ${response.status}`);
    }
    await writeFile(OPENCV_CACHE, Buffer.from(await response.arrayBuffer()));
  }
  trace("requiring opencv.cjs");
  const require = createRequire(import.meta.url);
  const cv = require(OPENCV_CACHE);
  trace("opencv required, waiting for runtime init");
  await new Promise((resolve, reject) => {
    // The runtime may already be initialized by the time the callback is
    // assigned; waiting unconditionally would hang forever
    if (cv.Mat) {
      resolve();
      return;
    }
    cv.onRuntimeInitialized = resolve;
    setTimeout(() => reject(new Error("OpenCV.js initialization timeout")), 60000);
  });
  trace("OpenCV.js ready");
  globalThis.cv = cv;
  return cv;
};

// ---------------------------------------------------------------------------
// Synthetic sequence: textured plane at z=2 (OpenCV basis), known trajectory
// ---------------------------------------------------------------------------

/** Band-limited analytic texture with 2D structure (corners for LK) */
const texture = (x, y) => {
  const value =
    128 +
    40 * Math.sin(23 * x + 7 * y) +
    30 * Math.sin(-11 * x + 31 * y + 1) +
    25 * Math.sin(53 * x - 17 * y + 2) +
    20 * Math.sin(37 * x + 41 * y + 3);
  return Math.max(0, Math.min(255, value));
};

const TRAJECTORIES = {
  // Perfectly still camera: any reported motion is drift
  static: (t) => ({ x: 0, y: 0, z: 0 }),
  // Walk backward 0.5 world units away from the plane
  retreat: (t) => ({ x: 0, y: 0, z: -0.5 * t }),
  // Slide 0.3 world units to the right
  lateral: (t) => ({ x: 0.3 * t, y: 0, z: 0 }),
};

const renderSyntheticFrame = (center, width, height, intrinsics, out) => {
  const { fx, fy, cx, cy } = intrinsics;
  const planeZ = 2;
  for (let v = 0; v < height; v++) {
    const dy = (v - cy) / fy;
    for (let u = 0; u < width; u++) {
      const dx = (u - cx) / fx;
      // Ray from camera center (identity rotation) to the plane z = planeZ
      const s = planeZ - center.z;
      const worldX = center.x + s * dx;
      const worldY = center.y + s * dy;
      out[v * width + u] = texture(worldX, worldY);
    }
  }
};

// ---------------------------------------------------------------------------
// Headless feature front-end (mirrors FeatureDetector's cv pipeline:
// Sobel gradient magnitude + goodFeaturesToTrack + pyramidal LK with a
// forward-backward check + continuous replenishment)
// ---------------------------------------------------------------------------

class HeadlessFeatureTracker {
  constructor(cv, width, height) {
    this.cv = cv;
    this.width = width;
    this.height = height;
    this.previousGradient = null;
    this.previousFeatures = [];
    this.nextFeatureId = 0;
    this.framesSinceReplenish = 0;
    this.maxCorners = 200;
    this.forwardBackwardThreshold = 1.0;
  }

  toGradient(grayMat) {
    const cv = this.cv;
    const gradient = new cv.Mat();
    const gradX = new cv.Mat();
    const gradY = new cv.Mat();
    cv.Sobel(grayMat, gradX, cv.CV_16S, 1, 0);
    cv.Sobel(grayMat, gradY, cv.CV_16S, 0, 1);
    cv.convertScaleAbs(gradX, gradX);
    cv.convertScaleAbs(gradY, gradY);
    cv.addWeighted(gradX, 0.5, gradY, 0.5, 0, gradient);
    gradX.delete();
    gradY.delete();
    return gradient;
  }

  detect(gradient, excluded, maxCount) {
    const cv = this.cv;
    const mask = cv.Mat.zeros(this.height, this.width, cv.CV_8UC1);
    const marginX = Math.floor(this.width * 0.05);
    const marginY = Math.floor(this.height * 0.05);
    const roi = mask.roi(
      new cv.Rect(marginX, marginY, this.width - 2 * marginX, this.height - 2 * marginY)
    );
    roi.setTo(new cv.Scalar(255));
    roi.delete();
    for (const feature of excluded) {
      cv.circle(
        mask,
        new cv.Point(Math.round(feature.x), Math.round(feature.y)),
        10,
        new cv.Scalar(0),
        -1
      );
    }
    const points = new cv.Mat();
    cv.goodFeaturesToTrack(gradient, points, maxCount, 0.001, 5, mask, 3, false, 0.04);
    const features = [];
    for (let i = 0; i < points.rows; i++) {
      features.push({
        x: points.data32F[i * 2],
        y: points.data32F[i * 2 + 1],
        trackingCount: 1,
        id: `feature_${this.nextFeatureId++}`,
      });
    }
    points.delete();
    mask.delete();
    return features;
  }

  process(grayMat) {
    const cv = this.cv;
    const gradient = this.toGradient(grayMat);

    if (!this.previousGradient || this.previousFeatures.length === 0) {
      this.previousFeatures = this.detect(gradient, [], this.maxCorners);
      this.previousGradient?.delete();
      this.previousGradient = gradient;
      return this.exportFeatures();
    }

    const count = this.previousFeatures.length;
    const previousPoints = new cv.Mat(count, 1, cv.CV_32FC2);
    for (let i = 0; i < count; i++) {
      previousPoints.data32F[i * 2] = this.previousFeatures[i].x;
      previousPoints.data32F[i * 2 + 1] = this.previousFeatures[i].y;
    }
    const nextPoints = new cv.Mat();
    const status = new cv.Mat();
    const error = new cv.Mat();
    cv.calcOpticalFlowPyrLK(this.previousGradient, gradient, previousPoints, nextPoints, status, error);

    const backPoints = new cv.Mat();
    const backStatus = new cv.Mat();
    const backError = new cv.Mat();
    cv.calcOpticalFlowPyrLK(gradient, this.previousGradient, nextPoints, backPoints, backStatus, backError);

    const tracked = [];
    for (let i = 0; i < count; i++) {
      if (status.data[i] !== 1 || backStatus.data[i] !== 1) continue;
      const roundTrip = Math.hypot(
        backPoints.data32F[i * 2] - this.previousFeatures[i].x,
        backPoints.data32F[i * 2 + 1] - this.previousFeatures[i].y
      );
      if (roundTrip > this.forwardBackwardThreshold) continue;
      tracked.push({
        x: nextPoints.data32F[i * 2],
        y: nextPoints.data32F[i * 2 + 1],
        trackingCount: this.previousFeatures[i].trackingCount + 1,
        id: this.previousFeatures[i].id,
      });
    }
    [previousPoints, nextPoints, status, error, backPoints, backStatus, backError].forEach((m) => m.delete());

    this.framesSinceReplenish++;
    if (this.framesSinceReplenish >= 5 && tracked.length < this.maxCorners * 0.7) {
      this.framesSinceReplenish = 0;
      tracked.push(...this.detect(gradient, tracked, this.maxCorners - tracked.length));
    }

    this.previousFeatures = tracked;
    this.previousGradient.delete();
    this.previousGradient = gradient;
    return this.exportFeatures();
  }

  exportFeatures() {
    // Same stability filter as FeatureDetector.getTrackedFeaturePoints()
    return this.previousFeatures
      .filter((feature) => feature.trackingCount >= 5)
      .map((feature) => ({ ...feature }));
  }

  dispose() {
    this.previousGradient?.delete();
  }
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

const summarizeStatic = (positions) => {
  if (positions.length === 0) return null;
  const mean = { x: 0, y: 0, z: 0 };
  for (const p of positions) { mean.x += p.x; mean.y += p.y; mean.z += p.z; }
  mean.x /= positions.length; mean.y /= positions.length; mean.z /= positions.length;
  let maxDeviation = 0;
  let sumSquared = 0;
  for (const p of positions) {
    const d = Math.hypot(p.x - mean.x, p.y - mean.y, p.z - mean.z);
    maxDeviation = Math.max(maxDeviation, d);
    sumSquared += d * d;
  }
  const first = positions[0];
  const last = positions[positions.length - 1];
  return {
    totalDrift: Math.hypot(last.x - first.x, last.y - first.y, last.z - first.z),
    maxDeviation,
    rmsDeviation: Math.sqrt(sumSquared / positions.length),
  };
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  const options = parseArguments(process.argv);

  const distEntry = join(repositoryRoot, "dist", "index.js");
  if (!existsSync(distEntry)) {
    console.error("dist/index.js not found — run `npm run build` first.");
    process.exit(2);
  }

  const cv = await loadOpenCv();
  trace("importing dist");
  const library = await import(distEntry);
  trace("dist imported");
  const {
    CameraTracker,
    LandmarkMap,
    PnPSolver,
    TwoViewTriangulator,
    LocalBundleAdjustment,
  } = library;

  const { width, height } = options;
  // Same assumed-FOV intrinsics as production (horizontalFov: 70)
  const fx = width / 2 / Math.tan((70 / 2) * (Math.PI / 180));
  const intrinsics = { fx, fy: fx, cx: width / 2, cy: height / 2, width, height };

  const landmarkMap = new LandmarkMap();
  const tracker = new CameraTracker(
    {
      intrinsics,
      landmarkMap,
      pnpSolver: new PnPSolver(cv, intrinsics),
      triangulator: options.replenish ? new TwoViewTriangulator(intrinsics) : undefined,
      bundleAdjustment: options.bundleAdjustment
        ? new LocalBundleAdjustment(intrinsics, { windowSize: 5, maxIterations: 3 })
        : undefined,
    },
    { minReferenceFeatures: 50, minTrackedCorrespondences: 15 }
  );

  // Frame source
  let frameCount;
  let getFrame; // (index, out: Uint8Array) => groundTruthCenter | null
  const frameBytes = new Uint8Array(width * height);
  if (options.synthetic) {
    const trajectory = TRAJECTORIES[options.synthetic];
    if (!trajectory) {
      console.error(`Unknown trajectory: ${options.synthetic} (static|retreat|lateral)`);
      process.exit(2);
    }
    frameCount = options.frames;
    getFrame = (index) => {
      const center = trajectory(index / Math.max(1, frameCount - 1));
      renderSyntheticFrame(center, width, height, intrinsics, frameBytes);
      return center;
    };
  } else {
    const buffer = await readFile(options.gray);
    frameCount = Math.floor(buffer.length / (width * height));
    if (frameCount === 0) {
      console.error("No frames in input (check --width/--height).");
      process.exit(2);
    }
    getFrame = (index) => {
      buffer.copy(frameBytes, 0, index * width * height, (index + 1) * width * height);
      return null;
    };
  }

  console.log(
    `frames: ${frameCount} @ ${width}x${height} | replenish: ${options.replenish} | BA: ${options.bundleAdjustment}` +
      (options.synthetic ? ` | synthetic: ${options.synthetic}` : "")
  );

  const frontend = new HeadlessFeatureTracker(cv, width, height);
  const records = [];
  let bootstrapTruthCenter = null;

  for (let index = 0; index < frameCount; index++) {
    const frameStart = Date.now();
    const truthCenter = getFrame(index);
    const renderedAt = Date.now();
    const grayMat = cv.matFromArray(height, width, cv.CV_8UC1, frameBytes);
    const features = frontend.process(grayMat);
    grayMat.delete();
    const trackedAt = Date.now();

    const wasInitialized = tracker.isInitialized();
    const result = tracker.update(
      features,
      (index * 1000) / options.fps,
      () => new Map(features.map((feature) => [feature.id, 2.0]))
    );
    trace(
      `frame ${index}: render ${renderedAt - frameStart}ms | frontend ${trackedAt - renderedAt}ms | tracker ${Date.now() - trackedAt}ms | features ${features.length} | ${result.status}`
    );
    if (!wasInitialized && tracker.isInitialized()) {
      bootstrapTruthCenter = truthCenter;
    }

    const record = {
      frame: index,
      status: result.status,
      features: features.length,
      correspondences: result.correspondenceCount,
      inliers: result.inlierCount,
      landmarks: landmarkMap.size(),
      position: result.pose
        ? { x: result.pose.translation.x, y: result.pose.translation.y, z: result.pose.translation.z }
        : null,
    };
    if (truthCenter && bootstrapTruthCenter && result.pose) {
      // The tracker world origin is the camera at the bootstrap frame
      record.truth = {
        x: truthCenter.x - bootstrapTruthCenter.x,
        y: truthCenter.y - bootstrapTruthCenter.y,
        z: truthCenter.z - bootstrapTruthCenter.z,
      };
      record.error = Math.hypot(
        record.position.x - record.truth.x,
        record.position.y - record.truth.y,
        record.position.z - record.truth.z
      );
    }
    records.push(record);
  }
  frontend.dispose();

  // ---- Summary ----
  const statusCounts = {};
  for (const record of records) {
    statusCounts[record.status] = (statusCounts[record.status] ?? 0) + 1;
  }
  console.log("status:", JSON.stringify(statusCounts));

  const trackedRecords = records.filter((record) => record.position);
  console.log(`tracked frames: ${trackedRecords.length}/${frameCount}`);

  let failed = false;
  if (options.synthetic) {
    const errors = records.filter((record) => record.error !== undefined).map((record) => record.error);
    if (errors.length > 0) {
      const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
      const maxError = Math.max(...errors);
      const finalError = errors[errors.length - 1];
      console.log(
        `pose error vs ground truth (world units): mean ${meanError.toFixed(4)} | max ${maxError.toFixed(4)} | final ${finalError.toFixed(4)}`
      );
      if (options.maxDrift !== null && finalError > options.maxDrift) failed = true;
    } else {
      console.log("no tracked frames with ground truth — initialization never succeeded");
      failed = true;
    }
  }
  if (options.static || options.synthetic === "static") {
    const stability = summarizeStatic(trackedRecords.map((record) => record.position));
    if (stability) {
      console.log(
        `static stability (world units): totalDrift ${stability.totalDrift.toFixed(4)} | maxDeviation ${stability.maxDeviation.toFixed(4)} | rms ${stability.rmsDeviation.toFixed(4)}`
      );
      if (options.maxDrift !== null && stability.totalDrift > options.maxDrift) failed = true;
    }
  }

  if (options.json) {
    await writeFile(options.json, JSON.stringify({ options, records }, null, 1));
    console.log(`trajectory written to ${options.json}`);
  }

  process.exit(failed ? 1 : 0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

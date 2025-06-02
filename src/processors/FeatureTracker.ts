import { EventEmitter } from "../utils/EventEmitter";
import { Feature, FeatureTrackingState } from "../types/core";
import { FeatureDetectionConfig } from "../types/configuration";

export class FeatureTracker extends EventEmitter {
  private config: FeatureDetectionConfig;
  private cv: any;
  private state: FeatureTrackingState;

  constructor(config: FeatureDetectionConfig, cv: any) {
    super();
    this.config = config;
    this.cv = cv;
    this.state = {
      prevGray: null,
      prevFeatures: [],
      trackedFeatures: [],
      centerFeature: null,
      nextFeatureId: 0,
    };
  }

  async trackFeatures(canvas: HTMLCanvasElement): Promise<Feature[]> {
    try {
      const features = this.detectAndTrackFeatures(canvas);
      this.emit("featuresDetected", features);
      
      // Draw features on a separate canvas overlay
      this.drawFeaturesOverlay(features);
      
      return features;
    } catch (error) {
      console.error("Feature tracking error:", error);
      this.emit("error", error);
      return [];
    }
  }

  private detectAndTrackFeatures(canvas: HTMLCanvasElement): Feature[] {
    const W = canvas.width;
    const H = canvas.height;

    // Create mask for center ROI
    const mask = new this.cv.Mat.zeros(H, W, this.cv.CV_8UC1);
    if (this.config.roiEnabled) {
      const roiX = Math.floor(W * (1 - this.config.roiSize.width) / 2);
      const roiY = Math.floor(H * (1 - this.config.roiSize.height) / 2);
      const roiW = Math.floor(W * this.config.roiSize.width);
      const roiH = Math.floor(H * this.config.roiSize.height);
      mask
        .roi(new this.cv.Rect(roiX, roiY, roiW, roiH))
        .setTo(new this.cv.Scalar(255));
    } else {
      mask.setTo(new this.cv.Scalar(255));
    }

    // Convert to grayscale
    const src = this.cv.imread(canvas);
    const gray = new this.cv.Mat();
    this.cv.cvtColor(src, gray, this.cv.COLOR_RGBA2GRAY);

    try {
      // Initial detection or tracking insufficient features
      if (!this.state.prevGray) {
        return this.initialFeatureDetection(gray, mask);
      }

      // Track existing features with optical flow
      const trackedFeatures = this.trackWithOpticalFlow(gray);

      // Add new features if needed
      if (trackedFeatures.length < this.config.maxCorners * 0.5) {
        const newFeatures = this.detectAdditionalFeatures(
          gray, 
          mask, 
          this.config.maxCorners - trackedFeatures.length
        );
        trackedFeatures.push(...newFeatures);
      }

      // Update state
      this.updateState(gray, trackedFeatures);
      return trackedFeatures;
    } finally {
      src.delete();
      gray.delete();
      mask.delete();
    }
  }

  private initialFeatureDetection(gray: any, mask: any): Feature[] {
    const points = new this.cv.Mat();
    this.cv.goodFeaturesToTrack(
      gray,
      points,
      this.config.maxCorners,
      this.config.qualityLevel,
      this.config.minDistance,
      mask,
      this.config.blockSize,
      this.config.useHarrisDetector,
      this.config.k
    );

    const features: Feature[] = [];
    for (let i = 0; i < points.rows; i++) {
      features.push({
        x: points.data32F[i * 2],
        y: points.data32F[i * 2 + 1],
        u: points.data32F[i * 2],
        v: points.data32F[i * 2 + 1],
        trackingCount: 1,
        id: this.generateFeatureId(),
      });
    }

    points.delete();
    this.state.prevFeatures = features;
    this.state.prevGray = gray.clone();
    this.state.trackedFeatures = features;
    
    return features;
  }

  private trackWithOpticalFlow(gray: any): Feature[] {
    const prevPoints = new this.cv.Mat(
      this.state.prevFeatures.length,
      1,
      this.cv.CV_32FC2
    );
    
    for (let i = 0; i < this.state.prevFeatures.length; i++) {
      prevPoints.data32F[i * 2] = this.state.prevFeatures[i].x;
      prevPoints.data32F[i * 2 + 1] = this.state.prevFeatures[i].y;
    }

    const nextPoints = new this.cv.Mat();
    const status = new this.cv.Mat();
    const err = new this.cv.Mat();

    this.cv.calcOpticalFlowPyrLK(
      this.state.prevGray,
      gray,
      prevPoints,
      nextPoints,
      status,
      err
    );

    const trackedFeatures: Feature[] = [];
    for (let i = 0; i < status.rows; i++) {
      if (status.data[i] === 1) {
        const x = nextPoints.data32F[i * 2];
        const y = nextPoints.data32F[i * 2 + 1];
        
        // Check if feature is still within valid bounds
        if (this.isFeatureInBounds(x, y, gray.cols, gray.rows)) {
          trackedFeatures.push({
            x,
            y,
            u: x,
            v: y,
            trackingCount: this.state.prevFeatures[i].trackingCount + 1,
            id: this.state.prevFeatures[i].id,
          });
        }
      }
    }

    prevPoints.delete();
    nextPoints.delete();
    status.delete();
    err.delete();

    return trackedFeatures;
  }

  private detectAdditionalFeatures(gray: any, mask: any, maxNew: number): Feature[] {
    const points = new this.cv.Mat();
    this.cv.goodFeaturesToTrack(
      gray,
      points,
      maxNew,
      this.config.qualityLevel,
      this.config.minDistance,
      mask,
      this.config.blockSize,
      this.config.useHarrisDetector,
      this.config.k
    );

    const newFeatures: Feature[] = [];
    for (let i = 0; i < points.rows; i++) {
      newFeatures.push({
        x: points.data32F[i * 2],
        y: points.data32F[i * 2 + 1],
        u: points.data32F[i * 2],
        v: points.data32F[i * 2 + 1],
        trackingCount: 1,
        id: this.generateFeatureId(),
      });
    }

    points.delete();
    return newFeatures;
  }

  private updateState(gray: any, trackedFeatures: Feature[]): void {
    if (this.state.prevGray) {
      this.state.prevGray.delete();
    }
    this.state.prevGray = gray.clone();
    this.state.prevFeatures = trackedFeatures;
    this.state.trackedFeatures = trackedFeatures;
    
    // Update center feature
    this.updateCenterFeature(trackedFeatures);
  }

  private updateCenterFeature(features: Feature[]): void {
    const validFeatures = features.filter(f => this.isFeatureValid(f));
    
    if (this.state.centerFeature) {
      // Try to keep existing center feature if still valid
      const currentCenter = validFeatures.find(f => f.id === this.state.centerFeature!.id);
      if (currentCenter) {
        this.state.centerFeature = currentCenter;
        return;
      }
    }

    // Find new center feature closest to image center
    this.state.centerFeature = this.findNearestStableFeature(validFeatures);
  }

  private findNearestStableFeature(features: Feature[]): Feature | null {
    // This would be set from camera resolution, defaulting to common values
    const centerX = 320; // canvas.width / 2
    const centerY = 240; // canvas.height / 2
    
    let nearestFeature: Feature | null = null;
    let minDistance = Infinity;

    for (const feature of features) {
      if (!this.isFeatureValid(feature)) continue;

      const distance = Math.sqrt(
        Math.pow(feature.x - centerX, 2) + Math.pow(feature.y - centerY, 2)
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestFeature = feature;
      }
    }

    return nearestFeature;
  }

  private isFeatureValid(feature: Feature): boolean {
    // Default canvas size, should be updated with actual canvas dimensions
    const width = 640;
    const height = 480;
    
    return (
      feature.x >= 0 &&
      feature.x <= width &&
      feature.y >= 0 &&
      feature.y <= height &&
      feature.trackingCount >= this.config.trackingFrames
    );
  }

  private isFeatureInBounds(x: number, y: number, width: number, height: number): boolean {
    return x >= 0 && x < width && y >= 0 && y < height;
  }

  private generateFeatureId(): string {
    return `feature_${this.state.nextFeatureId++}`;
  }

  getCenterFeature(): Feature | null {
    return this.state.centerFeature;
  }

  getTrackedFeaturePoints(): Feature[] {
    return this.state.trackedFeatures.filter(f => f.trackingCount >= this.config.trackingFrames);
  }

  private drawFeaturesOverlay(features: Feature[]): void {
    // Create or get feature overlay canvas
    let overlay = document.getElementById("featureOverlay") as HTMLCanvasElement;
    if (!overlay) {
      overlay = document.createElement("canvas");
      overlay.id = "featureOverlay";
      overlay.style.position = "fixed";
      overlay.style.top = "0";
      overlay.style.left = "0";
      overlay.style.width = "100%";
      overlay.style.height = "100%";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "10";
      document.body.appendChild(overlay);
    }

    // Set canvas size to match video
    const video = document.querySelector("video");
    if (video) {
      overlay.width = video.videoWidth || 640;
      overlay.height = video.videoHeight || 480;
    }

    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    // Clear previous features
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    // Draw features
    features.forEach((feature) => {
      const isCenter = this.state.centerFeature && feature.id === this.state.centerFeature.id;
      
      ctx.beginPath();
      ctx.arc(feature.x, feature.y, isCenter ? 5 : 3, 0, 2 * Math.PI);
      ctx.fillStyle = isCenter ? "#FFFF00" : "#FF0000";
      ctx.fill();
    });
  }

  reset(): void {
    if (this.state.prevGray) {
      this.state.prevGray.delete();
    }
    
    // Clean up overlay
    const overlay = document.getElementById("featureOverlay");
    if (overlay) {
      overlay.remove();
    }
    
    this.state = {
      prevGray: null,
      prevFeatures: [],
      trackedFeatures: [],
      centerFeature: null,
      nextFeatureId: 0,
    };
    this.emit("reset");
  }
}
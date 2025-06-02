import * as THREE from "three";
import { EventEmitter } from "../utils/EventEmitter";
import { FeatureTracker } from "../processors/FeatureTracker";
import { DepthProcessor } from "../processors/DepthProcessor";
import { GeometryProcessor } from "../processors/GeometryProcessor";
import { PlaneEstimationResult, EstimationState } from "../types/core";
import { SPALAMConfig } from "../types/configuration";

export class PlaneEstimator extends EventEmitter {
  private featureTracker: FeatureTracker;
  private depthProcessor: DepthProcessor;
  private geometryProcessor: GeometryProcessor;
  private config: SPALAMConfig;
  private state: EstimationState;

  constructor(config: SPALAMConfig, cv: any) {
    super();
    this.config = config;
    
    this.featureTracker = new FeatureTracker(config.featureDetection, cv || (window as any).cv);
    this.depthProcessor = new DepthProcessor(config.depthEstimation);
    this.geometryProcessor = new GeometryProcessor(config.planeEstimation);
    
    this.state = {
      fittingCount: 0,
      fittingResults: [],
      maxFittingCount: config.planeEstimation.maxFittingCount,
    };

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.featureTracker.on("error", (error: any) => this.emit("error", error));
    this.depthProcessor.on("error", (error: any) => this.emit("error", error));
    this.geometryProcessor.on("error", (error: any) => this.emit("error", error));

    this.featureTracker.on("featuresDetected", (features: any) => {
      this.emit("featuresDetected", features);
    });

    this.depthProcessor.on("depthProcessed", (depthMap: any) => {
      this.emit("depthProcessed", depthMap);
    });

    this.geometryProcessor.on("planeEstimated", (result: any) => {
      this.emit("planeEstimated", result);
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.depthProcessor.initialize();
      this.emit("initialized");
    } catch (error) {
      this.emit("error", error);
      throw error;
    }
  }

  private frameCount = 0;
  private readonly DEPTH_PROCESS_INTERVAL = 3; // Process depth every 3 frames

  async estimateFrame(canvas: HTMLCanvasElement): Promise<PlaneEstimationResult | null> {
    try {
      this.frameCount++;
      
      // 1. Track features (every frame for smooth tracking)
      const features = await this.featureTracker.trackFeatures(canvas);
      if (features.length === 0) {
        return null;
      }

      // 2. Get center feature for plane origin
      const centerFeature = this.featureTracker.getCenterFeature();
      
      // For plane estimation, check if we have enough stable features
      const validFeatures = this.featureTracker.getTrackedFeaturePoints();
      if (validFeatures.length < 5 || !centerFeature) {
        return null; // Return null but features are still drawn
      }

      // 3. Process depth (only every few frames to improve performance)
      let depthMap: Float32Array | null = null;
      if (this.frameCount % this.DEPTH_PROCESS_INTERVAL === 0) {
        depthMap = await this.depthProcessor.processDepth(canvas);
      } else {
        depthMap = this.depthProcessor.getLastDepthMap();
      }
      
      if (!depthMap) {
        return null;
      }

      // 4. Sample depth at feature points
      const points3D = this.depthProcessor.sampleDepthAtPoints(
        validFeatures,
        depthMap,
        { width: canvas.width, height: canvas.height }
      );

      if (points3D.length === 0) {
        return null;
      }

      // 5. Estimate plane geometry
      const result = this.geometryProcessor.estimatePlane(
        points3D,
        centerFeature,
        validFeatures,
        depthMap,
        { width: canvas.width, height: canvas.height }
      );

      if (!result) {
        return null;
      }

      // 6. For now, return result immediately without stabilization for faster display
      console.log("Plane estimation successful, confidence:", result.confidence);
      this.emit("frameProcessed", result);
      return result;
    } catch (error) {
      this.emit("error", error);
      return null;
    }
  }

  private stabilizeResult(result: PlaneEstimationResult): PlaneEstimationResult | null {
    // Store current result
    if (this.state.fittingCount < this.state.maxFittingCount) {
      this.state.fittingResults.push({
        hull2D: result.hull2D,
        hull3D: result.hull3D,
        P0: result.P0,
        uVec: result.uVec,
        vVec: result.vVec,
        normal: result.normal,
      });
      this.state.fittingCount++;
      
      this.emit("fittingProgress", {
        current: this.state.fittingCount,
        total: this.state.maxFittingCount,
      });

      return null; // Don't return result until we have enough samples
    }

    // Calculate averaged result from stored samples
    return this.calculateAverageResults();
  }

  private calculateAverageResults(): PlaneEstimationResult | null {
    if (this.state.fittingResults.length !== this.state.maxFittingCount) {
      return null;
    }

    const results = this.state.fittingResults;

    // Average P0
    const avgP0 = {
      x: results.reduce((sum, r) => sum + r.P0.x, 0) / results.length,
      y: results.reduce((sum, r) => sum + r.P0.y, 0) / results.length,
      z: results.reduce((sum, r) => sum + r.P0.z, 0) / results.length,
    };

    // Average vectors (normalize after averaging)
    const avgUVec = results.reduce((sum, r) => sum.add(r.uVec), new THREE.Vector3()).divideScalar(results.length).normalize();
    const avgVVec = results.reduce((sum, r) => sum.add(r.vVec), new THREE.Vector3()).divideScalar(results.length).normalize();
    const avgNormal = results.reduce((sum, r) => sum.add(r.normal), new THREE.Vector3()).divideScalar(results.length).normalize();

    // Average hull2D (assuming consistent structure)
    const baseHull2D = results[0].hull2D;
    const avgHull2D = baseHull2D.map((_, i) => ({
      u: results.reduce((sum, r) => sum + (r.hull2D[i]?.u || 0), 0) / results.length,
      v: results.reduce((sum, r) => sum + (r.hull2D[i]?.v || 0), 0) / results.length,
    }));

    // Average hull3D
    const baseHull3D = results[0].hull3D;
    const avgHull3D = baseHull3D.map((_, i) => ({
      x: results.reduce((sum, r) => sum + (r.hull3D[i]?.x || 0), 0) / results.length,
      y: results.reduce((sum, r) => sum + (r.hull3D[i]?.y || 0), 0) / results.length,
      z: results.reduce((sum, r) => sum + (r.hull3D[i]?.z || 0), 0) / results.length,
    }));

    // Calculate plane model from averaged vectors
    const plane = {
      a: avgNormal.x,
      b: avgNormal.y,
      c: avgNormal.z,
      d: -(avgNormal.x * avgP0.x + avgNormal.y * avgP0.y + avgNormal.z * avgP0.z),
      confidence: 0.8, // High confidence for averaged result
    };

    return {
      plane,
      hull2D: avgHull2D,
      hull3D: avgHull3D,
      confidence: 0.8,
      P0: avgP0,
      uVec: avgUVec,
      vVec: avgVVec,
      normal: avgNormal,
    };
  }

  getCurrentResult(): PlaneEstimationResult | null {
    if (this.state.fittingCount >= this.state.maxFittingCount) {
      return this.calculateAverageResults();
    }
    return null;
  }

  reset(): void {
    this.featureTracker.reset();
    this.state = {
      fittingCount: 0,
      fittingResults: [],
      maxFittingCount: this.config.planeEstimation.maxFittingCount,
    };
    this.emit("reset");
  }

  updateConfig(config: Partial<SPALAMConfig>): void {
    if (config.featureDetection) {
      // Update feature tracker config - would need to implement config update
    }
    if (config.depthEstimation) {
      // Update depth processor config
    }
    if (config.planeEstimation) {
      this.state.maxFittingCount = config.planeEstimation.maxFittingCount;
    }
  }

  dispose(): void {
    this.featureTracker.reset();
    this.depthProcessor.dispose();
    this.removeAllListeners();
  }
}
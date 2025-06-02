import { EventEmitter } from "../utils/EventEmitter";
import { Camera } from "../utils/Camera";
import { PlaneEstimator } from "./PlaneEstimator";
import { Renderer } from "./Renderer";
import { PlaneEstimationResult } from "../types/core";
import { SPALAMConfig, DEFAULT_CONFIG } from "../types/configuration";

// OpenCV is declared in opencv.d.ts

export class SPALAM extends EventEmitter {
  private config: SPALAMConfig;
  private camera: Camera | null = null;
  private planeEstimator: PlaneEstimator | null = null;
  private renderer: Renderer | null = null;
  private isRunning: boolean = false;
  private isInitialized: boolean = false;
  private currentResult: PlaneEstimationResult | null = null;
  private renderLoopId: number | null = null;

  constructor(config?: Partial<SPALAMConfig>) {
    super();
    this.config = this.mergeConfig(config);
  }

  private mergeConfig(config?: Partial<SPALAMConfig>): SPALAMConfig {
    return {
      camera: { ...DEFAULT_CONFIG.camera, ...config?.camera },
      featureDetection: { ...DEFAULT_CONFIG.featureDetection, ...config?.featureDetection },
      depthEstimation: { ...DEFAULT_CONFIG.depthEstimation, ...config?.depthEstimation },
      planeEstimation: { ...DEFAULT_CONFIG.planeEstimation, ...config?.planeEstimation },
      rendering: { ...DEFAULT_CONFIG.rendering, ...config?.rendering },
    };
  }

  async initialize(video?: HTMLVideoElement): Promise<void> {
    if (this.isInitialized) {
      throw new Error("SPALAM is already initialized");
    }

    try {
      this.emit("initializing");

      // 1. Initialize camera
      if (video) {
        // Use provided video element
        console.log("Using external video element");
        this.camera = null; // Will use external video
      } else {
        // Create and initialize internal camera
        console.log("Initializing internal camera...");
        this.camera = new Camera(this.config.camera);
        await this.camera.initialize();
        console.log("Camera initialized successfully");
      }

      // 2. Wait for OpenCV to be ready
      await this.waitForOpenCV();

      // 3. Initialize core engines
      this.planeEstimator = new PlaneEstimator(this.config, (window as any).cv);
      
      // Get actual camera resolution for renderer
      const cameraResolution = this.camera?.getResolution() || this.config.camera.resolution;
      const renderingConfig = {
        ...this.config.rendering,
        width: cameraResolution.width,
        height: cameraResolution.height,
      };
      this.renderer = new Renderer(renderingConfig);

      // 4. Initialize plane estimator (loads ML models)
      await this.planeEstimator.initialize();

      // 5. Setup event handlers
      this.setupEventHandlers();

      this.isInitialized = true;
      this.emit("initialized");
    } catch (error) {
      this.emit("error", error);
      throw new Error(`Failed to initialize SPALAM: ${error}`);
    }
  }

  private async waitForOpenCV(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if OpenCV is already available
      const cv = (window as any).cv;
      if (cv && cv.Mat) {
        resolve();
        return;
      }

      const checkOpenCV = () => {
        const cv = (window as any).cv;
        if (cv && cv.Mat) {
          resolve();
        } else {
          setTimeout(checkOpenCV, 100);
        }
      };

      // Timeout after 10 seconds
      setTimeout(() => {
        reject(new Error("OpenCV failed to load within timeout"));
      }, 10000);

      checkOpenCV();
    });
  }

  private setupEventHandlers(): void {
    if (!this.planeEstimator || !this.renderer) return;

    // Forward events from plane estimator
    this.planeEstimator.on("error", (error) => this.emit("error", error));
    this.planeEstimator.on("featuresDetected", (features) => this.emit("featuresDetected", features));
    this.planeEstimator.on("depthProcessed", (depthMap) => this.emit("depthProcessed", depthMap));
    this.planeEstimator.on("planeEstimated", (result) => this.emit("planeEstimated", result));
    this.planeEstimator.on("fittingProgress", (progress) => this.emit("fittingProgress", progress));
    this.planeEstimator.on("frameProcessed", (result) => {
      this.currentResult = result;
      this.emit("frameProcessed", result);
    });

    // Forward events from renderer
    this.renderer.on("error", (error) => this.emit("error", error));
    this.renderer.on("rendered", (result) => this.emit("rendered", result));
  }

  async start(video?: HTMLVideoElement): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("SPALAM not initialized. Call initialize() first.");
    }

    if (this.isRunning) {
      throw new Error("SPALAM is already running");
    }

    try {
      // Update video source if provided
      if (video && !this.camera) {
        // External video mode
      } else if (!this.camera) {
        throw new Error("No camera or video source available");
      }

      this.isRunning = true;
      this.emit("started");
      
      // Start render loop
      this.startRenderLoop(video);
    } catch (error) {
      this.emit("error", error);
      throw error;
    }
  }

  private startRenderLoop(externalVideo?: HTMLVideoElement): void {
    const renderFrame = async () => {
      if (!this.isRunning) return;

      try {
        // Get canvas from camera or external video
        let canvas: HTMLCanvasElement;
        
        if (externalVideo) {
          // Create temporary canvas for external video
          canvas = document.createElement("canvas");
          canvas.width = externalVideo.videoWidth || 640;
          canvas.height = externalVideo.videoHeight || 480;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(externalVideo, 0, 0);
        } else if (this.camera) {
          canvas = this.camera.getCanvas();
        } else {
          throw new Error("No video source available");
        }

        // Process frame for features and plane estimation
        const result = await this.planeEstimator!.estimateFrame(canvas);

        // Render result if available
        if (result && this.renderer) {
          this.renderer.renderPlane(result);
        } else if (this.renderer) {
          // Always render to update the scene
          this.renderer.render();
        }

        // Continue render loop
        this.renderLoopId = requestAnimationFrame(renderFrame);
      } catch (error) {
        this.emit("error", error);
        // Continue render loop even on error
        this.renderLoopId = requestAnimationFrame(renderFrame);
      }
    };

    renderFrame();
  }

  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    
    if (this.renderLoopId) {
      cancelAnimationFrame(this.renderLoopId);
      this.renderLoopId = null;
    }

    this.emit("stopped");
  }

  reset(): void {
    if (this.planeEstimator) {
      this.planeEstimator.reset();
    }
    this.currentResult = null;
    this.emit("reset");
  }

  // Public API methods
  updateConfig(config: Partial<SPALAMConfig>): void {
    this.config = this.mergeConfig(config);
    
    // Update components with new config
    if (this.planeEstimator) {
      this.planeEstimator.updateConfig(this.config);
    }
    
    if (this.renderer && config.rendering) {
      this.renderer.updateConfig(config.rendering);
    }

    this.emit("configUpdated", this.config);
  }

  getCurrentPlane(): PlaneEstimationResult | null {
    return this.currentResult || (this.planeEstimator?.getCurrentResult() || null);
  }

  getConfig(): SPALAMConfig {
    return { ...this.config };
  }

  isInitializedState(): boolean {
    return this.isInitialized;
  }

  isRunningState(): boolean {
    return this.isRunning;
  }

  // Camera controls
  getCameraResolution(): { width: number; height: number } | null {
    return this.camera?.getResolution() || null;
  }

  // Advanced API - expose internal components for customization
  getPlaneEstimator(): PlaneEstimator | null {
    return this.planeEstimator;
  }

  getRenderer(): Renderer | null {
    return this.renderer;
  }

  // Cleanup
  dispose(): void {
    this.stop();

    if (this.camera) {
      this.camera.stop();
    }

    if (this.planeEstimator) {
      this.planeEstimator.dispose();
    }

    if (this.renderer) {
      this.renderer.dispose();
    }

    this.removeAllListeners();
    this.isInitialized = false;
  }
}
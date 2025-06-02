import { AutoModel, AutoProcessor, RawImage } from "@huggingface/transformers";
import { EventEmitter } from "../utils/EventEmitter";
import { Feature, Point3D } from "../types/core";
import { DepthEstimationConfig } from "../types/configuration";

export class DepthProcessor extends EventEmitter {
  private model: any = null;
  private processor: any = null;
  private config: DepthEstimationConfig;
  private isProcessing: boolean = false;
  private lastDepthMap: Float32Array | null = null;
  private depthCanvas: HTMLCanvasElement | null = null;
  private depthContext: CanvasRenderingContext2D | null = null;

  constructor(config: DepthEstimationConfig) {
    super();
    this.config = config;
    this.setupDepthVisualization();
  }

  private setupDepthVisualization(): void {
    if (this.config.showDepth) {
      this.depthCanvas = document.createElement("canvas");
      this.depthCanvas.id = "depthCanvas";
      this.depthCanvas.style.position = "fixed";
      this.depthCanvas.style.top = "0";
      this.depthCanvas.style.right = "0";
      this.depthCanvas.style.width = "320px";
      this.depthCanvas.style.height = "240px";
      this.depthCanvas.style.border = "2px solid white";
      this.depthCanvas.style.zIndex = "20";
      this.depthContext = this.depthCanvas.getContext("2d", {
        willReadFrequently: true,
      });
      document.body.appendChild(this.depthCanvas);
    }
  }

  async initialize(): Promise<void> {
    try {
      const hasFp16 = async (): Promise<boolean> => {
        try {
          const adapter = await (navigator as any).gpu?.requestAdapter();
          return adapter?.features.has("shader-f16") || false;
        } catch {
          return false;
        }
      };

      const useWebGPU = this.config.device === "webgpu" && !!(navigator as any).gpu;
      const dtype = useWebGPU && (await hasFp16()) ? this.config.dtype : "fp32";

      this.model = await AutoModel.from_pretrained(this.config.modelId, {
        device: useWebGPU ? "webgpu" : "cpu",
        dtype,
      });

      this.processor = await AutoProcessor.from_pretrained(this.config.modelId);
      this.processor.feature_extractor.size = {
        width: this.config.size,
        height: this.config.size,
      };

      this.emit("modelLoaded");
    } catch (error) {
      this.emit("error", error);
      throw new Error(`Failed to initialize depth model: ${error}`);
    }
  }

  async processDepth(canvas: HTMLCanvasElement): Promise<Float32Array | null> {
    if (!this.model || !this.processor) {
      console.error("Model or processor not loaded");
      return null;
    }

    if (this.isProcessing) {
      return this.lastDepthMap;
    }

    this.isProcessing = true;

    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not get canvas context");

      const currentFrame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const image = new RawImage(
        currentFrame.data,
        canvas.width,
        canvas.height,
        4
      );

      const inputs = await this.processor(image);
      const { predicted_depth } = await this.model(inputs);
      
      this.lastDepthMap = predicted_depth.data;
      const [bs, oh, ow] = predicted_depth.dims;

      if (this.config.showDepth && this.depthCanvas && this.depthContext) {
        this.visualizeDepth(this.lastDepthMap, ow, oh, canvas.width, canvas.height);
      }

      this.emit("depthProcessed", this.lastDepthMap);
      return this.lastDepthMap;
    } catch (error) {
      console.error("Depth processing error:", error);
      this.emit("error", error);
      return null;
    } finally {
      this.isProcessing = false;
    }
  }

  private visualizeDepth(
    depthMap: Float32Array,
    mapWidth: number,
    mapHeight: number,
    canvasWidth: number,
    canvasHeight: number
  ): void {
    if (!this.depthCanvas || !this.depthContext) return;

    // Find min/max for normalization
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < depthMap.length; i++) {
      const v = depthMap[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min;

    // Create visualization
    const imageData = new Uint8ClampedArray(4 * depthMap.length);
    for (let i = 0; i < depthMap.length; i++) {
      const offset = 4 * i;
      const normalizedDepth = (depthMap[i] - min) / range;

      imageData[offset] = normalizedDepth * 255; // R
      imageData[offset + 1] = 0; // G
      imageData[offset + 2] = (1 - normalizedDepth) * 255; // B
      imageData[offset + 3] = 255; // Alpha
    }

    const outPixelData = new ImageData(imageData, mapWidth, mapHeight);
    const tmp = document.createElement("canvas");
    tmp.width = mapWidth;
    tmp.height = mapHeight;
    const tmpCtx = tmp.getContext("2d")!;
    tmpCtx.putImageData(outPixelData, 0, 0);

    this.depthCanvas.width = canvasWidth;
    this.depthCanvas.height = canvasHeight;
    this.depthContext.clearRect(0, 0, canvasWidth, canvasHeight);
    this.depthContext.drawImage(
      tmp,
      0, 0, mapWidth, mapHeight,
      0, 0, canvasWidth, canvasHeight
    );
  }

  sampleDepthAtPoints(
    features: Feature[],
    depthMap: Float32Array,
    mapSize: { width: number; height: number }
  ): Point3D[] {
    if (!depthMap) return [];

    return features.map(feature => {
      // Convert feature coordinates to depth map coordinates
      const x = Math.round(feature.x);
      const y = Math.round(feature.y);
      
      // Ensure coordinates are within bounds
      const clampedX = Math.max(0, Math.min(mapSize.width - 1, x));
      const clampedY = Math.max(0, Math.min(mapSize.height - 1, y));
      
      const depthIndex = clampedY * mapSize.width + clampedX;
      let depth = depthMap[depthIndex] || 0;

      // Apply spatial smoothing to reduce noise
      depth = this.applySpatialSmoothing(
        depthMap,
        clampedX,
        clampedY,
        mapSize.width,
        mapSize.height
      );

      return {
        x: feature.x,
        y: feature.y,
        z: depth,
        id: feature.id,
      };
    });
  }

  private applySpatialSmoothing(
    depthMap: Float32Array,
    x: number,
    y: number,
    width: number,
    height: number,
    kernelSize: number = 3
  ): number {
    const halfKernel = Math.floor(kernelSize / 2);
    let sum = 0;
    let count = 0;

    for (let dy = -halfKernel; dy <= halfKernel; dy++) {
      for (let dx = -halfKernel; dx <= halfKernel; dx++) {
        const nx = x + dx;
        const ny = y + dy;

        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const index = ny * width + nx;
          sum += depthMap[index];
          count++;
        }
      }
    }

    return count > 0 ? sum / count : 0;
  }

  getLastDepthMap(): Float32Array | null {
    return this.lastDepthMap;
  }

  dispose(): void {
    if (this.depthCanvas && this.depthCanvas.parentElement) {
      this.depthCanvas.parentElement.removeChild(this.depthCanvas);
    }
    this.model = null;
    this.processor = null;
    this.lastDepthMap = null;
  }
}
import { AutoModel, AutoProcessor, RawImage } from "@huggingface/transformers";

export class DepthEstimation {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;

  model: any = null;
  processor: any = null;
  depthCanvas: HTMLCanvasElement;
  depthContext: CanvasRenderingContext2D | null = null;
  isProcessing: boolean = false;
  depthMap: Float32Array | null = null;

  constructor({
    canvas,
    context,
    showDepth = false,
  }: {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    showDepth?: boolean;
  }) {
    this.canvas = canvas;
    this.context = context;
    this.depthCanvas = document.createElement("canvas");
    this.depthCanvas.width = this.canvas.width;
    this.depthCanvas.height = this.canvas.height;
    this.depthContext = this.depthCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (showDepth) {
      document.body.appendChild(this.depthCanvas);
    }

    this.isProcessing = false;
  }

  async loadModel() {
    const model_id = "onnx-community/depth-anything-v2-small";
    try {
      const hasFp16 = async () => {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter.features.has("shader-f16");
      };
      this.model = await AutoModel.from_pretrained(model_id, {
        device: "webgpu",
        dtype: (await hasFp16()) ? "fp16" : "fp32",
      });
      this.processor = await AutoProcessor.from_pretrained(model_id, {});
      let size = 504;
      this.processor.feature_extractor.size = { width: size, height: size };
    } catch (err) {
      throw err;
    }
  }

  async getDepthMap() {
    if (!this.model || !this.processor) {
      console.error("Model or processor not loaded");
      return;
    }
    this.isProcessing = true;

    const currentFrame = this.context.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height
    );
    const image = new RawImage(
      currentFrame.data,
      this.canvas.width,
      this.canvas.height,
      4
    );
    const inputs = await this.processor(image);
    const { predicted_depth } = await this.model(inputs);
    this.depthMap = predicted_depth.data;
    const [bs, oh, ow] = predicted_depth.dims;

    if (!this.depthMap) return;

    let min = Infinity;
    let max = -Infinity;
    this.depthCanvas.width = ow;
    this.depthCanvas.height = oh;
    for (let i = 0; i < this.depthMap.length; ++i) {
      const v = this.depthMap[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min;

    const imageData = new Uint8ClampedArray(4 * this.depthMap.length);
    for (let i = 0; i < this.depthMap.length; ++i) {
      const offset = 4 * i;
      imageData[offset] = 255; // Set base color to red

      // Set alpha to normalized depth value
      imageData[offset + 3] = 255 * (1 - (this.depthMap[i] - min) / range);
    }
    const outPixelData = new ImageData(imageData, ow, oh);
    if (this.depthContext) {
      this.depthContext.putImageData(outPixelData, 0, 0);
    }

    this.isProcessing = false;

    return this.depthMap;
  }
}

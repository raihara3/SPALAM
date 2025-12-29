import { AutoModel, AutoProcessor, RawImage } from "@huggingface/transformers";

declare global {
  interface Navigator {
    gpu?: {
      requestAdapter(): Promise<GPUAdapter | null>;
    };
  }
  interface GPUAdapter {
    features: Set<string>;
    requestDevice(): Promise<GPUDevice | null>;
  }
  interface GPUDevice {
    destroy(): void;
  }
}

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
    this.depthCanvas.id = "depthCanvas";
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
    // モバイルデバイス検出
    const isMobile =
      /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      );
    console.log("Device type:", isMobile ? "Mobile" : "Desktop");

    // モバイルデバイスでは深度推定を無効化（ネットワーク制限により）
    if (isMobile) {
      console.warn("Depth estimation disabled on mobile devices due to network restrictions");
      throw new Error("Depth estimation is not supported on mobile devices. The system will use fallback depth calculation.");
    }

    const model_id = "onnx-community/depth-anything-v2-small";

    try {
      // CDN接続テスト
      await this.testHuggingFaceConnection();

      // WebGPU対応チェック
      const checkWebGPUSupport = async () => {
        if (!navigator.gpu) {
          console.log("WebGPU not available: navigator.gpu not found");
          return false;
        }

        try {
          const adapter = await navigator.gpu.requestAdapter();
          if (!adapter) {
            console.log("WebGPU not available: no adapter found");
            return false;
          }

          const device = await adapter.requestDevice();
          if (!device) {
            console.log("WebGPU not available: no device found");
            return false;
          }

          device.destroy();
          console.log("WebGPU available and tested successfully");
          return true;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.log("WebGPU test failed:", errorMessage);
          return false;
        }
      };

      const hasWebGPU = await checkWebGPUSupport();

      const hasFp16 = async () => {
        if (!hasWebGPU) return false;
        try {
          const adapter = await navigator.gpu?.requestAdapter();
          return adapter?.features.has("shader-f16") ?? false;
        } catch {
          return false;
        }
      };

      // デバイス別設定
      let deviceConfig: "wasm" | "webgpu";
      let dtypeConfig: "fp32" | "fp16";

      if (isMobile) {
        // モバイル: WASMのみ、fp32固定
        deviceConfig = "wasm";
        dtypeConfig = "fp32";
        console.log("Mobile device: using WASM backend with fp32");
      } else {
        // デスクトップ: WebGPU優先、WASMフォールバック
        deviceConfig = hasWebGPU ? "webgpu" : "wasm";
        dtypeConfig = hasWebGPU && (await hasFp16()) ? "fp16" : "fp32";
        console.log(
          `Desktop device: using ${deviceConfig} backend with ${dtypeConfig}`
        );
      }

      console.log("Model loading config:", {
        device: deviceConfig,
        dtype: dtypeConfig,
      });

      // ネットワーク接続チェック
      if (!navigator.onLine) {
        throw new Error("No internet connection available for model download");
      }

      // モバイル向けタイムアウト調整
      const timeoutDuration = isMobile ? 60000 : 30000; // モバイルでは60秒

      // タイムアウト付きでモデル読み込み
      const modelLoadPromise = AutoModel.from_pretrained(model_id, {
        device: deviceConfig,
        dtype: dtypeConfig,
      });

      const processorLoadPromise = AutoProcessor.from_pretrained(model_id);

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Model loading timeout")),
          timeoutDuration
        );
      });

      console.log(`Loading model with ${timeoutDuration / 1000}s timeout...`);
      [this.model, this.processor] = (await Promise.race([
        Promise.all([modelLoadPromise, processorLoadPromise]),
        timeoutPromise,
      ])) as [any, any];

      // モバイルでは小さいサイズを使用
      let size = isMobile ? 256 : 504;
      this.processor.feature_extractor.size = { width: size, height: size };

      console.log(
        `Depth estimation model loaded successfully with size: ${size}x${size}`
      );
    } catch (err) {
      console.error("Depth estimation initialization failed:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);

      // エラーの詳細分析
      if (errorMessage.includes("<!DOCTYPE")) {
        console.error("Network error: Received HTML instead of model data");
        throw new Error(
          "Model download failed: CDN returned HTML error page. This may be due to network restrictions or temporary service issues."
        );
      }

      if (errorMessage.includes("timeout")) {
        console.error("Model loading timeout");
        throw new Error(
          "Model download timeout: The model files are too large or network is too slow. Please try again with a better internet connection."
        );
      }

      if (errorMessage.includes("fetch")) {
        console.error("Network fetch error:", err);
        throw new Error(
          "Model download failed: Unable to download model files. Please check your internet connection and firewall settings."
        );
      }

      if (errorMessage.includes("WebGPU")) {
        console.error("WebGPU error:", err);
        throw new Error(
          "WebGPU initialization failed. Your device may not support WebGPU."
        );
      }

      if (errorMessage.includes("WASM")) {
        console.error("WASM backend error:", err);
        if (isMobile) {
          throw new Error(
            "WASM depth estimation failed on mobile device. Using fallback depth calculation."
          );
        } else {
          throw new Error(
            "WASM fallback failed. Please check browser compatibility."
          );
        }
      }

      // 一般的なエラーハンドリング
      throw new Error(`Depth estimation setup failed: ${errorMessage}`);
    }
  }

  /**
   * Hugging Face CDNへの接続テスト
   */
  private async testHuggingFaceConnection(): Promise<void> {
    try {
      const testUrl =
        "https://huggingface.co/api/models/onnx-community/depth-anything-v2-small";
      const response = await fetch(testUrl, {
        method: "HEAD",
        timeout: 5000,
      } as any);

      if (!response.ok) {
        throw new Error(`CDN connection test failed: ${response.status}`);
      }

      console.log("Hugging Face CDN connection test passed");
    } catch (error) {
      console.warn("Hugging Face CDN connection test failed:", error);
      throw new Error(
        "Unable to connect to Hugging Face CDN. Please check your internet connection and firewall settings."
      );
    }
  }

  async getDepthMap() {
    if (!this.model || !this.processor) {
      console.error("Model or processor not loaded");
      return;
    }
    if (this.isProcessing) return;
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
    const [_bs, oh, ow] = predicted_depth.dims;

    if (!this.depthMap) return;

    let min = Infinity;
    let max = -Infinity;
    // this.depthCanvas.width = ow;
    // this.depthCanvas.height = oh;
    for (let i = 0; i < this.depthMap.length; ++i) {
      const v = this.depthMap[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min;

    const imageData = new Uint8ClampedArray(4 * this.depthMap.length);
    for (let i = 0; i < this.depthMap.length; ++i) {
      const offset = 4 * i;
      const normalizedDepth = (this.depthMap[i] - min) / range;

      // RGBを深度値に基づいて設定（例：青から赤へのグラデーション）
      imageData[offset] = normalizedDepth * 255; // R
      imageData[offset + 1] = 0; // G
      imageData[offset + 2] = (1 - normalizedDepth) * 255; // B
      imageData[offset + 3] = 255; // Alpha（完全不透明）
    }
    const outPixelData = new ImageData(imageData, ow, oh);
    const tmp = document.createElement("canvas");
    tmp.width = ow;
    tmp.height = oh;
    const tmpCtx = tmp.getContext("2d")!;
    tmpCtx.putImageData(outPixelData, 0, 0);
    // if (this.depthContext) {
    //   this.depthContext.putImageData(outPixelData, 0, 0);
    // }
    this.depthContext!.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.depthContext!.drawImage(
      tmp,
      0,
      0,
      ow,
      oh,
      0,
      0,
      this.canvas.width,
      this.canvas.height
    );

    this.isProcessing = false;

    return this.depthMap;
  }
}

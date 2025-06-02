import { CameraConfig } from "../types/configuration";

export class Camera {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private stream: MediaStream | null = null;
  private config: CameraConfig;

  constructor(config: CameraConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    try {
      console.log("Requesting camera access...");
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: this.config.facingMode,
          width: { ideal: this.config.resolution.width },
          height: { ideal: this.config.resolution.height },
        },
      });
      console.log("Camera stream obtained");

      this.video = document.createElement("video");
      this.video.srcObject = this.stream;
      this.video.autoplay = true;
      this.video.playsInline = true;
      this.video.muted = true; // Add muted for autoplay
      
      // Add video to DOM for debugging
      this.video.style.position = "fixed";
      this.video.style.top = "0";
      this.video.style.left = "0";
      this.video.style.width = "100%";
      this.video.style.height = "100%";
      this.video.style.objectFit = "cover";
      this.video.style.zIndex = "1";
      document.body.appendChild(this.video);

      await new Promise<void>((resolve, reject) => {
        this.video!.onloadedmetadata = () => {
          console.log("Video metadata loaded:", {
            width: this.video!.videoWidth,
            height: this.video!.videoHeight
          });
          this.setupCanvas();
          resolve();
        };
        
        this.video!.onerror = (error) => {
          console.error("Video error:", error);
          reject(new Error("Video load error"));
        };
        
        // Timeout after 5 seconds
        setTimeout(() => {
          reject(new Error("Video load timeout"));
        }, 5000);
      });
    } catch (error) {
      console.error("Camera initialization failed:", error);
      throw new Error(`Failed to initialize camera: ${error}`);
    }
  }

  private setupCanvas(): void {
    if (!this.video) return;

    this.canvas = document.createElement("canvas");
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
    this.ctx = this.canvas.getContext("2d")!;
  }

  getVideoElement(): HTMLVideoElement {
    if (!this.video) {
      throw new Error("Camera not initialized");
    }
    return this.video;
  }

  getCanvas(): HTMLCanvasElement {
    if (!this.canvas) {
      throw new Error("Camera not initialized");
    }
    
    // Update canvas with current video frame
    if (this.video && this.ctx) {
      this.ctx.drawImage(this.video, 0, 0);
    }
    
    return this.canvas;
  }

  getResolution(): { width: number; height: number } {
    if (!this.video) {
      throw new Error("Camera not initialized");
    }
    return {
      width: this.video.videoWidth,
      height: this.video.videoHeight,
    };
  }

  stop(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
  }
}
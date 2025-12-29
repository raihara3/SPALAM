export class CameraController {
  readonly video: HTMLVideoElement;

  constructor() {
    this.video = document.createElement("video");
  }

  async initCamera(): Promise<void> {
    try {
      console.log("Requesting camera access...");

      // カメラアクセス許可をリクエスト
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
        },
      });

      console.log("Camera access granted, setting up video element...");
      this.video.srcObject = stream;

      // メタデータの読み込み完了を待機
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Video metadata loading timeout"));
        }, 5000);

        this.video.onloadedmetadata = () => {
          clearTimeout(timeout);
          this.video.width = this.video.videoWidth;
          this.video.height = this.video.videoHeight;
          console.log(
            `Video resolution: ${this.video.width}x${this.video.height}`
          );
          resolve();
        };

        this.video.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("Video element error"));
        };
      });

      // 動画再生開始
      await this.video.play();
      document.body.appendChild(this.video);

      console.log("Camera initialized successfully");
    } catch (error) {
      console.error("Camera initialization failed:", error);
      const errorName = error instanceof Error ? error.name : "";
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (errorName === "NotAllowedError") {
        throw new Error(
          "Camera access denied. Please allow camera permissions and reload the page."
        );
      } else if (errorName === "NotFoundError") {
        throw new Error(
          "No camera found. Please connect a camera and reload the page."
        );
      } else if (errorName === "NotSupportedError") {
        throw new Error("Camera is not supported on this device.");
      } else {
        throw new Error(`Camera initialization failed: ${errorMessage}`);
      }
    }
  }

  getVideo(): HTMLVideoElement {
    return this.video;
  }
}

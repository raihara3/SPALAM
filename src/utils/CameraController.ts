export class CameraController {
  readonly video: HTMLVideoElement;

  constructor() {
    this.video = document.createElement("video");
  }

  async initCamera(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
      },
    });

    this.video.srcObject = stream;

    await new Promise<void>((resolve) => {
      this.video.onloadedmetadata = () => {
        this.video.width = this.video.videoWidth;
        this.video.height = this.video.videoHeight;
        resolve();
      };
    });

    await this.video.play();
    document.body.appendChild(this.video);
  }

  getVideo(): HTMLVideoElement {
    return this.video;
  }
}

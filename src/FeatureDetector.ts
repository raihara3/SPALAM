export class FeatureDetector {
  readonly cv: any;
  readonly video: HTMLVideoElement;

  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  constructor({
    cv,
    video,
    canvas = null,
  }: {
    cv: any;
    video: HTMLVideoElement;
    canvas?: HTMLCanvasElement | null;
  }) {
    this.cv = cv;
    this.video = video;

    this.canvas = canvas || document.createElement("canvas");
    this.canvas.width = video.videoWidth;
    this.canvas.height = video.videoHeight;

    this.ctx = this.canvas.getContext("2d")!;

    document.body.appendChild(this.canvas);
    this.render();
  }

  render() {
    this.ctx.drawImage(this.video, 0, 0);
    requestAnimationFrame(() => this.render());
  }
}

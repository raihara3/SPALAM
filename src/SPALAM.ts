// lib
import cv from "@techstark/opencv-js";

// modules
import { FeatureDetector } from "./FeatureDetector";
import { DepthEstimation } from "./DepthEstimation";

// utils
import { CameraController } from "./utils/CameraController";

// helpers
import sampleDepthAtFeaturePoints from "./helpers/sampleDepthAtFeaturePoints";
import backProjectPoints from "./helpers/backProjectPoints";

class SPALAM {
  video: HTMLVideoElement | null;
  featureDetector: FeatureDetector | null = null;
  depthEstimation: DepthEstimation | null = null;

  constructor() {
    this.video = null;
  }

  public start({ video = null }: { video?: HTMLVideoElement | null } = {}) {
    const setup = async () => {
      if (video) {
        this.video = video;
      } else {
        const cameraController = new CameraController();
        await cameraController.initCamera();
        this.video = cameraController.getVideo();
      }
      this.video.style.display = "none";
      console.debug("Video element:", this.video);

      this.featureDetector = new FeatureDetector({
        cv,
        video: this.video,
        showFeatures: true,
      });

      this.depthEstimation = new DepthEstimation({
        canvas: this.featureDetector!.canvas,
        context: this.featureDetector!.ctx,
        showDepth: true,
      });
      await this.depthEstimation.loadModel();

      this.render();
    };

    cv.onRuntimeInitialized = async () => {
      console.log(cv.getBuildInformation());
      await setup();
      this.getPoints3D();
    };
  }

  async getPoints3D() {
    if (!this.depthEstimation) return;
    const depthMap = await this.depthEstimation.getDepthMap();
    if (!depthMap) return;
    const points3D = sampleDepthAtFeaturePoints({
      featurePoints: this.featureDetector!.getTrackedFeaturePoints(),
      depthMap: depthMap,
      mapWidth: this.featureDetector!.canvas.width,
      mapHeight: this.featureDetector!.canvas.height,
    });
    const points3DBackProjected = backProjectPoints(points3D);
    console.log(points3DBackProjected);
  }

  public render() {
    if (this.featureDetector) {
      this.featureDetector.render();
    }
    requestAnimationFrame(() => this.render());
  }
}

export default SPALAM;

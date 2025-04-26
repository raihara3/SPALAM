// lib
import cv from "@techstark/opencv-js";

import { FeatureDetector } from "./FeatureDetector";

// utils
import { CameraController } from "./utils/CameraController";

class SPALAM {
  video: HTMLVideoElement | null;
  featureDetector: FeatureDetector | null = null;

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
      console.debug("Video element:", this.video);
      this.video.style.display = "none";
      this.featureDetector = new FeatureDetector({
        cv,
        video: this.video,
        showFeatures: true,
      });
      this.render();
    };

    cv.onRuntimeInitialized = () => {
      console.log(cv.getBuildInformation());
      setup();
    };
  }

  public render() {
    if (this.featureDetector) {
      this.featureDetector.render();
    }
    requestAnimationFrame(() => this.render());
  }
}

export default SPALAM;

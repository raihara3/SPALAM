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

  start({ video = null }: { video?: HTMLVideoElement | null } = {}) {
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
      this.featureDetector = new FeatureDetector({ cv, video: this.video });
    };

    cv.onRuntimeInitialized = () => {
      console.log(cv.getBuildInformation());
      setup();
    };
  }
}

export default SPALAM;

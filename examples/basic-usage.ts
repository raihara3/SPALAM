import { SPALAM, SPALAMConfig } from "../src/index";

// Basic usage example
async function basicExample() {
  const spalam = new SPALAM();
  
  // Add event listeners
  spalam.on("initialized", () => console.log("✓ SPALAM initialized"));
  spalam.on("started", () => console.log("✓ SPALAM started"));
  spalam.on("frameProcessed", (result) => {
    console.log("Frame processed - confidence:", result.confidence);
  });
  spalam.on("error", (error) => console.error("❌ Error:", error));

  try {
    await spalam.initialize();
    await spalam.start();
  } catch (error) {
    console.error("Failed to start SPALAM:", error);
  }
}

// Advanced configuration example
async function advancedExample() {
  const config: Partial<SPALAMConfig> = {
    featureDetection: {
      maxCorners: 1000,
      qualityLevel: 0.01,
      trackingFrames: 10,
      roiEnabled: true,
      roiSize: { width: 0.6, height: 0.6 },
    },
    planeEstimation: {
      maxFittingCount: 5,
      depthFilterThreshold: 0.03,
    },
    rendering: {
      planeMaterial: {
        color: 0xff0000,
        opacity: 0.5,
        transparent: true,
      },
    },
  };

  const spalam = new SPALAM(config);
  
  spalam.on("fittingProgress", (progress) => {
    console.log(`Fitting progress: ${progress.current}/${progress.total}`);
  });

  try {
    await spalam.initialize();
    await spalam.start();
  } catch (error) {
    console.error("Failed to start SPALAM:", error);
  }
}

// External video source example
async function externalVideoExample() {
  const video = document.createElement("video");
  // Setup your external video source here
  
  const spalam = new SPALAM();
  
  try {
    await spalam.initialize();
    await spalam.start(video);
  } catch (error) {
    console.error("Failed to start SPALAM with external video:", error);
  }
}

export { basicExample, advancedExample, externalVideoExample };
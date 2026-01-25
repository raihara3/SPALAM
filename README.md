# SPALAM

> **v0.1 (Beta)** - This library is in early development. APIs may change.

TypeScript-based WebAR library for real-time plane detection and tracking using computer vision.

<!-- ./examples/sample.mp4を埋め込む -->
<video width="100%" controls>
  <source src="./examples/sample.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

## Features

- **Real-time Plane Detection**: RANSAC-based plane fitting from camera feed
- **Depth Estimation**: AI-powered depth estimation using Hugging Face Transformers (Depth Anything v2)
- **Feature Detection**: OpenCV.js-based feature detection (ORB/SIFT algorithms)
- **WebGPU Acceleration**: GPU-accelerated depth estimation when available
- **Three.js Integration**: Built-in AR rendering with Three.js
- **IMU Fusion**: Optional device motion tracking for improved stability
- **Fluent API**: Builder pattern for intuitive configuration

## Installation

```bash
git clone https://github.com/raihara3/SPALAM.git
cd SPALAM
npm install
npm run build
```

### Dependencies

SPALAM requires the following dependencies:

- [three.js](https://threejs.org/) - 3D rendering
- [@huggingface/transformers](https://huggingface.co/docs/transformers.js) - Depth estimation models
- [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html) - Feature detection

Include OpenCV.js in your HTML:

```html
<script async src="https://docs.opencv.org/4.x/opencv.js"></script>
```

## Quick Start

```typescript
import { createSPALAM } from "./src/SPALAM";

// Create and configure SPALAM instance
const spalam = createSPALAM()
  .useWebGPU() // Enable GPU acceleration
  .enableDebug() // Show feature points and depth map
  .build();

// Listen for plane detection
spalam.on("plane:detected", (plane) => {
  console.log("Plane detected!", plane.position, plane.normal);
});

// Start processing
await spalam.start();
```

## Configuration

### Builder Methods

```typescript
import { createSPALAM } from "./src/SPALAM";

const spalam = createSPALAM()
  // Feature detection settings
  .features({
    maxCorners: 200, // Maximum feature points
    qualityLevel: 0.005, // Quality threshold
    minDistance: 15, // Minimum distance between points
    showFeatures: true, // Visualize feature points
  })
  // Depth estimation settings
  .depth({
    modelId: "depth-anything-v2-small", // Depth model
    device: "webgpu", // 'webgpu' or 'cpu'
    showDepth: true, // Visualize depth map
  })
  // Plane fitting settings
  .plane({
    ransacIterations: 2000, // RANSAC iterations
    ransacThreshold: 0.05, // RANSAC threshold
    smoothingIterations: 5, // Spatial smoothing
  })
  .build();
```

### Events

```typescript
spalam
  .on("frame:processed", (frameData) => {
    console.log(`Features: ${frameData.features.length}`);
  })
  .on("plane:detected", (planeData) => {
    console.log(`Position: ${planeData.position}`);
    console.log(`Confidence: ${planeData.confidence}`);
  })
  .on("state:changed", (event) => {
    console.log(`State: ${event.current}`);
  })
  .on("error", (error) => {
    console.error("Error:", error);
  });
```

### Lifecycle

```typescript
// Start
await spalam.start();

// Pause/Resume
spalam.pause();
spalam.resume();

// Stop and cleanup
spalam.stop();
spalam.dispose();
```

## Browser Support

| Browser     | Support       |
| ----------- | ------------- |
| Chrome 113+ | Full (WebGPU) |
| Edge 113+   | Full (WebGPU) |
| Safari 18+  | Full (WebGPU) |
| Firefox     | CPU fallback  |

## API Documentation

For detailed API documentation, see the [TypeDoc generated docs](./docs/).

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build library
npm run build

# Run tests
npm run test

# Lint and format
npm run lint
npm run format
```

## Roadmap

- [ ] Publish npm package
- [ ] WebAssembly integration for improved performance
- [ ] Enhanced plane detection accuracy
- [ ] Multi-plane detection support

## License

Apache-2.0

Copyright 2025 raihara3

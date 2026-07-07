# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SPALAM is a TypeScript-based WebAR library for real-time plane detection and tracking using computer vision. It combines OpenCV.js for feature detection, Hugging Face Transformers for depth estimation, and Three.js for AR rendering.

## Common Development Commands

```bash
# Development
npm run dev          # Start Vite dev server on http://localhost:5173

# Building
npm run build        # Build library + TypeScript declarations
npm run build:types  # Build only TypeScript declarations

# Testing
npm test             # Run Vitest test suite
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage

# Code Quality
npm run lint         # Run ESLint checks
npm run lint:fix     # Fix ESLint issues automatically
npm run format       # Format code with Prettier
npm run format:check # Check code formatting

# Preview production build
npm run preview
```

## Architecture Overview

### Service-Oriented Architecture
The codebase uses a service-oriented architecture with dependency injection through `ServiceContainer`. Core services include:

- **StateManager**: Central state management for the application
- **FrameProcessor**: Main pipeline orchestrating frame processing
- **FeatureDetectionService**: OpenCV-based feature detection (ORB, SIFT algorithms)
- **DepthEstimationService**: AI depth estimation using Hugging Face models
- **PlaneFittingService**: RANSAC-based plane detection from 3D points
- **RenderingService**: Three.js-based AR rendering
- **AnimationService**: Frame update loop management

### Processing Pipeline
1. Camera frame capture
2. Feature detection (via OpenCV in worker thread)
3. Depth estimation (via Transformers in worker thread)
4. 3D point back-projection from features and depth
5. RANSAC plane fitting on 3D points
6. AR rendering of detected planes

### Key Design Patterns
- **Worker Threads**: Heavy computations (depth estimation, feature detection) run in Web Workers
- **Modular Exports**: Components can be used individually or through the main SPALAM class
- **Mobile Fallbacks**: Depth estimation has simplified fallbacks for mobile devices
- **Configuration System**: Centralized config with environment-specific overrides

## Important Implementation Details

### OpenCV Integration
- OpenCV.js loaded via CDN (see index.html)
- Custom TypeScript declarations in `src/opencv.d.ts`
- Feature detection algorithms: ORB (default) and SIFT

### Depth Estimation Models
- Default: "Xenova/depth-anything-v2-small"
- Mobile: Falls back to simplified methods when WebGPU unavailable
- See `MOBILE_DEPTH_ESTIMATION_RESEARCH.md` for compatibility details

### Plane Detection
- RANSAC algorithm with configurable iterations and thresholds
- Convex hull computation for plane boundaries
- Weighted plane fitting for improved accuracy

### 6DoF Camera Tracking (Phase 1, opt-in)
- Enabled via `tracking.enableSixDof` config (default: false); switches feature detection to full-frame
- Landmark map + RANSAC PnP pipeline in `src/tracking/`: `TrackingStateMachine`, `LandmarkMap`, `MapInitializer`, `CameraTracker`
- `CameraPose` uses the camera-to-world convention
- Feature detection uses grid bucketing and a forward-backward LK check (config: `features.detectionRegion`, `features.forwardBackwardThreshold`, `features.grid`)
- Per-stage frame profiling via `StageProfiler` (`src/utils/`); `getPerformanceStats()` returns real measurements
- Public APIs: `getTrackingState()`, `getFrameBudgetStatistics()`, `getSixDofTrackingStatistics()`

### Build Configuration
- Vite library mode with ES modules and CommonJS output
- External dependencies: `@huggingface/transformers`, `three`
- TypeScript strict mode enabled with all checks
- Source maps included in builds

## Current Development Focus

The project is undergoing a 6DoF tracking overhaul (see `IMPROVEMENT_PLAN.md`):
- Phase 1 (done): tracking state machine, landmark map, gated map initialization, RANSAC PnP camera tracking (opt-in)
- Phase 2-3 (planned): IMU fusion and anchor reconciliation with the 6DoF pose
- Mobile performance optimizations

## Testing

Vitest is configured (`npm test`). Test files are colocated with sources as `*.test.ts`.
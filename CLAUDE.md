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

### Build Configuration
- Vite library mode with ES modules and CommonJS output
- External dependencies: `@huggingface/transformers`, `three`
- TypeScript strict mode enabled with all checks
- Source maps included in builds

## Current Development Focus

The project is in active development on the `feature/plane-tracking` branch:
- Implementing camera motion tracking (see `SPALAM_PLAN.md`)
- Refactoring for better modularity (see `REFACTORING_PLAN.md`)
- Mobile performance optimizations

## Testing

Currently no test framework is configured. Jest implementation is planned according to REFACTORING_PLAN.md.
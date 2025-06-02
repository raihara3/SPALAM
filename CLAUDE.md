# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

- `npm run dev` - Start development server with Vite
- `npm run build` - Build for production (runs TypeScript compiler then Vite build)
- `npm run preview` - Preview production build

## Project Architecture

SPALAM is a WebGL-based augmented reality application that implements SLAM (Simultaneous Localization and Mapping) using computer vision techniques. The architecture consists of several interconnected modules:

### Core System (SPALAM.ts)
The main orchestrator that coordinates all subsystems:
- Manages render loop and frame processing
- Implements plane fitting with spatial smoothing (3-iteration averaging for stability)
- Handles feature tracking lifecycle and plane estimation state machine
- Coordinates between feature detection, depth estimation, and AR rendering

### Feature Detection Pipeline (FeatureDetector.ts)
- Uses OpenCV.js for Harris corner detection and optical flow tracking
- Implements center ROI masking (middle 50% of frame) for focused feature detection
- Tracks feature stability over multiple frames (minimum 5 frames for validity)
- Maintains center feature selection for plane origin determination

### Depth Estimation (DepthEstimation.ts)
- Integrates Hugging Face Transformers with "depth-anything-v2-small" model
- Uses WebGPU acceleration with fp16/fp32 fallback
- Processes camera frames to generate depth maps for 3D reconstruction

### AR Rendering (ARRenderer.ts)
- Three.js-based 3D renderer with transparent overlay
- Manages camera positioning and scene graph
- Renders detected planes as semi-transparent meshes

### Helper Functions (helpers/)
- `fitPlaneRANSAC.ts` - RANSAC-based plane fitting with outlier filtering
- `weightedPlaneFit2D.ts` - Weighted least squares plane refinement
- `sampleDepthAtFeaturePoints.ts` - Depth sampling at feature locations
- `backProjectPoints.ts` - 2D-to-3D point projection using camera intrinsics
- Convex hull computation and 2D/3D coordinate transformations

### Key Technical Details
- Uses camera intrinsics for accurate 3D reconstruction
- Implements weighted plane fitting with reprojection error, depth gradient, and tracking stability weights
- Features spatial smoothing across multiple iterations to reduce noise in plane estimation
- Maintains feature tracking state across frames for temporal consistency

### Development Notes
- All OpenCV matrices must be explicitly deleted to prevent memory leaks
- WebGPU feature detection determines fp16 vs fp32 precision for depth model
- Canvas elements are dynamically created and overlaid for multi-layer rendering
- Type definitions in `src/types/` provide shared interfaces across modules
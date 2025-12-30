import { describe, it, expect, beforeEach } from "vitest";
import { DistanceTracker } from "./DistanceTracker";
import type { Feature } from "../types/Feature";

function createFeature(
  id: string,
  x: number,
  y: number,
  trackingCount: number
): Feature {
  return { id, x, y, trackingCount };
}

describe("DistanceTracker", () => {
  let tracker: DistanceTracker;

  beforeEach(() => {
    tracker = new DistanceTracker({
      minTrackedFrames: 3,
      maxPairs: 10,
      minPairDistance: 50,
    });
  });

  describe("constructor", () => {
    it("should use default options", () => {
      const defaultTracker = new DistanceTracker();
      expect(defaultTracker.getScale()).toBe(1.0);
    });

    it("should accept custom options", () => {
      const customTracker = new DistanceTracker({
        minTrackedFrames: 5,
        maxPairs: 15,
        minPairDistance: 30,
      });
      expect(customTracker.getScale()).toBe(1.0);
    });
  });

  describe("setInitialDepth", () => {
    it("should set initial and current depth", () => {
      tracker.setInitialDepth(2.5);
      expect(tracker.getDepth()).toBe(2.5);
    });
  });

  describe("update", () => {
    it("should return current scale with fewer than 2 features", () => {
      const features: Feature[] = [createFeature("f1", 100, 100, 20)];
      expect(tracker.update(features)).toBe(1.0);
    });

    it("should track feature pairs", () => {
      // First frame: create pairs
      const features1: Feature[] = [
        createFeature("f1", 100, 100, 20),
        createFeature("f2", 200, 100, 20),
        createFeature("f3", 150, 200, 20),
      ];
      tracker.update(features1);
      expect(tracker.getTrackedPairCount()).toBeGreaterThan(0);
    });

    it("should update scale when features spread apart", () => {
      // Initial features
      const features1: Feature[] = [
        createFeature("f1", 100, 100, 20),
        createFeature("f2", 200, 100, 20),
      ];

      // Update multiple frames to reach minTrackedFrames
      for (let i = 0; i < 5; i++) {
        tracker.update(features1);
      }

      // Features spread apart (camera moving closer)
      const features2: Feature[] = [
        createFeature("f1", 50, 100, 25),
        createFeature("f2", 250, 100, 25),
      ];

      const scale = tracker.update(features2);
      expect(scale).toBeGreaterThan(1.0);
    });

    it("should update scale when features converge", () => {
      // Initial features
      const features1: Feature[] = [
        createFeature("f1", 100, 100, 20),
        createFeature("f2", 200, 100, 20),
      ];

      // Update multiple frames
      for (let i = 0; i < 5; i++) {
        tracker.update(features1);
      }

      // Features converge (camera moving farther)
      const features2: Feature[] = [
        createFeature("f1", 125, 100, 25),
        createFeature("f2", 175, 100, 25),
      ];

      const scale = tracker.update(features2);
      expect(scale).toBeLessThan(1.0);
    });

    it("should remove pairs when features disappear", () => {
      const features1: Feature[] = [
        createFeature("f1", 100, 100, 20),
        createFeature("f2", 200, 100, 20),
        createFeature("f3", 150, 200, 20),
      ];
      tracker.update(features1);
      const initialPairs = tracker.getTrackedPairCount();

      // Remove one feature
      const features2: Feature[] = [
        createFeature("f1", 100, 100, 21),
        createFeature("f2", 200, 100, 21),
      ];
      tracker.update(features2);

      expect(tracker.getTrackedPairCount()).toBeLessThanOrEqual(initialPairs);
    });

    it("should not create pairs below minimum distance", () => {
      const features: Feature[] = [
        createFeature("f1", 100, 100, 20),
        createFeature("f2", 110, 100, 20), // Only 10 pixels apart
      ];

      tracker.update(features);
      expect(tracker.getTrackedPairCount()).toBe(0);
    });
  });

  describe("getScale", () => {
    it("should return 1.0 initially", () => {
      expect(tracker.getScale()).toBe(1.0);
    });
  });

  describe("getDepth", () => {
    it("should return initial depth when set", () => {
      tracker.setInitialDepth(3.0);
      expect(tracker.getDepth()).toBe(3.0);
    });

    it("should update depth based on scale", () => {
      tracker.setInitialDepth(2.0);

      // Create stable pairs
      const features1: Feature[] = [
        createFeature("f1", 100, 100, 20),
        createFeature("f2", 200, 100, 20),
      ];

      for (let i = 0; i < 5; i++) {
        tracker.update(features1);
      }

      // Double the distance (scale = 2.0)
      const features2: Feature[] = [
        createFeature("f1", 50, 100, 25),
        createFeature("f2", 250, 100, 25),
      ];
      tracker.update(features2);

      // Depth should be halved when scale doubles
      expect(tracker.getDepth()).toBeLessThan(2.0);
    });
  });

  describe("getDepthRatio", () => {
    it("should return 1.0 initially", () => {
      tracker.setInitialDepth(2.0);
      expect(tracker.getDepthRatio()).toBe(1.0);
    });
  });

  describe("getStablePairCount", () => {
    it("should return 0 before pairs reach minTrackedFrames", () => {
      const features: Feature[] = [
        createFeature("f1", 100, 100, 20),
        createFeature("f2", 200, 100, 20),
      ];
      tracker.update(features);
      expect(tracker.getStablePairCount()).toBe(0);
    });

    it("should count pairs after reaching minTrackedFrames", () => {
      const features: Feature[] = [
        createFeature("f1", 100, 100, 20),
        createFeature("f2", 200, 100, 20),
      ];

      for (let i = 0; i < 5; i++) {
        tracker.update(features);
      }

      expect(tracker.getStablePairCount()).toBeGreaterThan(0);
    });
  });

  describe("getStatistics", () => {
    it("should return all statistics", () => {
      tracker.setInitialDepth(2.0);
      const stats = tracker.getStatistics();

      expect(stats).toHaveProperty("scale");
      expect(stats).toHaveProperty("depth");
      expect(stats).toHaveProperty("depthRatio");
      expect(stats).toHaveProperty("trackedPairs");
      expect(stats).toHaveProperty("stablePairs");
    });
  });

  describe("reset", () => {
    it("should reset all tracking state", () => {
      tracker.setInitialDepth(2.0);
      const features: Feature[] = [
        createFeature("f1", 100, 100, 20),
        createFeature("f2", 200, 100, 20),
      ];
      tracker.update(features);

      tracker.reset();

      expect(tracker.getTrackedPairCount()).toBe(0);
      expect(tracker.getScale()).toBe(1.0);
      expect(tracker.getDepth()).toBe(2.0);
    });
  });

  describe("dispose", () => {
    it("should clear all pairs", () => {
      const features: Feature[] = [
        createFeature("f1", 100, 100, 20),
        createFeature("f2", 200, 100, 20),
      ];
      tracker.update(features);

      tracker.dispose();

      expect(tracker.getTrackedPairCount()).toBe(0);
    });
  });
});

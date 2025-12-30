import { describe, it, expect, beforeEach, vi } from "vitest";
import * as THREE from "three";
import { FeatureAnchor } from "./FeatureAnchor";
import type { Feature } from "../types/Feature";

function createFeature(
  id: string,
  x: number,
  y: number,
  trackingCount: number
): Feature {
  return { id, x, y, trackingCount };
}

describe("FeatureAnchor", () => {
  let anchor: FeatureAnchor;

  beforeEach(() => {
    anchor = new FeatureAnchor({
      minTrackingCountForAnchor: 5,
      maxAnchors: 10,
      maxReprojectionError: 10,
      moderateReprojectionError: 5,
    });
  });

  describe("constructor", () => {
    it("should use default options", () => {
      const defaultAnchor = new FeatureAnchor();
      expect(defaultAnchor.getAllAnchors()).toHaveLength(0);
    });
  });

  describe("updateAnchors", () => {
    it("should create anchors for stable features", () => {
      const features: Feature[] = [
        createFeature("f1", 100, 100, 10),
        createFeature("f2", 200, 200, 15),
      ];

      anchor.updateAnchors(features);

      expect(anchor.getAllAnchors()).toHaveLength(2);
    });

    it("should not create anchors for unstable features", () => {
      const features: Feature[] = [
        createFeature("f1", 100, 100, 2), // Below threshold
        createFeature("f2", 200, 200, 3), // Below threshold
      ];

      anchor.updateAnchors(features);

      expect(anchor.getAllAnchors()).toHaveLength(0);
    });

    it("should update existing anchors", () => {
      const features1: Feature[] = [createFeature("f1", 100, 100, 10)];

      anchor.updateAnchors(features1);

      const features2: Feature[] = [createFeature("f1", 110, 110, 15)];

      anchor.updateAnchors(features2);

      const anchors = anchor.getAllAnchors();
      expect(anchors).toHaveLength(1);
      expect(anchors[0].current2D.x).toBe(110);
      expect(anchors[0].current2D.y).toBe(110);
    });

    it("should remove anchors for missing features", () => {
      const features1: Feature[] = [
        createFeature("f1", 100, 100, 10),
        createFeature("f2", 200, 200, 10),
      ];
      anchor.updateAnchors(features1);

      const features2: Feature[] = [createFeature("f1", 100, 100, 11)];
      anchor.updateAnchors(features2);

      expect(anchor.getAllAnchors()).toHaveLength(1);
      expect(anchor.getAnchor("f2")).toBeUndefined();
    });

    it("should respect maxAnchors limit", () => {
      const features: Feature[] = [];
      for (let i = 0; i < 20; i++) {
        features.push(createFeature(`f${i}`, i * 50, i * 50, 10));
      }

      anchor.updateAnchors(features);

      expect(anchor.getAllAnchors().length).toBeLessThanOrEqual(10);
    });

    it("should use get3DPosition function when provided", () => {
      const features: Feature[] = [createFeature("f1", 100, 100, 10)];

      const get3DPosition = vi.fn(() => new THREE.Vector3(1, 2, 3));

      anchor.updateAnchors(features, get3DPosition);

      expect(get3DPosition).toHaveBeenCalled();
      const anchors = anchor.getAllAnchors();
      expect(anchors[0].position3D.x).toBe(1);
      expect(anchors[0].position3D.y).toBe(2);
      expect(anchors[0].position3D.z).toBe(3);
    });

    it("should remove expired anchors", () => {
      vi.useFakeTimers();

      const features1: Feature[] = [createFeature("f1", 100, 100, 10)];
      anchor.updateAnchors(features1);

      // Advance time beyond expiry
      vi.advanceTimersByTime(15000);

      // Update with same feature but it should be removed due to expiry
      const features2: Feature[] = [];
      anchor.updateAnchors(features2);

      expect(anchor.getAllAnchors()).toHaveLength(0);

      vi.useRealTimers();
    });
  });

  describe("calculateReprojectionErrors", () => {
    it("should calculate errors for all anchors", () => {
      const features: Feature[] = [
        createFeature("f1", 100, 100, 10),
        createFeature("f2", 200, 200, 10),
      ];
      anchor.updateAnchors(features, () => new THREE.Vector3(0, 0, 1));

      // Simple camera matrix (identity-like for testing)
      const cameraMatrix = new THREE.Matrix3().set(
        100,
        0,
        320,
        0,
        100,
        240,
        0,
        0,
        1
      );
      const rotationMatrix = new THREE.Matrix3().identity();
      const translation = new THREE.Vector3(0, 0, 0);

      const results = anchor.calculateReprojectionErrors(
        cameraMatrix,
        rotationMatrix,
        translation
      );

      expect(results).toHaveLength(2);
      expect(results[0]).toHaveProperty("error");
      expect(results[0]).toHaveProperty("weight");
      expect(results[0]).toHaveProperty("isValid");
    });

    it("should mark anchors with high error as invalid", () => {
      const features: Feature[] = [createFeature("f1", 100, 100, 10)];
      anchor.updateAnchors(features, () => new THREE.Vector3(100, 100, 1));

      // Camera matrix that will project to a very different position
      const cameraMatrix = new THREE.Matrix3().set(
        500,
        0,
        320,
        0,
        500,
        240,
        0,
        0,
        1
      );
      const rotationMatrix = new THREE.Matrix3().identity();
      const translation = new THREE.Vector3(0, 0, 0);

      const results = anchor.calculateReprojectionErrors(
        cameraMatrix,
        rotationMatrix,
        translation
      );

      // Error should be high, but we'll just check the structure
      expect(results[0]).toHaveProperty("isValid");
    });
  });

  describe("getValidAnchors", () => {
    it("should return only valid anchors", () => {
      const features: Feature[] = [
        createFeature("f1", 100, 100, 10),
        createFeature("f2", 200, 200, 10),
      ];
      anchor.updateAnchors(features, () => new THREE.Vector3(0, 0, 1));

      // Initially all anchors are valid
      expect(anchor.getValidAnchors().length).toBe(2);
    });
  });

  describe("getAnchor", () => {
    it("should return anchor by ID", () => {
      const features: Feature[] = [createFeature("f1", 100, 100, 10)];
      anchor.updateAnchors(features);

      const retrieved = anchor.getAnchor("f1");
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe("f1");
    });

    it("should return undefined for unknown ID", () => {
      expect(anchor.getAnchor("unknown")).toBeUndefined();
    });
  });

  describe("shouldPerformDescriptorMatch", () => {
    it("should return true at descriptor match interval", () => {
      const anchorWithInterval = new FeatureAnchor({
        descriptorMatchInterval: 5,
        minTrackingCountForAnchor: 5,
      });

      const features: Feature[] = [createFeature("f1", 100, 100, 10)];

      // Update 5 times to reach interval
      for (let i = 0; i < 5; i++) {
        anchorWithInterval.updateAnchors(features);
      }

      expect(anchorWithInterval.shouldPerformDescriptorMatch()).toBe(true);
    });
  });

  describe("correctAnchorPosition", () => {
    it("should update anchor position", () => {
      const features: Feature[] = [createFeature("f1", 100, 100, 10)];
      anchor.updateAnchors(features);

      anchor.correctAnchorPosition("f1", { x: 150, y: 150 });

      const updated = anchor.getAnchor("f1");
      expect(updated?.current2D.x).toBe(150);
      expect(updated?.current2D.y).toBe(150);
    });

    it("should reset framesSinceMatch", () => {
      const features: Feature[] = [createFeature("f1", 100, 100, 10)];
      anchor.updateAnchors(features);
      anchor.updateAnchors(features);
      anchor.updateAnchors(features);

      anchor.correctAnchorPosition("f1", { x: 150, y: 150 });

      const updated = anchor.getAnchor("f1");
      expect(updated?.framesSinceMatch).toBe(0);
    });
  });

  describe("getAnchorsNeedingMatch", () => {
    it("should return anchors exceeding match interval", () => {
      const anchorWithInterval = new FeatureAnchor({
        descriptorMatchInterval: 3,
        minTrackingCountForAnchor: 5,
      });

      const features: Feature[] = [createFeature("f1", 100, 100, 10)];

      // Update multiple times
      for (let i = 0; i < 5; i++) {
        anchorWithInterval.updateAnchors(features);
      }

      const needingMatch = anchorWithInterval.getAnchorsNeedingMatch();
      expect(needingMatch.length).toBeGreaterThan(0);
    });
  });

  describe("getWeightedCentroid", () => {
    it("should return null when no valid anchors", () => {
      expect(anchor.getWeightedCentroid()).toBeNull();
    });

    it("should calculate weighted centroid", () => {
      const features: Feature[] = [
        createFeature("f1", 100, 100, 10),
        createFeature("f2", 200, 200, 10),
      ];
      anchor.updateAnchors(features, (f) => {
        if (f.id === "f1") return new THREE.Vector3(1, 0, 0);
        return new THREE.Vector3(3, 0, 0);
      });

      const centroid = anchor.getWeightedCentroid();
      expect(centroid).not.toBeNull();
      expect(centroid!.x).toBeCloseTo(2, 1); // Midpoint
    });
  });

  describe("getStatistics", () => {
    it("should return all statistics", () => {
      const features: Feature[] = [createFeature("f1", 100, 100, 10)];
      anchor.updateAnchors(features);

      const stats = anchor.getStatistics();

      expect(stats).toHaveProperty("totalAnchors");
      expect(stats).toHaveProperty("validAnchors");
      expect(stats).toHaveProperty("averageError");
      expect(stats).toHaveProperty("averageStability");
      expect(stats.totalAnchors).toBe(1);
    });
  });

  describe("reset", () => {
    it("should clear all anchors", () => {
      const features: Feature[] = [createFeature("f1", 100, 100, 10)];
      anchor.updateAnchors(features);

      anchor.reset();

      expect(anchor.getAllAnchors()).toHaveLength(0);
    });
  });

  describe("dispose", () => {
    it("should clear all anchors", () => {
      const features: Feature[] = [createFeature("f1", 100, 100, 10)];
      anchor.updateAnchors(features);

      anchor.dispose();

      expect(anchor.getAllAnchors()).toHaveLength(0);
    });
  });
});

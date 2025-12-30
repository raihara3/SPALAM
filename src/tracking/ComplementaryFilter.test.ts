import { describe, it, expect, beforeEach, vi } from "vitest";
import * as THREE from "three";
import { ComplementaryFilter } from "./ComplementaryFilter";

describe("ComplementaryFilter", () => {
  let filter: ComplementaryFilter;

  beforeEach(() => {
    filter = new ComplementaryFilter();
  });

  describe("constructor", () => {
    it("should use default options", () => {
      expect(filter.getAlpha()).toBeCloseTo(0.98, 2);
    });

    it("should accept custom options", () => {
      const customFilter = new ComplementaryFilter({
        alpha: 0.9,
        minVisualConfidence: 0.5,
        smoothingFactor: 0.2,
      });
      expect(customFilter.getAlpha()).toBeCloseTo(0.9, 2);
    });
  });

  describe("fuse", () => {
    it("should return IMU orientation when visual is null", () => {
      const imuOrientation = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.1, 0.2, 0.3)
      );

      const result = filter.fuse(imuOrientation, null, 0);

      expect(result.x).toBeCloseTo(imuOrientation.x, 5);
      expect(result.y).toBeCloseTo(imuOrientation.y, 5);
      expect(result.z).toBeCloseTo(imuOrientation.z, 5);
      expect(result.w).toBeCloseTo(imuOrientation.w, 5);
    });

    it("should return IMU orientation when visual confidence is low", () => {
      const imuOrientation = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.1, 0.2, 0.3)
      );
      const visualOrientation = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.5, 0.6, 0.7)
      );

      const result = filter.fuse(imuOrientation, visualOrientation, 0.1);

      // Should be close to IMU since visual confidence is below threshold (0.3)
      expect(result.x).toBeCloseTo(imuOrientation.x, 5);
    });

    it("should blend orientations when visual confidence is high", () => {
      const imuOrientation = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, 0, 0)
      );
      const visualOrientation = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.5, 0, 0)
      );

      const result = filter.fuse(imuOrientation, visualOrientation, 0.8);

      // Result should be somewhere between IMU and visual
      // Not exactly at either endpoint due to SLERP
      expect(Math.abs(result.x)).toBeGreaterThan(0);
    });

    it("should apply smoothing across frames", () => {
      const orientation1 = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, 0, 0)
      );
      const orientation2 = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.5, 0, 0)
      );

      filter.fuse(orientation1, null, 0);
      const result2 = filter.fuse(orientation2, null, 0);

      // Due to smoothing, result2 should not equal orientation2 exactly
      expect(result2.x).not.toBeCloseTo(orientation2.x, 5);
    });
  });

  describe("updateAlpha", () => {
    it("should decrease alpha with high visual confidence", () => {
      const initialAlpha = filter.getAlpha();
      filter.updateAlpha(1.0);
      expect(filter.getAlpha()).toBeLessThan(initialAlpha);
    });

    it("should keep alpha high with low visual confidence", () => {
      filter.updateAlpha(0.0);
      expect(filter.getAlpha()).toBeGreaterThan(0.9);
    });

    it("should clamp alpha within valid range", () => {
      filter.updateAlpha(1.0);
      expect(filter.getAlpha()).toBeGreaterThanOrEqual(0.5);
      expect(filter.getAlpha()).toBeLessThanOrEqual(0.99);
    });
  });

  describe("resetToVisual", () => {
    it("should reset to visual orientation", () => {
      const initialOrientation = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.1, 0.2, 0.3)
      );
      filter.fuse(initialOrientation, null, 0);

      const visualOrientation = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.5, 0.6, 0.7)
      );
      filter.resetToVisual(visualOrientation);

      const result = filter.fuse(visualOrientation, null, 0);
      expect(result.x).toBeCloseTo(visualOrientation.x, 5);
    });
  });

  describe("isVisualStale", () => {
    it("should return true when no visual update received", () => {
      expect(filter.isVisualStale()).toBe(true);
    });

    it("should return false immediately after visual update", () => {
      const imuOrientation = new THREE.Quaternion();
      const visualOrientation = new THREE.Quaternion();

      filter.fuse(imuOrientation, visualOrientation, 0.8);

      expect(filter.isVisualStale(100)).toBe(false);
    });

    it("should return true after threshold time", () => {
      vi.useFakeTimers();

      const imuOrientation = new THREE.Quaternion();
      const visualOrientation = new THREE.Quaternion();

      filter.fuse(imuOrientation, visualOrientation, 0.8);

      // Advance time beyond threshold
      vi.advanceTimersByTime(2000);

      expect(filter.isVisualStale(1000)).toBe(true);

      vi.useRealTimers();
    });
  });

  describe("getTimeSinceLastVisualUpdate", () => {
    it("should return Infinity when no visual update received", () => {
      expect(filter.getTimeSinceLastVisualUpdate()).toBe(Infinity);
    });

    it("should return approximate time since last update", () => {
      vi.useFakeTimers();
      const imuOrientation = new THREE.Quaternion();
      const visualOrientation = new THREE.Quaternion();

      filter.fuse(imuOrientation, visualOrientation, 0.8);

      vi.advanceTimersByTime(100);

      expect(filter.getTimeSinceLastVisualUpdate()).toBeCloseTo(100, -1);

      vi.useRealTimers();
    });
  });

  describe("reset", () => {
    it("should reset all state", () => {
      const imuOrientation = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.1, 0.2, 0.3)
      );
      const visualOrientation = new THREE.Quaternion();

      filter.fuse(imuOrientation, visualOrientation, 0.8);
      filter.updateAlpha(1.0);

      filter.reset();

      expect(filter.getAlpha()).toBeCloseTo(0.98, 2);
      expect(filter.getTimeSinceLastVisualUpdate()).toBe(Infinity);
    });
  });

  describe("dispose", () => {
    it("should reset state on dispose", () => {
      const imuOrientation = new THREE.Quaternion();
      filter.fuse(imuOrientation, null, 0);

      filter.dispose();

      expect(filter.getTimeSinceLastVisualUpdate()).toBe(Infinity);
    });
  });
});

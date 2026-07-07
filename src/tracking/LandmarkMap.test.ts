/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { LandmarkMap } from "./LandmarkMap";
import type { Feature } from "../types/Feature";

describe("LandmarkMap", () => {
  let map: LandmarkMap;

  const createFeature = (id: string, x: number, y: number): Feature => ({
    id,
    x,
    y,
    trackingCount: 10,
  });

  beforeEach(() => {
    map = new LandmarkMap();
  });

  describe("addLandmark", () => {
    it("should add a landmark and clone its position", () => {
      const position = new THREE.Vector3(1, 2, 3);
      expect(map.addLandmark("a", position)).toBe(true);

      position.x = 99;
      expect(map.getLandmark("a")!.position.x).toBe(1);
    });

    it("should reject duplicate IDs", () => {
      map.addLandmark("a", new THREE.Vector3());
      expect(map.addLandmark("a", new THREE.Vector3())).toBe(false);
      expect(map.size()).toBe(1);
    });

    it("should reject additions beyond maxLandmarks", () => {
      const smallMap = new LandmarkMap({ maxLandmarks: 2 });
      expect(smallMap.addLandmark("a", new THREE.Vector3())).toBe(true);
      expect(smallMap.addLandmark("b", new THREE.Vector3())).toBe(true);
      expect(smallMap.addLandmark("c", new THREE.Vector3())).toBe(false);
    });
  });

  describe("recordObservation", () => {
    it("should track observation counts and frames", () => {
      map.addLandmark("a", new THREE.Vector3());
      map.beginFrame();
      map.beginFrame();

      expect(map.recordObservation("a", 1.5)).toBe(true);

      const landmark = map.getLandmark("a")!;
      expect(landmark.observationCount).toBe(2);
      expect(landmark.lastObservedFrame).toBe(2);
      // EMA from 0 with the default alpha 0.3: 1.5 * 0.3 = 0.45
      expect(landmark.averageReprojectionError).toBeCloseTo(0.45, 10);
    });

    it("should smooth reprojection errors with an EMA starting from zero", () => {
      const smoothedMap = new LandmarkMap({ errorSmoothingAlpha: 0.5 });
      smoothedMap.addLandmark("a", new THREE.Vector3());
      smoothedMap.recordObservation("a", 2); // 0 * 0.5 + 2 * 0.5 = 1
      smoothedMap.recordObservation("a", 4); // 1 * 0.5 + 4 * 0.5 = 2.5

      expect(smoothedMap.getLandmark("a")!.averageReprojectionError).toBe(2.5);
    });

    it("should return false for unknown IDs", () => {
      expect(map.recordObservation("missing", 1)).toBe(false);
    });
  });

  describe("cull", () => {
    it("should remove landmarks with high reprojection error", () => {
      const strictMap = new LandmarkMap({ maxReprojectionError: 2 });
      strictMap.addLandmark("good", new THREE.Vector3());
      strictMap.addLandmark("bad", new THREE.Vector3());
      strictMap.recordObservation("good", 1);
      strictMap.recordObservation("bad", 50);

      expect(strictMap.cull()).toBe(1);
      expect(strictMap.getLandmark("good")).not.toBeNull();
      expect(strictMap.getLandmark("bad")).toBeNull();
    });

    it("should remove landmarks unobserved for too long", () => {
      const staleMap = new LandmarkMap({ maxUnobservedFrames: 3 });
      staleMap.addLandmark("stale", new THREE.Vector3());
      for (let i = 0; i < 5; i++) {
        staleMap.beginFrame();
        // keep the observation ratio healthy so only staleness triggers
        staleMap.recordObservation("stale", 0.5);
      }
      staleMap.addLandmark("fresh", new THREE.Vector3());

      for (let i = 0; i < 4; i++) {
        staleMap.beginFrame();
        staleMap.recordObservation("fresh", 0.5);
      }

      expect(staleMap.cull()).toBe(1);
      expect(staleMap.getLandmark("stale")).toBeNull();
      expect(staleMap.getLandmark("fresh")).not.toBeNull();
    });

    it("should remove rarely observed landmarks after the grace period", () => {
      const ratioMap = new LandmarkMap({
        minObservationRatio: 0.5,
        minFramesBeforeCulling: 4,
        maxUnobservedFrames: 100,
      });
      ratioMap.addLandmark("rare", new THREE.Vector3());
      ratioMap.addLandmark("frequent", new THREE.Vector3());

      for (let i = 0; i < 6; i++) {
        ratioMap.beginFrame();
        ratioMap.recordObservation("frequent", 0.5);
        if (i === 0) {
          ratioMap.recordObservation("rare", 0.5);
        }
      }

      expect(ratioMap.cull()).toBe(1);
      expect(ratioMap.getLandmark("rare")).toBeNull();
      expect(ratioMap.getLandmark("frequent")).not.toBeNull();
    });

    it("should not cull young landmarks by observation ratio", () => {
      const ratioMap = new LandmarkMap({
        minObservationRatio: 0.9,
        minFramesBeforeCulling: 10,
      });
      ratioMap.addLandmark("young", new THREE.Vector3());
      ratioMap.beginFrame();
      ratioMap.beginFrame();

      expect(ratioMap.cull()).toBe(0);
    });
  });

  describe("getCorrespondences", () => {
    it("should join features with landmarks by ID", () => {
      map.addLandmark("a", new THREE.Vector3(1, 2, 3));
      map.addLandmark("b", new THREE.Vector3(4, 5, 6));

      const correspondences = map.getCorrespondences([
        createFeature("a", 100, 200),
        createFeature("unknown", 0, 0),
        createFeature("b", 300, 400),
      ]);

      expect(correspondences).toHaveLength(2);
      expect(correspondences[0].id).toBe("a");
      expect(correspondences[0].point2D).toEqual({ x: 100, y: 200 });
      expect(correspondences[0].point3D.z).toBe(3);
      expect(correspondences[1].id).toBe("b");
    });
  });

  describe("updatePosition", () => {
    it("should update an existing landmark position", () => {
      map.addLandmark("a", new THREE.Vector3(0, 0, 0));

      expect(map.updatePosition("a", new THREE.Vector3(7, 8, 9))).toBe(true);
      expect(map.getLandmark("a")!.position.z).toBe(9);
    });

    it("should return false for unknown IDs", () => {
      expect(map.updatePosition("missing", new THREE.Vector3())).toBe(false);
    });
  });

  describe("statistics and clear", () => {
    it("should aggregate statistics", () => {
      map.addLandmark("a", new THREE.Vector3());
      map.addLandmark("b", new THREE.Vector3());
      map.beginFrame();
      map.recordObservation("a", 2);

      const statistics = map.getStatistics();
      expect(statistics.landmarkCount).toBe(2);
      expect(statistics.currentFrame).toBe(1);
      // Landmark "a": EMA 2 * 0.3 = 0.6, landmark "b": 0 -> average 0.3
      expect(statistics.averageReprojectionError).toBeCloseTo(0.3, 10);
      expect(statistics.averageObservationCount).toBe(1.5);
    });

    it("should clear all landmarks and the frame counter", () => {
      map.addLandmark("a", new THREE.Vector3());
      map.beginFrame();

      map.clear();

      expect(map.size()).toBe(0);
      expect(map.getCurrentFrame()).toBe(0);
    });
  });
});

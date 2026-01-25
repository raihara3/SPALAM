/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { IMUPreintegration } from "./IMUPreintegration";
import type { IMUMeasurement, IMUBiases } from "../types/Pose";

describe("IMUPreintegration", () => {
  let preintegration: IMUPreintegration;

  beforeEach(() => {
    preintegration = new IMUPreintegration();
  });

  describe("constructor", () => {
    it("should initialize with default options", () => {
      expect(preintegration.getIntegrationTime()).toBe(0);
      expect(preintegration.getMeasurementCount()).toBe(0);
      expect(preintegration.getGravityMagnitude()).toBeCloseTo(9.80665);
    });

    it("should initialize with custom options", () => {
      const customPreintegration = new IMUPreintegration(undefined, {
        gravityMagnitude: 9.81,
        accelerometerNoiseDensity: 0.02,
        gyroscopeNoiseDensity: 0.002,
      });
      expect(customPreintegration.getGravityMagnitude()).toBeCloseTo(9.81);
    });

    it("should initialize with custom biases", () => {
      const biases: IMUBiases = {
        accelerometerBias: new THREE.Vector3(0.1, 0.2, 0.3),
        gyroscopeBias: new THREE.Vector3(0.01, 0.02, 0.03),
      };
      const customPreintegration = new IMUPreintegration(biases);
      const resultBiases = customPreintegration.getBiases();

      expect(resultBiases.accelerometerBias.x).toBeCloseTo(0.1);
      expect(resultBiases.accelerometerBias.y).toBeCloseTo(0.2);
      expect(resultBiases.gyroscopeBias.z).toBeCloseTo(0.03);
    });
  });

  describe("integrate", () => {
    it("should skip first measurement (used for timestamp initialization)", () => {
      const measurement: IMUMeasurement = {
        acceleration: new THREE.Vector3(0, 0, 9.8),
        angularVelocity: new THREE.Vector3(0, 0, 0),
        timestamp: 1000,
      };

      preintegration.integrate(measurement);

      expect(preintegration.getMeasurementCount()).toBe(1);
      expect(preintegration.getIntegrationTime()).toBe(0);
    });

    it("should integrate multiple measurements", () => {
      const measurements: IMUMeasurement[] = [
        {
          acceleration: new THREE.Vector3(0, 0, 9.8),
          angularVelocity: new THREE.Vector3(0, 0, 0),
          timestamp: 1000,
        },
        {
          acceleration: new THREE.Vector3(0, 0, 9.8),
          angularVelocity: new THREE.Vector3(0, 0, 0),
          timestamp: 1010,
        },
        {
          acceleration: new THREE.Vector3(0, 0, 9.8),
          angularVelocity: new THREE.Vector3(0, 0, 0),
          timestamp: 1020,
        },
      ];

      for (const m of measurements) {
        preintegration.integrate(m);
      }

      expect(preintegration.getMeasurementCount()).toBe(3);
      expect(preintegration.getIntegrationTime()).toBeCloseTo(0.02);
    });

    it("should skip invalid time gaps", () => {
      const measurement1: IMUMeasurement = {
        acceleration: new THREE.Vector3(0, 0, 9.8),
        angularVelocity: new THREE.Vector3(0, 0, 0),
        timestamp: 1000,
      };
      const measurement2: IMUMeasurement = {
        acceleration: new THREE.Vector3(0, 0, 9.8),
        angularVelocity: new THREE.Vector3(0, 0, 0),
        timestamp: 2000, // 1 second gap - too large
      };

      preintegration.integrate(measurement1);
      preintegration.integrate(measurement2);

      expect(preintegration.getIntegrationTime()).toBe(0);
    });

    it("should update delta position with constant acceleration", () => {
      // 10 measurements at 10ms intervals with constant acceleration
      const acceleration = new THREE.Vector3(1, 0, 0); // 1 m/s² in x direction

      for (let i = 0; i < 10; i++) {
        preintegration.integrate({
          acceleration,
          angularVelocity: new THREE.Vector3(0, 0, 0),
          timestamp: 1000 + i * 10,
        });
      }

      const result = preintegration.getPreintegration();

      // After 0.09s with 1 m/s² acceleration:
      // Position should be approximately 0.5 * a * t² = 0.5 * 1 * 0.09² ≈ 0.00405
      // Velocity should be approximately a * t = 1 * 0.09 = 0.09
      expect(result.deltaVelocity.x).toBeGreaterThan(0);
      expect(result.deltaPosition.x).toBeGreaterThan(0);
    });

    it("should update delta rotation with angular velocity", () => {
      const angularVelocity = new THREE.Vector3(0, 0, 0.1); // rotation around z-axis

      for (let i = 0; i < 10; i++) {
        preintegration.integrate({
          acceleration: new THREE.Vector3(0, 0, 0),
          angularVelocity,
          timestamp: 1000 + i * 10,
        });
      }

      const result = preintegration.getPreintegration();

      // Should have some rotation around z-axis
      expect(result.deltaRotation.w).toBeLessThan(1);
    });
  });

  describe("getPreintegration", () => {
    it("should return preintegration result", () => {
      const measurement: IMUMeasurement = {
        acceleration: new THREE.Vector3(0, 0, 9.8),
        angularVelocity: new THREE.Vector3(0, 0, 0),
        timestamp: 1000,
      };
      preintegration.integrate(measurement);

      const result = preintegration.getPreintegration();

      expect(result).toHaveProperty("deltaPosition");
      expect(result).toHaveProperty("deltaVelocity");
      expect(result).toHaveProperty("deltaRotation");
      expect(result).toHaveProperty("covariance");
      expect(result).toHaveProperty("integrationTime");
      expect(result).toHaveProperty("measurementCount");
    });

    it("should return cloned vectors", () => {
      const result1 = preintegration.getPreintegration();
      const result2 = preintegration.getPreintegration();

      result1.deltaPosition.x = 100;
      expect(result2.deltaPosition.x).not.toBe(100);
    });
  });

  describe("correctByBias", () => {
    it("should correct preintegration for new biases", () => {
      // Integrate some measurements
      for (let i = 0; i < 10; i++) {
        preintegration.integrate({
          acceleration: new THREE.Vector3(1, 0, 9.8),
          angularVelocity: new THREE.Vector3(0, 0.1, 0),
          timestamp: 1000 + i * 10,
        });
      }

      const originalResult = preintegration.getPreintegration();
      const newBiases: IMUBiases = {
        accelerometerBias: new THREE.Vector3(0.1, 0.1, 0.1),
        gyroscopeBias: new THREE.Vector3(0.01, 0.01, 0.01),
      };

      const correctedResult = preintegration.correctByBias(newBiases);

      // Results should be different after bias correction
      expect(correctedResult.deltaPosition).not.toEqual(originalResult.deltaPosition);
    });

    it("should preserve integration time and measurement count", () => {
      for (let i = 0; i < 5; i++) {
        preintegration.integrate({
          acceleration: new THREE.Vector3(0, 0, 9.8),
          angularVelocity: new THREE.Vector3(0, 0, 0),
          timestamp: 1000 + i * 10,
        });
      }

      const newBiases: IMUBiases = {
        accelerometerBias: new THREE.Vector3(0.1, 0, 0),
        gyroscopeBias: new THREE.Vector3(0, 0, 0),
      };

      const correctedResult = preintegration.correctByBias(newBiases);

      expect(correctedResult.integrationTime).toBe(preintegration.getIntegrationTime());
      expect(correctedResult.measurementCount).toBe(preintegration.getMeasurementCount());
    });
  });

  describe("updateBiases", () => {
    it("should update biases", () => {
      const newBiases: IMUBiases = {
        accelerometerBias: new THREE.Vector3(0.5, 0.5, 0.5),
        gyroscopeBias: new THREE.Vector3(0.05, 0.05, 0.05),
      };

      preintegration.updateBiases(newBiases);
      const resultBiases = preintegration.getBiases();

      expect(resultBiases.accelerometerBias.x).toBeCloseTo(0.5);
      expect(resultBiases.gyroscopeBias.x).toBeCloseTo(0.05);
    });

    it("should clone input biases", () => {
      const newBiases: IMUBiases = {
        accelerometerBias: new THREE.Vector3(0.5, 0.5, 0.5),
        gyroscopeBias: new THREE.Vector3(0.05, 0.05, 0.05),
      };

      preintegration.updateBiases(newBiases);
      newBiases.accelerometerBias.x = 100;

      const resultBiases = preintegration.getBiases();
      expect(resultBiases.accelerometerBias.x).toBeCloseTo(0.5);
    });
  });

  describe("hasEnoughData", () => {
    it("should return false when not enough measurements", () => {
      expect(preintegration.hasEnoughData()).toBe(false);
      expect(preintegration.hasEnoughData(5)).toBe(false);
    });

    it("should return true when enough measurements", () => {
      for (let i = 0; i < 10; i++) {
        preintegration.integrate({
          acceleration: new THREE.Vector3(0, 0, 9.8),
          angularVelocity: new THREE.Vector3(0, 0, 0),
          timestamp: 1000 + i * 10,
        });
      }

      expect(preintegration.hasEnoughData()).toBe(true);
      expect(preintegration.hasEnoughData(10)).toBe(true);
      expect(preintegration.hasEnoughData(15)).toBe(false);
    });
  });

  describe("getCovarianceDiagonal", () => {
    it("should return covariance diagonal", () => {
      for (let i = 0; i < 10; i++) {
        preintegration.integrate({
          acceleration: new THREE.Vector3(0, 0, 9.8),
          angularVelocity: new THREE.Vector3(0, 0, 0),
          timestamp: 1000 + i * 10,
        });
      }

      const diagonal = preintegration.getCovarianceDiagonal();

      expect(diagonal).toHaveProperty("position");
      expect(diagonal).toHaveProperty("velocity");
      expect(diagonal).toHaveProperty("rotation");
      expect(diagonal.position).toBeInstanceOf(THREE.Vector3);
      expect(diagonal.velocity).toBeInstanceOf(THREE.Vector3);
      expect(diagonal.rotation).toBeInstanceOf(THREE.Vector3);
    });

    it("should increase covariance with more measurements", () => {
      for (let i = 0; i < 5; i++) {
        preintegration.integrate({
          acceleration: new THREE.Vector3(0, 0, 9.8),
          angularVelocity: new THREE.Vector3(0, 0, 0),
          timestamp: 1000 + i * 10,
        });
      }

      const diagonal1 = preintegration.getCovarianceDiagonal();

      for (let i = 5; i < 10; i++) {
        preintegration.integrate({
          acceleration: new THREE.Vector3(0, 0, 9.8),
          angularVelocity: new THREE.Vector3(0, 0, 0),
          timestamp: 1000 + i * 10,
        });
      }

      const diagonal2 = preintegration.getCovarianceDiagonal();

      // Covariance should increase over time
      expect(diagonal2.position.length()).toBeGreaterThanOrEqual(diagonal1.position.length());
    });
  });

  describe("reset", () => {
    it("should reset all state", () => {
      for (let i = 0; i < 10; i++) {
        preintegration.integrate({
          acceleration: new THREE.Vector3(1, 0, 9.8),
          angularVelocity: new THREE.Vector3(0, 0.1, 0),
          timestamp: 1000 + i * 10,
        });
      }

      preintegration.reset();

      expect(preintegration.getIntegrationTime()).toBe(0);
      expect(preintegration.getMeasurementCount()).toBe(0);

      const result = preintegration.getPreintegration();
      expect(result.deltaPosition.length()).toBe(0);
      expect(result.deltaVelocity.length()).toBe(0);
      expect(result.deltaRotation.w).toBe(1);
    });

    it("should accept new biases on reset", () => {
      const newBiases: IMUBiases = {
        accelerometerBias: new THREE.Vector3(0.3, 0.3, 0.3),
        gyroscopeBias: new THREE.Vector3(0.03, 0.03, 0.03),
      };

      preintegration.reset(newBiases);
      const resultBiases = preintegration.getBiases();

      expect(resultBiases.accelerometerBias.x).toBeCloseTo(0.3);
      expect(resultBiases.gyroscopeBias.x).toBeCloseTo(0.03);
    });
  });

  describe("dispose", () => {
    it("should reset state on dispose", () => {
      for (let i = 0; i < 10; i++) {
        preintegration.integrate({
          acceleration: new THREE.Vector3(1, 0, 9.8),
          angularVelocity: new THREE.Vector3(0, 0.1, 0),
          timestamp: 1000 + i * 10,
        });
      }

      preintegration.dispose();

      expect(preintegration.getMeasurementCount()).toBe(0);
    });
  });

  describe("noise parameters", () => {
    it("should return noise parameters", () => {
      const noiseParams = preintegration.getNoiseParameters();

      expect(noiseParams.accelerometerNoiseDensity).toBeCloseTo(0.01);
      expect(noiseParams.gyroscopeNoiseDensity).toBeCloseTo(0.001);
      expect(noiseParams.accelerometerRandomWalk).toBeCloseTo(0.0001);
      expect(noiseParams.gyroscopeRandomWalk).toBeCloseTo(0.00001);
    });
  });
});

/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TrackingStateMachine } from "./TrackingStateMachine";

describe("TrackingStateMachine", () => {
  let machine: TrackingStateMachine;

  beforeEach(() => {
    machine = new TrackingStateMachine();
  });

  describe("initial state", () => {
    it("should start uninitialized", () => {
      expect(machine.getState()).toBe("uninitialized");
    });
  });

  describe("transition", () => {
    it("should accept a valid transition", () => {
      expect(machine.transition("initializing", "start")).toBe(true);
      expect(machine.getState()).toBe("initializing");
    });

    it("should reject an invalid transition", () => {
      expect(machine.transition("tracking", "skip initialization")).toBe(
        false
      );
      expect(machine.getState()).toBe("uninitialized");
    });

    it("should accept a transition to the current state as no-op", () => {
      machine.transition("initializing", "start");
      expect(machine.transition("initializing", "again")).toBe(true);
      expect(machine.getHistory()).toHaveLength(1);
    });

    it("should follow the nominal lifecycle", () => {
      expect(machine.transition("initializing", "start")).toBe(true);
      expect(machine.transition("tracking", "plane detected")).toBe(true);
      expect(machine.transition("degraded", "few features")).toBe(true);
      expect(machine.transition("tracking", "features recovered")).toBe(true);
      expect(machine.transition("lost", "features lost")).toBe(true);
      expect(machine.transition("relocalizing", "redetection")).toBe(true);
      expect(machine.transition("tracking", "relocalized")).toBe(true);
    });

    it("should allow freezing from tracking and degraded but not from lost", () => {
      machine.transition("initializing", "start");
      machine.transition("tracking", "plane detected");
      expect(machine.transition("frozen", "feature drought")).toBe(true);
      expect(machine.transition("tracking", "features recovered")).toBe(true);
      machine.transition("lost", "features lost");
      expect(machine.transition("frozen", "invalid")).toBe(false);
    });
  });

  describe("listeners", () => {
    it("should notify listeners on accepted transitions", () => {
      const listener = vi.fn();
      machine.addListener(listener);

      machine.transition("initializing", "start");

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          previousState: "uninitialized",
          currentState: "initializing",
          reason: "start",
        })
      );
    });

    it("should not notify listeners on rejected transitions", () => {
      const listener = vi.fn();
      machine.addListener(listener);

      machine.transition("tracking", "invalid");

      expect(listener).not.toHaveBeenCalled();
    });

    it("should stop notifying removed listeners", () => {
      const listener = vi.fn();
      machine.addListener(listener);
      machine.removeListener(listener);

      machine.transition("initializing", "start");

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("history", () => {
    it("should record transitions oldest first", () => {
      machine.transition("initializing", "start");
      machine.transition("tracking", "plane detected");

      const history = machine.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].currentState).toBe("initializing");
      expect(history[1].currentState).toBe("tracking");
    });

    it("should cap history at maxHistorySize", () => {
      const smallMachine = new TrackingStateMachine({ maxHistorySize: 2 });
      smallMachine.transition("initializing", "start");
      smallMachine.transition("tracking", "plane detected");
      smallMachine.transition("degraded", "few features");

      const history = smallMachine.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].currentState).toBe("tracking");
    });
  });

  describe("getTimeInState", () => {
    it("should measure elapsed time since the last transition", () => {
      const nowSpy = vi.spyOn(performance, "now");
      nowSpy.mockReturnValue(1000);
      machine.transition("initializing", "start");

      expect(machine.getTimeInState(1250)).toBe(250);
      nowSpy.mockRestore();
    });
  });

  describe("reset", () => {
    it("should return to uninitialized from any state", () => {
      machine.transition("initializing", "start");
      machine.transition("tracking", "plane detected");

      machine.reset();

      expect(machine.getState()).toBe("uninitialized");
      expect(machine.getHistory().at(-1)?.reason).toBe("reset");
    });

    it("should be a no-op when already uninitialized", () => {
      machine.reset();
      expect(machine.getHistory()).toHaveLength(0);
    });
  });
});

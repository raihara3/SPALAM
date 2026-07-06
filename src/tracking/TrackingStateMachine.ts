/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TrackingState } from "../types/Pose";

/**
 * A single tracking state transition
 */
export interface TrackingStateTransition {
  /** State before the transition */
  previousState: TrackingState;
  /** State after the transition */
  currentState: TrackingState;
  /** Human-readable reason for the transition */
  reason: string;
  /** Timestamp in the performance.now() domain (ms) */
  timestamp: number;
}

/**
 * Listener invoked on every accepted transition
 */
export type TrackingStateListener = (
  transition: TrackingStateTransition
) => void;

/**
 * Tracking State Machine Options
 */
export interface TrackingStateMachineOptions {
  /** Maximum number of transitions kept in history. Default: 50 */
  maxHistorySize?: number;
}

/**
 * Allowed transitions per state.
 *
 * - uninitialized: nothing has started yet
 * - initializing:  waiting for plane detection / map bootstrap
 * - tracking:      nominal visual tracking
 * - degraded:      tracking continues with reduced visual quality
 * - frozen:        pose updates suspended (e.g. feature drought locks the plane)
 * - lost:          visual tracking lost, no recovery in progress
 * - relocalizing:  recovery (redetection / relocalization) in progress
 */
const ALLOWED_TRANSITIONS: Record<TrackingState, readonly TrackingState[]> = {
  uninitialized: ["initializing"],
  initializing: ["tracking", "lost", "uninitialized"],
  tracking: ["degraded", "frozen", "lost", "relocalizing", "uninitialized"],
  degraded: ["tracking", "frozen", "lost", "relocalizing", "uninitialized"],
  frozen: ["tracking", "degraded", "lost", "relocalizing", "uninitialized"],
  lost: ["relocalizing", "tracking", "degraded", "initializing", "uninitialized"],
  relocalizing: ["tracking", "degraded", "lost", "uninitialized"],
};

/**
 * Tracking State Machine
 *
 * Holds the explicit tracking state of the SLAM pipeline and enforces
 * valid transitions between states. Every recovery behavior (redetection,
 * relocalization, pose freezing) is keyed off this state so that the
 * per-frame logic never has to infer the situation from scattered flags.
 */
export class TrackingStateMachine {
  private currentState: TrackingState = "uninitialized";
  private stateEnteredAt: number = performance.now();
  private readonly listeners: Set<TrackingStateListener> = new Set();
  private readonly history: TrackingStateTransition[] = [];
  private readonly maxHistorySize: number;

  constructor(options?: TrackingStateMachineOptions) {
    this.maxHistorySize = options?.maxHistorySize ?? 50;
  }

  /**
   * Get the current tracking state
   */
  public getState(): TrackingState {
    return this.currentState;
  }

  /**
   * Check whether a transition to the given state is allowed
   */
  public canTransition(nextState: TrackingState): boolean {
    if (nextState === this.currentState) {
      return true;
    }
    return ALLOWED_TRANSITIONS[this.currentState].includes(nextState);
  }

  /**
   * Attempt a transition to the given state
   *
   * Transitions to the current state are accepted as no-ops.
   *
   * @param nextState Target state
   * @param reason Human-readable reason (kept in history)
   * @returns true if the transition was accepted
   */
  public transition(nextState: TrackingState, reason: string): boolean {
    if (nextState === this.currentState) {
      return true;
    }
    if (!ALLOWED_TRANSITIONS[this.currentState].includes(nextState)) {
      return false;
    }

    const transition: TrackingStateTransition = {
      previousState: this.currentState,
      currentState: nextState,
      reason,
      timestamp: performance.now(),
    };

    this.currentState = nextState;
    this.stateEnteredAt = transition.timestamp;

    this.history.push(transition);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    this.listeners.forEach((listener) => {
      try {
        listener(transition);
      } catch (error) {
        console.error("Error in tracking state listener:", error);
      }
    });

    return true;
  }

  /**
   * Get elapsed time in the current state (ms)
   */
  public getTimeInState(now: number = performance.now()): number {
    return now - this.stateEnteredAt;
  }

  /**
   * Get the transition history (oldest first)
   */
  public getHistory(): readonly TrackingStateTransition[] {
    return this.history;
  }

  /**
   * Add a transition listener
   */
  public addListener(listener: TrackingStateListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove a transition listener
   */
  public removeListener(listener: TrackingStateListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Reset to the uninitialized state
   *
   * Reset is always allowed and is recorded in the history.
   */
  public reset(): void {
    if (this.currentState === "uninitialized") {
      return;
    }
    const transition: TrackingStateTransition = {
      previousState: this.currentState,
      currentState: "uninitialized",
      reason: "reset",
      timestamp: performance.now(),
    };
    this.currentState = "uninitialized";
    this.stateEnteredAt = transition.timestamp;
    this.history.push(transition);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
    this.listeners.forEach((listener) => {
      try {
        listener(transition);
      } catch (error) {
        console.error("Error in tracking state listener:", error);
      }
    });
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.listeners.clear();
    this.history.length = 0;
  }
}

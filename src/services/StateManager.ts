import * as THREE from "three";
import {
  SPALAMState,
  type StateChangeEvent,
  type StateChangeListener,
  type PlaneFittingResult,
} from "../types/State";

export { SPALAMState } from "../types/State";
export type { StateChangeEvent, StateChangeListener } from "../types/State";

/**
 * 状態管理クラス
 * SPALAMの状態を管理し、状態遷移を制御
 */
export class StateManager {
  private currentState: SPALAMState = SPALAMState.IDLE;
  private listeners: Set<StateChangeListener> = new Set();
  private stateData: Map<SPALAMState, unknown> = new Map();
  private stateHistory: StateChangeEvent[] = [];
  private maxHistorySize: number = 100;

  // 平面検出関連の状態
  private planeDetected: boolean = false;
  private planeResult: PlaneFittingResult | null = null;
  private planeGroup: THREE.Group | null = null;

  constructor() {}

  /**
   * 現在の状態を取得
   */
  public getState(): SPALAMState {
    return this.currentState;
  }

  /**
   * 状態を変更
   */
  public setState(newState: SPALAMState, data?: unknown): void {
    if (this.currentState === newState) return;

    const previousState = this.currentState;
    this.currentState = newState;

    if (data !== undefined) {
      this.stateData.set(newState, data);
    }

    const event: StateChangeEvent = {
      previousState,
      currentState: newState,
      timestamp: Date.now(),
      data,
    };

    // 履歴に追加
    this.stateHistory.push(event);
    if (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory.shift();
    }

    // リスナーに通知
    this.notifyListeners(event);
  }

  /**
   * 状態変更リスナーを追加
   */
  public addListener(listener: StateChangeListener): void {
    this.listeners.add(listener);
  }

  /**
   * 状態変更リスナーを削除
   */
  public removeListener(listener: StateChangeListener): void {
    this.listeners.delete(listener);
  }

  /**
   * 平面検出状態を設定
   */
  public setPlaneDetected(
    detected: boolean,
    result?: PlaneFittingResult
  ): void {
    this.planeDetected = detected;
    if (result) {
      this.planeResult = result;
    }

    if (detected) {
      this.setState(SPALAMState.PLANE_DETECTED, { result });
    }
  }

  /**
   * 平面が検出されているかチェック
   */
  public isPlaneDetected(): boolean {
    return this.planeDetected;
  }

  /**
   * 平面検出結果を取得
   */
  public getPlaneResult(): PlaneFittingResult | null {
    return this.planeResult;
  }

  /**
   * 平面グループを設定
   */
  public setPlaneGroup(group: THREE.Group | null): void {
    this.planeGroup = group;
  }

  /**
   * 平面グループを取得
   */
  public getPlaneGroup(): THREE.Group | null {
    return this.planeGroup;
  }

  /**
   * 状態データを取得
   */
  public getStateData(state: SPALAMState): unknown {
    return this.stateData.get(state);
  }

  /**
   * 状態履歴を取得
   */
  public getStateHistory(): StateChangeEvent[] {
    return [...this.stateHistory];
  }

  /**
   * エラー状態に遷移
   */
  public setError(error: Error | string): void {
    const errorData = {
      message: typeof error === "string" ? error : error.message,
      timestamp: Date.now(),
    };
    this.setState(SPALAMState.ERROR, errorData);
  }

  /**
   * 状態をリセット
   */
  public reset(): void {
    this.currentState = SPALAMState.IDLE;
    this.planeDetected = false;
    this.planeResult = null;
    this.planeGroup = null;
    this.stateData.clear();
    this.stateHistory = [];

    // リセットイベントを通知
    const event: StateChangeEvent = {
      previousState: this.currentState,
      currentState: SPALAMState.IDLE,
      timestamp: Date.now(),
    };
    this.notifyListeners(event);
  }

  /**
   * 状態が特定の状態かチェック
   */
  public isState(state: SPALAMState): boolean {
    return this.currentState === state;
  }

  /**
   * 状態が特定の状態のいずれかかチェック
   */
  public isAnyState(...states: SPALAMState[]): boolean {
    return states.includes(this.currentState);
  }

  /**
   * リスナーに通知
   */
  private notifyListeners(event: StateChangeEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error("Error in state change listener:", error);
      }
    });
  }
}

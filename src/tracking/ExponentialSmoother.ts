/**
 * Exponential Smoother
 *
 * Applies exponential smoothing to reduce noise and jitter in values.
 * Smaller alpha values provide more smoothing but slower response.
 * Larger alpha values provide faster response but less smoothing.
 */
export class ExponentialSmoother {
  private smoothedValue: number;
  private alpha: number;
  private initialized: boolean = false;

  /**
   * Create a new ExponentialSmoother
   *
   * @param alpha Smoothing coefficient (0-1). Default: 0.1
   *              - 0.1: Heavy smoothing, slow response
   *              - 0.3: Moderate smoothing
   *              - 0.5: Light smoothing, fast response
   */
  constructor(alpha: number = 0.1) {
    this.alpha = Math.max(0, Math.min(1, alpha));
    this.smoothedValue = 0;
  }

  /**
   * Update with a new value and return the smoothed result
   *
   * @param newValue The new input value
   * @returns The smoothed value
   */
  public update(newValue: number): number {
    if (!this.initialized) {
      this.smoothedValue = newValue;
      this.initialized = true;
      return newValue;
    }

    this.smoothedValue =
      this.alpha * newValue + (1 - this.alpha) * this.smoothedValue;
    return this.smoothedValue;
  }

  /**
   * Get the current smoothed value without updating
   */
  public getValue(): number {
    return this.smoothedValue;
  }

  /**
   * Reset the smoother state
   */
  public reset(): void {
    this.smoothedValue = 0;
    this.initialized = false;
  }

  /**
   * Set a new alpha value
   */
  public setAlpha(alpha: number): void {
    this.alpha = Math.max(0, Math.min(1, alpha));
  }

  /**
   * Get the current alpha value
   */
  public getAlpha(): number {
    return this.alpha;
  }

  /**
   * Check if the smoother has been initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Vector3 Exponential Smoother
 *
 * Applies exponential smoothing to 3D vectors
 */
export class Vector3ExponentialSmoother {
  private smootherX: ExponentialSmoother;
  private smootherY: ExponentialSmoother;
  private smootherZ: ExponentialSmoother;

  constructor(alpha: number = 0.1) {
    this.smootherX = new ExponentialSmoother(alpha);
    this.smootherY = new ExponentialSmoother(alpha);
    this.smootherZ = new ExponentialSmoother(alpha);
  }

  /**
   * Update with a new vector and return the smoothed result
   */
  public update(x: number, y: number, z: number): { x: number; y: number; z: number } {
    return {
      x: this.smootherX.update(x),
      y: this.smootherY.update(y),
      z: this.smootherZ.update(z),
    };
  }

  /**
   * Get the current smoothed vector
   */
  public getValue(): { x: number; y: number; z: number } {
    return {
      x: this.smootherX.getValue(),
      y: this.smootherY.getValue(),
      z: this.smootherZ.getValue(),
    };
  }

  /**
   * Reset all smoothers
   */
  public reset(): void {
    this.smootherX.reset();
    this.smootherY.reset();
    this.smootherZ.reset();
  }

  /**
   * Set alpha for all components
   */
  public setAlpha(alpha: number): void {
    this.smootherX.setAlpha(alpha);
    this.smootherY.setAlpha(alpha);
    this.smootherZ.setAlpha(alpha);
  }
}

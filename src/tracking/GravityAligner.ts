import * as THREE from "three";
import { Vector3ExponentialSmoother } from "./ExponentialSmoother";

/**
 * Plane type based on gravity alignment
 */
export enum PlaneType {
  /** Unknown orientation */
  UNKNOWN = "unknown",
  /** Horizontal plane (floor, table) */
  HORIZONTAL = "horizontal",
  /** Vertical plane (wall) */
  VERTICAL = "vertical",
  /** Sloped plane */
  SLOPED = "sloped",
}

/**
 * Gravity Aligner Options
 */
export interface GravityAlignerOptions {
  /** Angle threshold for horizontal plane detection (degrees). Default: 15 */
  horizontalThreshold?: number;
  /** Angle threshold for vertical plane detection (degrees). Default: 15 */
  verticalThreshold?: number;
  /** Smoothing alpha for gravity vector. Default: 0.1 */
  gravitySmoothingAlpha?: number;
  /** Smoothing alpha for plane normal. Default: 0.2 */
  normalSmoothingAlpha?: number;
  /** Whether to force horizontal alignment for detected horizontal planes. Default: true */
  forceHorizontalAlignment?: boolean;
  /** Maximum correction angle per frame (degrees). Default: 5 */
  maxCorrectionAnglePerFrame?: number;
}

/**
 * Alignment result
 */
export interface AlignmentResult {
  /** Corrected plane normal */
  correctedNormal: THREE.Vector3;
  /** Plane type */
  planeType: PlaneType;
  /** Angle between plane normal and gravity (degrees) */
  angleToGravity: number;
  /** Applied correction angle (degrees) */
  correctionApplied: number;
  /** Confidence of alignment (0-1) */
  confidence: number;
}

/**
 * Gravity Aligner
 *
 * Aligns detected plane normals with IMU gravity vector to improve accuracy.
 * For horizontal planes (like tables), forces the normal to be perpendicular to gravity.
 */
export class GravityAligner {
  private horizontalThreshold: number;
  private verticalThreshold: number;
  private forceHorizontalAlignment: boolean;
  private maxCorrectionAnglePerFrame: number;

  private gravitySmoother: Vector3ExponentialSmoother;
  private normalSmoother: Vector3ExponentialSmoother;

  private smoothedGravity: THREE.Vector3 = new THREE.Vector3(0, -1, 0);
  private lastPlaneNormal: THREE.Vector3 | null = null;
  private planeType: PlaneType = PlaneType.UNKNOWN;

  constructor(options?: GravityAlignerOptions) {
    this.horizontalThreshold = options?.horizontalThreshold ?? 15;
    this.verticalThreshold = options?.verticalThreshold ?? 15;
    this.forceHorizontalAlignment = options?.forceHorizontalAlignment ?? true;
    this.maxCorrectionAnglePerFrame = options?.maxCorrectionAnglePerFrame ?? 5;

    this.gravitySmoother = new Vector3ExponentialSmoother(
      options?.gravitySmoothingAlpha ?? 0.1
    );
    this.normalSmoother = new Vector3ExponentialSmoother(
      options?.normalSmoothingAlpha ?? 0.2
    );
  }

  /**
   * Update gravity vector from IMU
   *
   * @param gravityVector Gravity vector from IMU (typically pointing down)
   */
  public updateGravity(gravityVector: THREE.Vector3): void {
    // Normalize and smooth
    const normalized = gravityVector.clone().normalize();
    const smoothed = this.gravitySmoother.update(
      normalized.x,
      normalized.y,
      normalized.z
    );
    this.smoothedGravity.set(smoothed.x, smoothed.y, smoothed.z).normalize();
  }

  /**
   * Align plane normal with gravity
   *
   * @param planeNormal Original plane normal from RANSAC
   * @returns Alignment result with corrected normal
   */
  public alignPlaneNormal(planeNormal: THREE.Vector3): AlignmentResult {
    const normal = planeNormal.clone().normalize();

    // Calculate angle between plane normal and gravity
    // For horizontal planes: normal should be parallel to gravity (0 or 180 degrees)
    // For vertical planes: normal should be perpendicular to gravity (90 degrees)
    const dotProduct = normal.dot(this.smoothedGravity);
    const angleToGravity = Math.acos(Math.abs(dotProduct)) * (180 / Math.PI);

    // Determine plane type
    this.planeType = this.determinePlaneType(angleToGravity);

    let correctedNormal = normal.clone();
    let correctionApplied = 0;
    let confidence = 1.0;

    if (this.planeType === PlaneType.HORIZONTAL && this.forceHorizontalAlignment) {
      // Force horizontal alignment: normal should be parallel to gravity
      const sign = dotProduct >= 0 ? 1 : -1;
      const targetNormal = this.smoothedGravity.clone().multiplyScalar(sign);

      // Calculate correction
      const correctionAngle = normal.angleTo(targetNormal) * (180 / Math.PI);

      // Limit correction per frame
      const actualCorrection = Math.min(
        correctionAngle,
        this.maxCorrectionAnglePerFrame
      );

      if (actualCorrection > 0.1) {
        // Interpolate towards target
        const t = actualCorrection / correctionAngle;
        correctedNormal.lerp(targetNormal, t).normalize();
        correctionApplied = actualCorrection;
      } else {
        correctedNormal = targetNormal;
        correctionApplied = correctionAngle;
      }

      confidence = 1.0 - angleToGravity / this.horizontalThreshold;
    } else if (this.planeType === PlaneType.VERTICAL) {
      // For vertical planes, ensure normal is perpendicular to gravity
      const gravityComponent = this.smoothedGravity
        .clone()
        .multiplyScalar(dotProduct);
      correctedNormal = normal.clone().sub(gravityComponent).normalize();

      const correctionAngle =
        Math.abs(90 - angleToGravity) > this.maxCorrectionAnglePerFrame
          ? this.maxCorrectionAnglePerFrame
          : Math.abs(90 - angleToGravity);
      correctionApplied = correctionAngle;
      confidence = 1.0 - Math.abs(90 - angleToGravity) / this.verticalThreshold;
    }

    // Smooth the corrected normal
    const smoothed = this.normalSmoother.update(
      correctedNormal.x,
      correctedNormal.y,
      correctedNormal.z
    );
    correctedNormal.set(smoothed.x, smoothed.y, smoothed.z).normalize();

    this.lastPlaneNormal = correctedNormal.clone();

    return {
      correctedNormal,
      planeType: this.planeType,
      angleToGravity,
      correctionApplied,
      confidence: Math.max(0, Math.min(1, confidence)),
    };
  }

  /**
   * Determine plane type based on angle to gravity
   */
  private determinePlaneType(angleToGravity: number): PlaneType {
    // Angle between normal and gravity:
    // - 0° or 180°: Normal is parallel to gravity = HORIZONTAL plane
    // - 90°: Normal is perpendicular to gravity = VERTICAL plane

    if (angleToGravity < this.horizontalThreshold) {
      return PlaneType.HORIZONTAL;
    } else if (Math.abs(90 - angleToGravity) < this.verticalThreshold) {
      return PlaneType.VERTICAL;
    } else {
      return PlaneType.SLOPED;
    }
  }

  /**
   * Get the current smoothed gravity vector
   */
  public getGravityVector(): THREE.Vector3 {
    return this.smoothedGravity.clone();
  }

  /**
   * Get the current plane type
   */
  public getPlaneType(): PlaneType {
    return this.planeType;
  }

  /**
   * Get the last corrected plane normal
   */
  public getLastPlaneNormal(): THREE.Vector3 | null {
    return this.lastPlaneNormal?.clone() ?? null;
  }

  /**
   * Check if gravity data is available
   */
  public hasGravityData(): boolean {
    return this.gravitySmoother.getValue().x !== 0 ||
           this.gravitySmoother.getValue().y !== 0 ||
           this.gravitySmoother.getValue().z !== 0;
  }

  /**
   * Create a rotation quaternion to align the plane with gravity
   *
   * @param currentNormal Current plane normal
   * @returns Quaternion to rotate the plane to align with gravity
   */
  public getAlignmentQuaternion(currentNormal: THREE.Vector3): THREE.Quaternion {
    const result = this.alignPlaneNormal(currentNormal);

    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(currentNormal.normalize(), result.correctedNormal);

    return quaternion;
  }

  /**
   * Get statistics
   */
  public getStatistics(): {
    gravityVector: { x: number; y: number; z: number };
    planeType: PlaneType;
    hasGravityData: boolean;
  } {
    const gravity = this.smoothedGravity;
    return {
      gravityVector: { x: gravity.x, y: gravity.y, z: gravity.z },
      planeType: this.planeType,
      hasGravityData: this.hasGravityData(),
    };
  }

  /**
   * Reset the aligner
   */
  public reset(): void {
    this.gravitySmoother.reset();
    this.normalSmoother.reset();
    this.smoothedGravity.set(0, -1, 0);
    this.lastPlaneNormal = null;
    this.planeType = PlaneType.UNKNOWN;
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.reset();
  }
}

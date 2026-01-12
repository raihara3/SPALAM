import * as THREE from "three";
import { Feature } from "../types/Feature";

/**
 * Anchor feature with locked 3D position
 */
export interface AnchorFeature {
  /** Feature ID */
  id: string;
  /** Initial 2D position (image coordinates) */
  initial2D: { x: number; y: number };
  /** Current 2D position (tracked by optical flow) */
  current2D: { x: number; y: number };
  /** Locked 3D position (world coordinates) */
  position3D: THREE.Vector3;
  /** Tracking count at anchor creation */
  anchorTrackingCount: number;
  /** Current tracking count */
  currentTrackingCount: number;
  /** Stability score (0-1) */
  stability: number;
  /** Reprojection error (pixels) */
  reprojectionError: number;
  /** Is this anchor valid */
  isValid: boolean;
  /** Last update timestamp */
  lastUpdated: number;
  /** Frames since last descriptor match */
  framesSinceMatch: number;
}

/**
 * Feature Anchor Options
 */
export interface FeatureAnchorOptions {
  /** Maximum reprojection error threshold (pixels). Default: 10 */
  maxReprojectionError?: number;
  /** Moderate reprojection error threshold (pixels). Default: 5 */
  moderateReprojectionError?: number;
  /** Minimum tracking count to create anchor. Default: 10 */
  minTrackingCountForAnchor?: number;
  /** Maximum number of anchors. Default: 50 */
  maxAnchors?: number;
  /** Frames between descriptor re-matching. Default: 30 */
  descriptorMatchInterval?: number;
  /** Anchor expiry time (ms). Default: 10000 */
  anchorExpiryMs?: number;
}

/**
 * Reprojection result
 */
export interface ReprojectionResult {
  /** Anchor ID */
  id: string;
  /** Projected 2D position */
  projected2D: { x: number; y: number };
  /** Observed 2D position */
  observed2D: { x: number; y: number };
  /** Reprojection error (pixels) */
  error: number;
  /** Weight based on error (0-1) */
  weight: number;
  /** Is valid (error below threshold) */
  isValid: boolean;
}

/**
 * Feature Anchor Manager
 *
 * Manages anchor features with locked 3D positions.
 * Implements reprojection error filtering and descriptor re-matching.
 */
export class FeatureAnchor {
  private anchors: Map<string, AnchorFeature> = new Map();
  private maxReprojectionError: number;
  private moderateReprojectionError: number;
  private minTrackingCountForAnchor: number;
  private maxAnchors: number;
  private descriptorMatchInterval: number;
  private anchorExpiryMs: number;
  private frameCount: number = 0;

  constructor(options?: FeatureAnchorOptions) {
    this.maxReprojectionError = options?.maxReprojectionError ?? 10;
    this.moderateReprojectionError = options?.moderateReprojectionError ?? 5;
    this.minTrackingCountForAnchor = options?.minTrackingCountForAnchor ?? 10;
    this.maxAnchors = options?.maxAnchors ?? 50;
    this.descriptorMatchInterval = options?.descriptorMatchInterval ?? 30;
    this.anchorExpiryMs = options?.anchorExpiryMs ?? 10000;
  }

  /**
   * Update anchors with current frame features
   *
   * @param features Current frame features
   * @param get3DPosition Function to get 3D position for a feature
   */
  public updateAnchors(
    features: Feature[],
    get3DPosition?: (feature: Feature) => THREE.Vector3 | null
  ): void {
    const now = Date.now();
    this.frameCount++;

    const currentIds = new Set<string>();

    for (const feature of features) {
      currentIds.add(feature.id);

      const existing = this.anchors.get(feature.id);

      if (existing) {
        // Update existing anchor
        existing.current2D = { x: feature.x, y: feature.y };
        existing.currentTrackingCount = feature.trackingCount;
        existing.lastUpdated = now;
        existing.framesSinceMatch++;

        // Update stability based on tracking consistency
        const trackingRatio =
          feature.trackingCount / existing.anchorTrackingCount;
        existing.stability = Math.min(1.0, trackingRatio * 0.5 + 0.5);
      } else if (feature.trackingCount >= this.minTrackingCountForAnchor) {
        // Create new anchor for stable features
        const position3D = get3DPosition?.(feature) ?? new THREE.Vector3();

        if (this.anchors.size < this.maxAnchors) {
          this.anchors.set(feature.id, {
            id: feature.id,
            initial2D: { x: feature.x, y: feature.y },
            current2D: { x: feature.x, y: feature.y },
            position3D: position3D.clone(),
            anchorTrackingCount: feature.trackingCount,
            currentTrackingCount: feature.trackingCount,
            stability: 1.0,
            reprojectionError: 0,
            isValid: true,
            lastUpdated: now,
            framesSinceMatch: 0,
          });
        }
      }
    }

    // Remove anchors that are no longer visible or expired
    for (const [id, anchor] of this.anchors) {
      if (
        !currentIds.has(id) ||
        now - anchor.lastUpdated > this.anchorExpiryMs
      ) {
        this.anchors.delete(id);
      }
    }

    // Limit anchor count by removing lowest stability anchors
    if (this.anchors.size > this.maxAnchors) {
      const sorted = Array.from(this.anchors.values()).sort(
        (a, b) => b.stability - a.stability
      );
      const toKeep = new Set(sorted.slice(0, this.maxAnchors).map((a) => a.id));
      for (const id of this.anchors.keys()) {
        if (!toKeep.has(id)) {
          this.anchors.delete(id);
        }
      }
    }
  }

  /**
   * Calculate reprojection errors for all anchors
   *
   * @param cameraMatrix Camera intrinsic matrix (3x3)
   * @param rotationMatrix Camera rotation matrix (3x3)
   * @param translation Camera translation vector
   * @returns Reprojection results for all anchors
   */
  public calculateReprojectionErrors(
    cameraMatrix: THREE.Matrix3,
    rotationMatrix: THREE.Matrix3,
    translation: THREE.Vector3
  ): ReprojectionResult[] {
    const results: ReprojectionResult[] = [];

    for (const anchor of this.anchors.values()) {
      // Project 3D point to 2D
      const projected = this.projectPoint(
        anchor.position3D,
        cameraMatrix,
        rotationMatrix,
        translation
      );

      // Calculate error
      const dx = projected.x - anchor.current2D.x;
      const dy = projected.y - anchor.current2D.y;
      const error = Math.sqrt(dx * dx + dy * dy);

      // Update anchor reprojection error
      anchor.reprojectionError = error;

      // Calculate weight based on error
      let weight: number;
      let isValid: boolean;

      if (error < this.moderateReprojectionError) {
        weight = 1.0;
        isValid = true;
      } else if (error < this.maxReprojectionError) {
        weight = 0.5;
        isValid = true;
      } else {
        weight = 0;
        isValid = false;
      }

      anchor.isValid = isValid;

      results.push({
        id: anchor.id,
        projected2D: projected,
        observed2D: anchor.current2D,
        error,
        weight,
        isValid,
      });
    }

    return results;
  }

  /**
   * Project a 3D point to 2D image coordinates
   */
  private projectPoint(
    point3D: THREE.Vector3,
    cameraMatrix: THREE.Matrix3,
    rotationMatrix: THREE.Matrix3,
    translation: THREE.Vector3
  ): { x: number; y: number } {
    // Transform point to camera coordinates: P_cam = R * P_world + t
    const camPoint = point3D.clone();
    camPoint.applyMatrix3(rotationMatrix);
    camPoint.add(translation);

    // Avoid division by zero
    if (Math.abs(camPoint.z) < 0.001) {
      return { x: 0, y: 0 };
    }

    // Project to normalized image coordinates
    const normalizedX = camPoint.x / camPoint.z;
    const normalizedY = camPoint.y / camPoint.z;

    // Apply camera matrix
    const fx = cameraMatrix.elements[0];
    const fy = cameraMatrix.elements[4];
    const cx = cameraMatrix.elements[6];
    const cy = cameraMatrix.elements[7];

    return {
      x: fx * normalizedX + cx,
      y: fy * normalizedY + cy,
    };
  }

  /**
   * Get valid anchors (with low reprojection error)
   */
  public getValidAnchors(): AnchorFeature[] {
    return Array.from(this.anchors.values()).filter((a) => a.isValid);
  }

  /**
   * Get all anchors
   */
  public getAllAnchors(): AnchorFeature[] {
    return Array.from(this.anchors.values());
  }

  /**
   * Get anchor by ID
   */
  public getAnchor(id: string): AnchorFeature | undefined {
    return this.anchors.get(id);
  }

  /**
   * Check if descriptor re-matching should be performed
   */
  public shouldPerformDescriptorMatch(): boolean {
    return this.frameCount % this.descriptorMatchInterval === 0;
  }

  /**
   * Update anchor position after descriptor re-matching
   *
   * @param id Anchor ID
   * @param correctedPosition Corrected 2D position from descriptor matching
   */
  public correctAnchorPosition(
    id: string,
    correctedPosition: { x: number; y: number }
  ): void {
    const anchor = this.anchors.get(id);
    if (anchor) {
      anchor.current2D = correctedPosition;
      anchor.framesSinceMatch = 0;
    }
  }

  /**
   * Get anchors that need descriptor re-matching
   */
  public getAnchorsNeedingMatch(): AnchorFeature[] {
    return Array.from(this.anchors.values()).filter(
      (a) => a.framesSinceMatch >= this.descriptorMatchInterval
    );
  }

  /**
   * Get weighted average position from valid anchors
   */
  public getWeightedCentroid(): THREE.Vector3 | null {
    const validAnchors = this.getValidAnchors();
    if (validAnchors.length === 0) {
      return null;
    }

    const centroid = new THREE.Vector3();
    let totalWeight = 0;

    for (const anchor of validAnchors) {
      const weight = anchor.stability * (anchor.isValid ? 1 : 0.5);
      centroid.add(anchor.position3D.clone().multiplyScalar(weight));
      totalWeight += weight;
    }

    if (totalWeight > 0) {
      centroid.divideScalar(totalWeight);
    }

    return centroid;
  }

  /**
   * Get statistics
   */
  public getStatistics(): {
    totalAnchors: number;
    validAnchors: number;
    averageError: number;
    averageStability: number;
  } {
    const anchors = Array.from(this.anchors.values());
    const validAnchors = anchors.filter((a) => a.isValid);

    let totalError = 0;
    let totalStability = 0;

    for (const anchor of anchors) {
      totalError += anchor.reprojectionError;
      totalStability += anchor.stability;
    }

    return {
      totalAnchors: anchors.length,
      validAnchors: validAnchors.length,
      averageError: anchors.length > 0 ? totalError / anchors.length : 0,
      averageStability:
        anchors.length > 0 ? totalStability / anchors.length : 0,
    };
  }

  /**
   * Clear invalid anchors (high error or low stability)
   * Used for periodic memory cleanup
   */
  public clearInvalidAnchors(): void {
    const now = Date.now();
    for (const [id, anchor] of this.anchors) {
      // Remove if invalid, low stability, or expired
      if (
        !anchor.isValid ||
        anchor.stability < 0.3 ||
        now - anchor.lastUpdated > this.anchorExpiryMs * 0.5
      ) {
        this.anchors.delete(id);
      }
    }
  }

  /**
   * Reset all anchors
   */
  public reset(): void {
    this.anchors.clear();
    this.frameCount = 0;
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.anchors.clear();
  }
}

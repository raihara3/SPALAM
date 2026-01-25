/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import type {
  CameraPose,
  CameraIntrinsics,
  Keyframe,
  MapPoint,
  IMUBiases,
  PreintegrationResult,
  VIOOptimizationResult,
} from "../types/Pose";

/**
 * Visual-Inertial Optimizer Options
 */
export interface VisualInertialOptimizerOptions {
  /** Maximum optimization iterations. Default: 15 */
  maxIterations?: number;
  /** Convergence threshold for cost reduction. Default: 1e-6 */
  convergenceThreshold?: number;
  /** Weight for reprojection error term. Default: 1.0 */
  reprojectionWeight?: number;
  /** Weight for IMU error term. Default: 1.0 */
  imuWeight?: number;
  /** Weight for bias prior term. Default: 0.01 */
  biasPriorWeight?: number;
  /** Huber loss threshold for robust optimization. Default: 5.99 */
  huberThreshold?: number;
  /** Gravity magnitude (m/s²). Default: 9.80665 */
  gravityMagnitude?: number;
  /** Minimum scale value. Default: 0.0001 */
  minScale?: number;
  /** Maximum scale value. Default: 100 */
  maxScale?: number;
}

/**
 * IMU preintegration constraint between two keyframes
 */
export interface IMUConstraint {
  /** Start keyframe ID */
  keyframeIdStart: number;
  /** End keyframe ID */
  keyframeIdEnd: number;
  /** Preintegration result */
  preintegration: PreintegrationResult;
  /** Velocity at start keyframe */
  velocityStart: THREE.Vector3;
}

/**
 * Visual-Inertial Optimizer
 *
 * Performs joint optimization of visual and inertial data to estimate:
 * - Absolute scale factor
 * - Gravity direction in world frame
 * - IMU biases (accelerometer and gyroscope)
 * - Camera poses
 * - Velocities at each keyframe
 *
 * The optimization minimizes a combined cost function:
 * - Visual reprojection error
 * - IMU preintegration error
 * - Bias prior (regularization)
 *
 * Based on Visual-Inertial tight coupling approach.
 */
export class VisualInertialOptimizer {
  private intrinsics: CameraIntrinsics;
  private maxIterations: number;
  private convergenceThreshold: number;
  private reprojectionWeight: number;
  private imuWeight: number;
  private biasPriorWeight: number;
  private huberThreshold: number;
  private gravityMagnitude: number;
  private minScale: number;
  private maxScale: number;

  constructor(
    intrinsics: CameraIntrinsics,
    options?: VisualInertialOptimizerOptions
  ) {
    this.intrinsics = intrinsics;
    this.maxIterations = options?.maxIterations ?? 15;
    this.convergenceThreshold = options?.convergenceThreshold ?? 1e-6;
    this.reprojectionWeight = options?.reprojectionWeight ?? 1.0;
    this.imuWeight = options?.imuWeight ?? 1.0;
    this.biasPriorWeight = options?.biasPriorWeight ?? 0.01;
    this.huberThreshold = options?.huberThreshold ?? 5.99;
    this.gravityMagnitude = options?.gravityMagnitude ?? 9.80665;
    this.minScale = options?.minScale ?? 0.0001;
    this.maxScale = options?.maxScale ?? 100;
  }

  /**
   * Run Visual-Inertial optimization
   *
   * @param keyframes Keyframes with visual observations
   * @param mapPoints 3D map points
   * @param imuConstraints IMU preintegration constraints between keyframes
   * @param initialScale Initial scale estimate
   * @param initialGravity Initial gravity direction estimate
   * @param initialBiases Initial IMU biases estimate
   * @returns Optimization result
   */
  public optimize(
    keyframes: Keyframe[],
    mapPoints: MapPoint[],
    imuConstraints: IMUConstraint[],
    initialScale: number,
    initialGravity: THREE.Vector3,
    initialBiases: IMUBiases
  ): VIOOptimizationResult {
    if (keyframes.length < 2) {
      return this.createEmptyResult(
        initialScale,
        initialGravity,
        initialBiases
      );
    }

    // Initialize state variables
    let currentScale = Math.max(
      this.minScale,
      Math.min(this.maxScale, initialScale)
    );
    const currentGravity = initialGravity.clone().normalize();
    const currentBiases: IMUBiases = {
      accelerometerBias: initialBiases.accelerometerBias.clone(),
      gyroscopeBias: initialBiases.gyroscopeBias.clone(),
    };

    // Initialize velocities (estimate from poses if not provided)
    const velocities = this.initializeVelocities(keyframes, imuConstraints);

    // Create working copies of poses
    const poses = new Map<number, CameraPose>();
    for (const keyframe of keyframes) {
      poses.set(keyframe.id, this.clonePose(keyframe.pose));
    }

    // Calculate initial cost
    let currentCost = this.computeTotalCost(
      keyframes,
      mapPoints,
      imuConstraints,
      poses,
      velocities,
      currentScale,
      currentGravity,
      currentBiases
    );

    // Store initial cost for potential debugging (prefixed with _ to suppress unused warning)
    const _initialCost = currentCost;
    void _initialCost; // Suppress unused variable warning
    let converged = false;

    // Optimization loop
    for (let iter = 0; iter < this.maxIterations; iter++) {
      // 1. Optimize scale
      const newScale = this.optimizeScale(
        keyframes,
        imuConstraints,
        poses,
        velocities,
        currentScale,
        currentGravity
      );
      currentScale = Math.max(
        this.minScale,
        Math.min(this.maxScale, newScale)
      );

      // 2. Optimize gravity direction
      this.optimizeGravityDirection(
        keyframes,
        imuConstraints,
        poses,
        velocities,
        currentScale,
        currentGravity
      );

      // 3. Optimize biases
      this.optimizeBiases(
        imuConstraints,
        poses,
        velocities,
        currentScale,
        currentGravity,
        currentBiases
      );

      // 4. Optimize velocities
      this.optimizeVelocities(
        keyframes,
        imuConstraints,
        poses,
        velocities,
        currentScale,
        currentGravity,
        currentBiases
      );

      // 5. Optimize poses (skip first - fixed reference)
      this.optimizePoses(
        keyframes.slice(1),
        mapPoints,
        imuConstraints,
        poses,
        velocities,
        currentScale,
        currentGravity
      );

      // Calculate new cost
      const newCost = this.computeTotalCost(
        keyframes,
        mapPoints,
        imuConstraints,
        poses,
        velocities,
        currentScale,
        currentGravity,
        currentBiases
      );

      // Check convergence
      const costReduction = Math.abs(currentCost - newCost) / (currentCost + 1e-10);
      if (costReduction < this.convergenceThreshold) {
        converged = true;
        currentCost = newCost;
        break;
      }

      currentCost = newCost;
    }

    return {
      scale: currentScale,
      gravityDirection: currentGravity,
      biases: currentBiases,
      poses,
      velocities,
      cost: currentCost,
      converged,
    };
  }

  /**
   * Initialize velocities from pose differences
   */
  private initializeVelocities(
    keyframes: Keyframe[],
    imuConstraints: IMUConstraint[]
  ): Map<number, THREE.Vector3> {
    const velocities = new Map<number, THREE.Vector3>();

    // Use velocities from IMU constraints if available
    for (const constraint of imuConstraints) {
      if (!velocities.has(constraint.keyframeIdStart)) {
        velocities.set(constraint.keyframeIdStart, constraint.velocityStart.clone());
      }
    }

    // Estimate remaining velocities from pose differences
    const sortedKeyframes = [...keyframes].sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 0; i < sortedKeyframes.length; i++) {
      const keyframe = sortedKeyframes[i];
      if (velocities.has(keyframe.id)) {
        continue;
      }

      if (i > 0) {
        const prevKeyframe = sortedKeyframes[i - 1];
        const deltaTime = (keyframe.timestamp - prevKeyframe.timestamp) / 1000;
        if (deltaTime > 0) {
          const velocity = keyframe.pose.translation
            .clone()
            .sub(prevKeyframe.pose.translation)
            .divideScalar(deltaTime);
          velocities.set(keyframe.id, velocity);
        } else {
          velocities.set(keyframe.id, new THREE.Vector3());
        }
      } else {
        velocities.set(keyframe.id, new THREE.Vector3());
      }
    }

    return velocities;
  }

  /**
   * Optimize scale factor
   */
  private optimizeScale(
    _keyframes: Keyframe[],
    imuConstraints: IMUConstraint[],
    poses: Map<number, CameraPose>,
    velocities: Map<number, THREE.Vector3>,
    currentScale: number,
    gravity: THREE.Vector3
  ): number {
    if (imuConstraints.length === 0) {
      return currentScale;
    }

    // Compute scale gradient using IMU constraints
    let numerator = 0;
    let denominator = 0;

    for (const constraint of imuConstraints) {
      const pose1 = poses.get(constraint.keyframeIdStart);
      const pose2 = poses.get(constraint.keyframeIdEnd);
      const velocity1 = velocities.get(constraint.keyframeIdStart);

      if (!pose1 || !pose2 || !velocity1) {
        continue;
      }

      const deltaTime = constraint.preintegration.integrationTime;
      if (deltaTime < 0.01) {
        continue;
      }

      // IMU predicted displacement
      const gravityContribution = gravity
        .clone()
        .multiplyScalar(0.5 * this.gravityMagnitude * deltaTime * deltaTime);

      const velocityContribution = velocity1.clone().multiplyScalar(deltaTime);

      const imuDisplacement = velocityContribution
        .clone()
        .add(gravityContribution)
        .add(constraint.preintegration.deltaPosition);

      // Compute scale correction
      const visualMagnitude = pose2.translation
        .clone()
        .sub(pose1.translation)
        .length();

      if (visualMagnitude > 0.001) {
        const imuMagnitude = imuDisplacement.length();
        numerator += imuMagnitude * visualMagnitude;
        denominator += visualMagnitude * visualMagnitude;
      }
    }

    if (denominator > 1e-10) {
      return numerator / denominator;
    }

    return currentScale;
  }

  /**
   * Optimize gravity direction using gradient descent
   */
  private optimizeGravityDirection(
    _keyframes: Keyframe[],
    imuConstraints: IMUConstraint[],
    poses: Map<number, CameraPose>,
    velocities: Map<number, THREE.Vector3>,
    scale: number,
    gravity: THREE.Vector3
  ): void {
    if (imuConstraints.length === 0) {
      return;
    }

    const gradient = new THREE.Vector3();

    for (const constraint of imuConstraints) {
      const pose1 = poses.get(constraint.keyframeIdStart);
      const pose2 = poses.get(constraint.keyframeIdEnd);
      const velocity1 = velocities.get(constraint.keyframeIdStart);

      if (!pose1 || !pose2 || !velocity1) {
        continue;
      }

      const deltaTime = constraint.preintegration.integrationTime;
      if (deltaTime < 0.01) {
        continue;
      }

      // Visual displacement (scaled)
      const visualDisplacement = pose2.translation
        .clone()
        .sub(pose1.translation)
        .multiplyScalar(scale);

      // IMU predicted displacement
      const gravityContribution = gravity
        .clone()
        .multiplyScalar(0.5 * this.gravityMagnitude * deltaTime * deltaTime);

      const velocityContribution = velocity1.clone().multiplyScalar(deltaTime);

      const imuDisplacement = velocityContribution
        .clone()
        .add(gravityContribution)
        .add(constraint.preintegration.deltaPosition);

      // Error
      const error = imuDisplacement.clone().sub(visualDisplacement);

      // Gradient of error w.r.t. gravity direction
      const gravityJacobian = 0.5 * this.gravityMagnitude * deltaTime * deltaTime;
      gradient.add(error.clone().multiplyScalar(gravityJacobian));
    }

    // Update gravity direction with gradient descent
    const stepSize = 0.01;
    gravity.sub(gradient.multiplyScalar(stepSize / imuConstraints.length));
    gravity.normalize();
  }

  /**
   * Optimize IMU biases
   */
  private optimizeBiases(
    imuConstraints: IMUConstraint[],
    poses: Map<number, CameraPose>,
    velocities: Map<number, THREE.Vector3>,
    scale: number,
    gravity: THREE.Vector3,
    biases: IMUBiases
  ): void {
    if (imuConstraints.length === 0) {
      return;
    }

    const accelGradient = new THREE.Vector3();
    const gyroGradient = new THREE.Vector3();

    for (const constraint of imuConstraints) {
      const pose1 = poses.get(constraint.keyframeIdStart);
      const pose2 = poses.get(constraint.keyframeIdEnd);
      const velocity1 = velocities.get(constraint.keyframeIdStart);
      const velocity2 = velocities.get(constraint.keyframeIdEnd);

      if (!pose1 || !pose2 || !velocity1 || !velocity2) {
        continue;
      }

      const deltaTime = constraint.preintegration.integrationTime;
      if (deltaTime < 0.01) {
        continue;
      }

      // Position error contributes to accelerometer bias gradient
      const visualDisplacement = pose2.translation
        .clone()
        .sub(pose1.translation)
        .multiplyScalar(scale);

      const gravityContribution = gravity
        .clone()
        .multiplyScalar(0.5 * this.gravityMagnitude * deltaTime * deltaTime);

      const velocityContribution = velocity1.clone().multiplyScalar(deltaTime);

      const predictedDisplacement = velocityContribution
        .clone()
        .add(gravityContribution)
        .add(constraint.preintegration.deltaPosition);

      const positionError = predictedDisplacement.sub(visualDisplacement);

      // Simplified gradient (accumulate position error as bias gradient)
      accelGradient.add(positionError.clone().multiplyScalar(deltaTime * deltaTime * 0.5));

      // Velocity error contributes to both bias gradients
      const predictedVelocity = velocity1
        .clone()
        .add(gravity.clone().multiplyScalar(this.gravityMagnitude * deltaTime))
        .add(constraint.preintegration.deltaVelocity);

      const velocityError = predictedVelocity.sub(velocity2);
      accelGradient.add(velocityError.clone().multiplyScalar(deltaTime));

      // Rotation error contributes to gyroscope bias gradient
      const rotationError = this.computeRotationError(
        pose1.quaternion,
        pose2.quaternion,
        constraint.preintegration.deltaRotation
      );
      gyroGradient.add(rotationError.multiplyScalar(deltaTime));
    }

    // Add bias prior (regularization towards zero)
    accelGradient.add(biases.accelerometerBias.clone().multiplyScalar(this.biasPriorWeight));
    gyroGradient.add(biases.gyroscopeBias.clone().multiplyScalar(this.biasPriorWeight));

    // Update biases
    const stepSize = 0.001;
    biases.accelerometerBias.sub(
      accelGradient.multiplyScalar(stepSize / Math.max(1, imuConstraints.length))
    );
    biases.gyroscopeBias.sub(
      gyroGradient.multiplyScalar(stepSize / Math.max(1, imuConstraints.length))
    );

    // Clamp biases to reasonable values
    this.clampVector(biases.accelerometerBias, 1.0); // Max 1 m/s² bias
    this.clampVector(biases.gyroscopeBias, 0.1); // Max 0.1 rad/s bias
  }

  /**
   * Optimize velocities at each keyframe
   */
  private optimizeVelocities(
    keyframes: Keyframe[],
    imuConstraints: IMUConstraint[],
    poses: Map<number, CameraPose>,
    velocities: Map<number, THREE.Vector3>,
    scale: number,
    gravity: THREE.Vector3,
    _biases: IMUBiases
  ): void {
    for (const keyframe of keyframes) {
      const velocity = velocities.get(keyframe.id);
      if (!velocity) {
        continue;
      }

      const gradient = new THREE.Vector3();
      let constraintCount = 0;

      // Find constraints involving this keyframe
      for (const constraint of imuConstraints) {
        if (constraint.keyframeIdStart === keyframe.id) {
          // This keyframe is the start of the constraint
          const pose1 = poses.get(constraint.keyframeIdStart);
          const pose2 = poses.get(constraint.keyframeIdEnd);

          if (!pose1 || !pose2) {
            continue;
          }

          const deltaTime = constraint.preintegration.integrationTime;
          if (deltaTime < 0.01) {
            continue;
          }

          // Position error gradient w.r.t. start velocity
          const visualDisplacement = pose2.translation
            .clone()
            .sub(pose1.translation)
            .multiplyScalar(scale);

          const gravityContribution = gravity
            .clone()
            .multiplyScalar(0.5 * this.gravityMagnitude * deltaTime * deltaTime);

          const velocityContribution = velocity.clone().multiplyScalar(deltaTime);

          const predictedDisplacement = velocityContribution
            .clone()
            .add(gravityContribution)
            .add(constraint.preintegration.deltaPosition);

          const positionError = predictedDisplacement.sub(visualDisplacement);
          gradient.add(positionError.multiplyScalar(deltaTime));
          constraintCount++;
        }

        if (constraint.keyframeIdEnd === keyframe.id) {
          // This keyframe is the end of the constraint
          const velocityStart = velocities.get(constraint.keyframeIdStart);
          if (!velocityStart) {
            continue;
          }

          const deltaTime = constraint.preintegration.integrationTime;
          if (deltaTime < 0.01) {
            continue;
          }

          // Velocity error gradient
          const predictedVelocity = velocityStart
            .clone()
            .add(gravity.clone().multiplyScalar(this.gravityMagnitude * deltaTime))
            .add(constraint.preintegration.deltaVelocity);

          const velocityError = velocity.clone().sub(predictedVelocity);
          gradient.add(velocityError.clone().multiplyScalar(-1));
          constraintCount++;
        }
      }

      // Update velocity
      if (constraintCount > 0) {
        const stepSize = 0.01;
        velocity.sub(gradient.multiplyScalar(stepSize / constraintCount));

        // Clamp velocity to reasonable values
        this.clampVector(velocity, 10.0); // Max 10 m/s
      }
    }
  }

  /**
   * Optimize poses using visual reprojection and IMU constraints
   */
  private optimizePoses(
    keyframes: Keyframe[],
    mapPoints: MapPoint[],
    imuConstraints: IMUConstraint[],
    poses: Map<number, CameraPose>,
    velocities: Map<number, THREE.Vector3>,
    scale: number,
    gravity: THREE.Vector3
  ): void {
    for (const keyframe of keyframes) {
      const pose = poses.get(keyframe.id);
      if (!pose) {
        continue;
      }

      const translationGradient = new THREE.Vector3();

      // Visual reprojection gradient
      for (const point of mapPoints) {
        const featureIndex = point.observations.get(keyframe.id);
        if (featureIndex === undefined || featureIndex >= keyframe.features.length) {
          continue;
        }

        if (!point.isValid) {
          continue;
        }

        const feature = keyframe.features[featureIndex];
        const scaledPosition = point.position.clone().multiplyScalar(scale);
        const projected = this.projectPoint(scaledPosition, pose);

        const errorX = projected.x - feature.x;
        const errorY = projected.y - feature.y;

        const depth = this.calculateDepth(scaledPosition, pose);
        if (depth > 0.1) {
          translationGradient.x -= errorX * this.intrinsics.fx / depth * this.reprojectionWeight;
          translationGradient.y -= errorY * this.intrinsics.fy / depth * this.reprojectionWeight;
        }
      }

      // IMU constraint gradient
      for (const constraint of imuConstraints) {
        if (constraint.keyframeIdEnd === keyframe.id) {
          const pose1 = poses.get(constraint.keyframeIdStart);
          const velocity1 = velocities.get(constraint.keyframeIdStart);

          if (!pose1 || !velocity1) {
            continue;
          }

          const deltaTime = constraint.preintegration.integrationTime;
          if (deltaTime < 0.01) {
            continue;
          }

          // Position error gradient w.r.t. end pose translation
          const gravityContribution = gravity
            .clone()
            .multiplyScalar(0.5 * this.gravityMagnitude * deltaTime * deltaTime);

          const velocityContribution = velocity1.clone().multiplyScalar(deltaTime);

          const predictedPosition = pose1.translation
            .clone()
            .multiplyScalar(scale)
            .add(velocityContribution)
            .add(gravityContribution)
            .add(constraint.preintegration.deltaPosition);

          const actualPosition = pose.translation.clone().multiplyScalar(scale);
          const positionError = predictedPosition.sub(actualPosition);

          translationGradient.add(positionError.multiplyScalar(-scale * this.imuWeight));
        }
      }

      // Update translation
      const observationCount = this.countObservations(keyframe.id, mapPoints);
      if (observationCount > 0) {
        const stepSize = 0.001;
        pose.translation.add(
          translationGradient.multiplyScalar(stepSize / observationCount)
        );
      }
    }
  }

  /**
   * Compute total optimization cost
   */
  private computeTotalCost(
    keyframes: Keyframe[],
    mapPoints: MapPoint[],
    imuConstraints: IMUConstraint[],
    poses: Map<number, CameraPose>,
    velocities: Map<number, THREE.Vector3>,
    scale: number,
    gravity: THREE.Vector3,
    biases: IMUBiases
  ): number {
    let totalCost = 0;

    // Visual reprojection cost
    totalCost += this.computeReprojectionCost(keyframes, mapPoints, poses, scale);

    // IMU preintegration cost
    totalCost += this.computeIMUCost(
      imuConstraints,
      poses,
      velocities,
      scale,
      gravity
    );

    // Bias prior cost
    totalCost +=
      this.biasPriorWeight *
      (biases.accelerometerBias.lengthSq() + biases.gyroscopeBias.lengthSq());

    return totalCost;
  }

  /**
   * Compute visual reprojection cost
   */
  private computeReprojectionCost(
    keyframes: Keyframe[],
    mapPoints: MapPoint[],
    poses: Map<number, CameraPose>,
    scale: number
  ): number {
    let cost = 0;

    for (const point of mapPoints) {
      if (!point.isValid) {
        continue;
      }

      for (const [keyframeId, featureIndex] of point.observations) {
        const keyframe = keyframes.find((kf) => kf.id === keyframeId);
        const pose = poses.get(keyframeId);

        if (!keyframe || !pose || featureIndex >= keyframe.features.length) {
          continue;
        }

        const feature = keyframe.features[featureIndex];
        const scaledPosition = point.position.clone().multiplyScalar(scale);
        const projected = this.projectPoint(scaledPosition, pose);

        const error = Math.sqrt(
          Math.pow(projected.x - feature.x, 2) +
            Math.pow(projected.y - feature.y, 2)
        );

        // Huber loss
        if (error <= this.huberThreshold) {
          cost += this.reprojectionWeight * 0.5 * error * error;
        } else {
          cost +=
            this.reprojectionWeight *
            this.huberThreshold *
            (error - 0.5 * this.huberThreshold);
        }
      }
    }

    return cost;
  }

  /**
   * Compute IMU preintegration cost
   */
  private computeIMUCost(
    imuConstraints: IMUConstraint[],
    poses: Map<number, CameraPose>,
    velocities: Map<number, THREE.Vector3>,
    scale: number,
    gravity: THREE.Vector3
  ): number {
    let cost = 0;

    for (const constraint of imuConstraints) {
      const pose1 = poses.get(constraint.keyframeIdStart);
      const pose2 = poses.get(constraint.keyframeIdEnd);
      const velocity1 = velocities.get(constraint.keyframeIdStart);
      const velocity2 = velocities.get(constraint.keyframeIdEnd);

      if (!pose1 || !pose2 || !velocity1 || !velocity2) {
        continue;
      }

      const deltaTime = constraint.preintegration.integrationTime;
      if (deltaTime < 0.01) {
        continue;
      }

      // Position error
      const visualDisplacement = pose2.translation
        .clone()
        .sub(pose1.translation)
        .multiplyScalar(scale);

      const gravityContribution = gravity
        .clone()
        .multiplyScalar(0.5 * this.gravityMagnitude * deltaTime * deltaTime);

      const velocityContribution = velocity1.clone().multiplyScalar(deltaTime);

      const predictedDisplacement = velocityContribution
        .clone()
        .add(gravityContribution)
        .add(constraint.preintegration.deltaPosition);

      const positionError = predictedDisplacement.clone().sub(visualDisplacement);
      cost += this.imuWeight * positionError.lengthSq();

      // Velocity error
      const predictedVelocity = velocity1
        .clone()
        .add(gravity.clone().multiplyScalar(this.gravityMagnitude * deltaTime))
        .add(constraint.preintegration.deltaVelocity);

      const velocityError = velocity2.clone().sub(predictedVelocity);
      cost += this.imuWeight * velocityError.lengthSq();

      // Rotation error
      const rotationError = this.computeRotationError(
        pose1.quaternion,
        pose2.quaternion,
        constraint.preintegration.deltaRotation
      );
      cost += this.imuWeight * rotationError.lengthSq();
    }

    return cost;
  }

  /**
   * Compute rotation error between predicted and actual rotation
   */
  private computeRotationError(
    q1: THREE.Quaternion,
    q2: THREE.Quaternion,
    deltaQ: THREE.Quaternion
  ): THREE.Vector3 {
    // Expected rotation: q2 = q1 * deltaQ
    const expectedQ2 = q1.clone().multiply(deltaQ);

    // Error quaternion: q_error = q2^{-1} * expectedQ2
    const q2Inv = q2.clone().invert();
    const errorQ = q2Inv.multiply(expectedQ2);

    // Convert to axis-angle error
    const angle = 2 * Math.acos(Math.abs(errorQ.w));
    if (angle < 1e-10) {
      return new THREE.Vector3();
    }

    const sinHalfAngle = Math.sin(angle / 2);
    if (sinHalfAngle < 1e-10) {
      return new THREE.Vector3();
    }

    return new THREE.Vector3(
      (errorQ.x / sinHalfAngle) * angle,
      (errorQ.y / sinHalfAngle) * angle,
      (errorQ.z / sinHalfAngle) * angle
    );
  }

  /**
   * Project 3D point to image coordinates
   */
  private projectPoint(
    point3D: THREE.Vector3,
    pose: CameraPose
  ): { x: number; y: number } {
    const R = pose.rotation;
    const t = pose.translation;

    // Transform to camera frame
    const relativePoint = point3D.clone().sub(t);
    const Rinv = R.clone().transpose();

    const x =
      Rinv.elements[0] * relativePoint.x +
      Rinv.elements[3] * relativePoint.y +
      Rinv.elements[6] * relativePoint.z;
    const y =
      Rinv.elements[1] * relativePoint.x +
      Rinv.elements[4] * relativePoint.y +
      Rinv.elements[7] * relativePoint.z;
    const z =
      Rinv.elements[2] * relativePoint.x +
      Rinv.elements[5] * relativePoint.y +
      Rinv.elements[8] * relativePoint.z;

    if (z <= 0) {
      return { x: Infinity, y: Infinity };
    }

    return {
      x: this.intrinsics.fx * (x / z) + this.intrinsics.cx,
      y: this.intrinsics.fy * (y / z) + this.intrinsics.cy,
    };
  }

  /**
   * Calculate depth of point in camera frame
   */
  private calculateDepth(point3D: THREE.Vector3, pose: CameraPose): number {
    const R = pose.rotation;
    const t = pose.translation;

    const relativePoint = point3D.clone().sub(t);
    const Rinv = R.clone().transpose();

    return (
      Rinv.elements[2] * relativePoint.x +
      Rinv.elements[5] * relativePoint.y +
      Rinv.elements[8] * relativePoint.z
    );
  }

  /**
   * Count observations for a keyframe
   */
  private countObservations(keyframeId: number, mapPoints: MapPoint[]): number {
    let count = 0;
    for (const point of mapPoints) {
      if (point.observations.has(keyframeId) && point.isValid) {
        count++;
      }
    }
    return count;
  }

  /**
   * Clone a camera pose
   */
  private clonePose(pose: CameraPose): CameraPose {
    return {
      rotation: pose.rotation.clone(),
      translation: pose.translation.clone(),
      quaternion: pose.quaternion.clone(),
      timestamp: pose.timestamp,
      confidence: pose.confidence,
    };
  }

  /**
   * Clamp vector magnitude
   */
  private clampVector(vector: THREE.Vector3, maxMagnitude: number): void {
    const magnitude = vector.length();
    if (magnitude > maxMagnitude) {
      vector.multiplyScalar(maxMagnitude / magnitude);
    }
  }

  /**
   * Create empty result
   */
  private createEmptyResult(
    scale: number,
    gravity: THREE.Vector3,
    biases: IMUBiases
  ): VIOOptimizationResult {
    return {
      scale,
      gravityDirection: gravity.clone(),
      biases: {
        accelerometerBias: biases.accelerometerBias.clone(),
        gyroscopeBias: biases.gyroscopeBias.clone(),
      },
      poses: new Map(),
      velocities: new Map(),
      cost: 0,
      converged: true,
    };
  }

  /**
   * Update camera intrinsics
   */
  public updateIntrinsics(intrinsics: CameraIntrinsics): void {
    this.intrinsics = intrinsics;
  }

  /**
   * Update options
   */
  public updateOptions(options: Partial<VisualInertialOptimizerOptions>): void {
    if (options.maxIterations !== undefined) {
      this.maxIterations = options.maxIterations;
    }
    if (options.convergenceThreshold !== undefined) {
      this.convergenceThreshold = options.convergenceThreshold;
    }
    if (options.reprojectionWeight !== undefined) {
      this.reprojectionWeight = options.reprojectionWeight;
    }
    if (options.imuWeight !== undefined) {
      this.imuWeight = options.imuWeight;
    }
    if (options.biasPriorWeight !== undefined) {
      this.biasPriorWeight = options.biasPriorWeight;
    }
    if (options.huberThreshold !== undefined) {
      this.huberThreshold = options.huberThreshold;
    }
    if (options.gravityMagnitude !== undefined) {
      this.gravityMagnitude = options.gravityMagnitude;
    }
    if (options.minScale !== undefined) {
      this.minScale = options.minScale;
    }
    if (options.maxScale !== undefined) {
      this.maxScale = options.maxScale;
    }
  }

  /**
   * Reset state
   */
  public reset(): void {
    // No internal state to reset
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.reset();
  }
}

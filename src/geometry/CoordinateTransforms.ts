import * as THREE from "three";
import { Point3D, CameraParameters } from "../types/core";

export class CoordinateTransforms {
  static backProjectPoints(points: Point3D[], cameraParams?: CameraParameters): Point3D[] {
    // Default camera parameters if not provided
    const defaultParams: CameraParameters = {
      fx: 500, // Default focal length
      fy: 500,
      cx: 320, // Default principal point (assuming 640x480)
      cy: 240,
      width: 640,
      height: 480,
    };

    const params = cameraParams || defaultParams;

    return points.map(point => {
      // Convert from pixel coordinates to normalized camera coordinates
      const x_norm = (point.x - params.cx) / params.fx;
      const y_norm = (point.y - params.cy) / params.fy;
      
      // Back-project using depth (z) to get 3D coordinates
      return {
        x: x_norm * point.z,
        y: y_norm * point.z,
        z: point.z,
        id: point.id,
      };
    });
  }

  static worldToCamera(points: Point3D[], transformation: THREE.Matrix4): Point3D[] {
    return points.map(point => {
      const worldPoint = new THREE.Vector3(point.x, point.y, point.z);
      const cameraPoint = worldPoint.applyMatrix4(transformation);
      
      return {
        x: cameraPoint.x,
        y: cameraPoint.y,
        z: cameraPoint.z,
        id: point.id,
      };
    });
  }

  static cameraToWorld(points: Point3D[], transformation: THREE.Matrix4): Point3D[] {
    const inverseTransform = transformation.clone().invert();
    return this.worldToCamera(points, inverseTransform);
  }

  static projectToImagePlane(points: Point3D[], cameraParams: CameraParameters): Point3D[] {
    return points.map(point => {
      if (point.z <= 0) {
        // Point is behind camera
        return {
          x: -1,
          y: -1,
          z: point.z,
          id: point.id,
        };
      }

      const x_proj = (point.x / point.z) * cameraParams.fx + cameraParams.cx;
      const y_proj = (point.y / point.z) * cameraParams.fy + cameraParams.cy;

      return {
        x: x_proj,
        y: y_proj,
        z: point.z,
        id: point.id,
      };
    });
  }

  static computeTransformMatrix(
    position: THREE.Vector3,
    rotation: THREE.Quaternion,
    scale: THREE.Vector3 = new THREE.Vector3(1, 1, 1)
  ): THREE.Matrix4 {
    const matrix = new THREE.Matrix4();
    matrix.compose(position, rotation, scale);
    return matrix;
  }

  static decomposeTransformMatrix(matrix: THREE.Matrix4): {
    position: THREE.Vector3;
    rotation: THREE.Quaternion;
    scale: THREE.Vector3;
  } {
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    
    matrix.decompose(position, rotation, scale);
    
    return { position, rotation, scale };
  }
}
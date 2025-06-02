import * as THREE from "three";
import { EventEmitter } from "../utils/EventEmitter";
import { PlaneEstimationResult, Point2D } from "../types/core";
import { RenderingConfig } from "../types/configuration";

export class Renderer extends EventEmitter {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private config: RenderingConfig;
  private canvas: HTMLCanvasElement;
  private currentPlaneGroup: THREE.Group | null = null;

  constructor(config: RenderingConfig) {
    super();
    this.config = config;
    this.initialize();
  }

  private initialize(): void {
    // Create Three.js canvas
    this.canvas = document.createElement("canvas");
    this.canvas.id = "threeCanvas";
    this.canvas.style.position = "absolute";
    this.canvas.style.top = "0";
    this.canvas.style.left = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.pointerEvents = "none";
    this.canvas.style.zIndex = "5";
    document.body.appendChild(this.canvas);

    // Initialize Three.js components
    this.scene = new THREE.Scene();
    
    this.camera = new THREE.PerspectiveCamera(
      this.config.camera.fov,
      this.config.width / this.config.height,
      this.config.camera.near,
      this.config.camera.far
    );

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
    });
    
    this.renderer.setSize(this.config.width, this.config.height);
    this.renderer.setClearColor(0x000000, 0);

    // Set initial camera position
    this.camera.position.z = 3;

    // Handle window resize
    this.setupResizeHandler();
  }

  private setupResizeHandler(): void {
    window.addEventListener("resize", () => {
      this.camera.aspect = this.config.width / this.config.height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.config.width, this.config.height);
    });
  }

  renderPlane(result: PlaneEstimationResult): void {
    try {
      // Remove existing plane if any
      if (this.currentPlaneGroup) {
        this.scene.remove(this.currentPlaneGroup);
        this.disposePlaneGroup(this.currentPlaneGroup);
      }

      // Create new plane geometry
      this.currentPlaneGroup = this.createPlaneGeometry(result);
      this.scene.add(this.currentPlaneGroup);

      // Adjust mesh transform and positioning
      this.adjustMeshTransform(this.currentPlaneGroup, result);

      // Render the scene
      this.render();

      this.emit("rendered", result);
    } catch (error) {
      console.error("Plane rendering error:", error);
      this.emit("error", error);
    }
  }

  private createPlaneGeometry(result: PlaneEstimationResult): THREE.Group {
    const group = new THREE.Group();

    // Calculate bounding box from hull2D
    const us = result.hull2D.map(p => p.u);
    const vs = result.hull2D.map(p => p.v);
    const minU = Math.min(...us);
    const maxU = Math.max(...us);
    const minV = Math.min(...vs);
    const maxV = Math.max(...vs);
    
    const planeWidth = maxU - minU;
    const planeHeight = maxV - minV;

    // Create basic plane geometry
    const planeGeom = new THREE.PlaneGeometry(planeWidth, planeHeight);
    const planeMat = new THREE.MeshBasicMaterial({
      color: this.config.planeMaterial.color,
      opacity: this.config.planeMaterial.opacity,
      transparent: this.config.planeMaterial.transparent,
      side: THREE.DoubleSide,
    });
    const planeMesh = new THREE.Mesh(planeGeom, planeMat);
    group.add(planeMesh);

    // Create convex hull shape geometry
    if (result.hull2D.length >= 3) {
      const shape = new THREE.Shape(
        result.hull2D.map(p => new THREE.Vector2(p.u, p.v))
      );
      const shapeGeom = new THREE.ShapeGeometry(shape);
      const shapeMat = new THREE.MeshBasicMaterial({
        color: this.config.shapeMaterial.color,
        opacity: this.config.shapeMaterial.opacity,
        transparent: this.config.shapeMaterial.transparent,
        side: THREE.DoubleSide,
      });
      const shapeMesh = new THREE.Mesh(shapeGeom, shapeMat);
      group.add(shapeMesh);
    }

    return group;
  }

  private adjustMeshTransform(group: THREE.Group, result: PlaneEstimationResult): void {
    // Calculate plane center from hull2D
    const us = result.hull2D.map(p => p.u);
    const vs = result.hull2D.map(p => p.v);
    const midU = (Math.min(...us) + Math.max(...us)) / 2;
    const midV = (Math.min(...vs) + Math.max(...vs)) / 2;

    // Calculate center in 3D space
    const center = new THREE.Vector3();
    result.hull3D.forEach(p => center.add(new THREE.Vector3(p.x, p.y, p.z)));
    center.divideScalar(result.hull3D.length);

    // Calculate plane center in camera space
    const planeCenterCS = new THREE.Vector3()
      .copy(new THREE.Vector3(result.P0.x, result.P0.y, result.P0.z))
      .add(result.uVec.clone().multiplyScalar(midU))
      .add(result.vVec.clone().multiplyScalar(midV));

    // Transform to world space
    const copyCamera = this.camera.clone();
    copyCamera.position.z = 0;
    const centerWS = copyCamera.localToWorld(center.clone());

    // Set group position
    group.position.copy(centerWS);

    // Create rotation matrix from basis vectors
    const worldU = result.uVec.clone().normalize().applyQuaternion(copyCamera.quaternion);
    const worldV = result.vVec.clone().normalize().applyQuaternion(copyCamera.quaternion);
    const worldN = result.normal.clone().normalize().applyQuaternion(copyCamera.quaternion);

    const basis = new THREE.Matrix4().makeBasis(worldU, worldV, worldN);

    // Apply 90-degree rotation around X-axis
    const rotationX = new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(90));
    basis.multiply(rotationX);

    // Apply rotation to group
    group.setRotationFromMatrix(basis);

    // Adjust camera position to view the plane
    const distance = group.position.length();
    this.setCameraPosition(0, 0, Math.max(distance * 2, 3));
  }

  private disposePlaneGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.geometry) {
          child.geometry.dispose();
        }
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(material => material.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  setCameraPosition(x: number, y: number, z: number): void {
    this.camera.position.set(x, y, z);
  }

  updateConfig(config: Partial<RenderingConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (config.width || config.height) {
      this.camera.aspect = this.config.width / this.config.height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.config.width, this.config.height);
    }

    if (config.camera) {
      this.camera.fov = this.config.camera.fov;
      this.camera.near = this.config.camera.near;
      this.camera.far = this.config.camera.far;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    // Clean up existing plane
    if (this.currentPlaneGroup) {
      this.scene.remove(this.currentPlaneGroup);
      this.disposePlaneGroup(this.currentPlaneGroup);
    }

    // Remove canvas from DOM
    if (this.canvas && this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }

    // Dispose Three.js resources
    this.renderer.dispose();
    this.scene.clear();

    this.removeAllListeners();
  }
}
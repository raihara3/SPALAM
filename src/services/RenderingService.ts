import * as THREE from "three";
import {
  RenderingMode,
  PostProcessingEffect,
  ShadowMapType,
  RenderingConfig,
  LightConfig,
  MaterialConfig,
  RenderingStats,
} from "../types/RenderingTypes";

/**
 * レンダリングサービス
 * Three.jsの高度な機能を管理
 */
export class RenderingService {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private config: RenderingConfig;

  // パフォーマンス計測
  private stats: RenderingStats = {
    fps: 0,
    frameTime: 0,
    drawCalls: 0,
    triangles: 0,
    textureMemory: 0,
    geometryMemory: 0,
  };

  private lastFrameTime: number = 0;
  private frameCount: number = 0;
  private fpsUpdateTime: number = 0;

  // LODマネージャー
  private lodObjects: Map<string, THREE.LOD> = new Map();

  // インスタンスマネージャー
  private instancedMeshes: Map<string, THREE.InstancedMesh> = new Map();

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    config: RenderingConfig
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.config = config;

    this.applyConfig();
  }

  /**
   * 設定を適用
   */
  private applyConfig(): void {
    // レンダラー設定
    this.renderer.setPixelRatio(this.config.pixelRatio);
    this.renderer.setClearColor(this.config.clearColor, this.config.clearAlpha);
    // this.renderer.antialias = this.config.antialias; // 読み取り専用

    // シャドウ設定
    this.configureShadows();

    // ポストプロセッシング設定
    if (this.config.postProcessing.enabled) {
      this.setupPostProcessing();
    }
  }

  /**
   * シャドウ設定
   */
  private configureShadows(): void {
    const shadowConfig = this.config.shadows;

    this.renderer.shadowMap.enabled = shadowConfig.enabled;

    if (shadowConfig.enabled) {
      switch (shadowConfig.type) {
        case ShadowMapType.BASIC:
          this.renderer.shadowMap.type = THREE.BasicShadowMap;
          break;
        case ShadowMapType.PCF:
          this.renderer.shadowMap.type = THREE.PCFShadowMap;
          break;
        case ShadowMapType.PCF_SOFT:
          this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          break;
        case ShadowMapType.VSM:
          this.renderer.shadowMap.type = THREE.VSMShadowMap;
          break;
      }
    }
  }

  /**
   * ポストプロセッシング設定
   */
  private setupPostProcessing(): void {
    // ポストプロセッシング効果の設定
    // 注: 実際の実装では、three/examples/jsm/postprocessing を使用
    const effects = this.config.postProcessing.effects;

    effects.forEach((effect) => {
      switch (effect) {
        case PostProcessingEffect.ANTIALIASING:
          // FXAAやSMAAの設定
          break;
        case PostProcessingEffect.BLOOM:
          // ブルーム効果の設定
          break;
        case PostProcessingEffect.DEPTH_OF_FIELD:
          // 被写界深度の設定
          break;
        case PostProcessingEffect.SSAO:
          // SSAOの設定
          break;
        case PostProcessingEffect.TONE_MAPPING:
          // トーンマッピングの設定
          this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
          this.renderer.toneMappingExposure = 1.0;
          break;
      }
    });
  }

  /**
   * ライトを設定
   */
  public setupLights(lightConfig: LightConfig): void {
    // 既存のライトを削除
    const existingLights = this.scene.children.filter(
      (child) => child instanceof THREE.Light
    );
    existingLights.forEach((light) => this.scene.remove(light));

    // 環境光
    if (lightConfig.ambient.enabled) {
      const ambientLight = new THREE.AmbientLight(
        lightConfig.ambient.color,
        lightConfig.ambient.intensity
      );
      this.scene.add(ambientLight);
    }

    // 平行光源
    if (lightConfig.directional.enabled) {
      const directionalLight = new THREE.DirectionalLight(
        lightConfig.directional.color,
        lightConfig.directional.intensity
      );
      directionalLight.position.set(
        lightConfig.directional.position.x,
        lightConfig.directional.position.y,
        lightConfig.directional.position.z
      );
      directionalLight.castShadow = lightConfig.directional.castShadow;

      if (directionalLight.castShadow) {
        directionalLight.shadow.mapSize.width = this.config.shadows.resolution;
        directionalLight.shadow.mapSize.height = this.config.shadows.resolution;
        directionalLight.shadow.camera.near = 0.1;
        directionalLight.shadow.camera.far = 100;
        directionalLight.shadow.camera.left = -10;
        directionalLight.shadow.camera.right = 10;
        directionalLight.shadow.camera.top = 10;
        directionalLight.shadow.camera.bottom = -10;
      }

      this.scene.add(directionalLight);
    }

    // ポイントライト
    lightConfig.points.forEach((pointConfig) => {
      const pointLight = new THREE.PointLight(
        pointConfig.color,
        pointConfig.intensity,
        pointConfig.distance,
        pointConfig.decay
      );
      pointLight.position.set(
        pointConfig.position.x,
        pointConfig.position.y,
        pointConfig.position.z
      );
      this.scene.add(pointLight);
    });

    // スポットライト
    lightConfig.spots.forEach((spotConfig) => {
      const spotLight = new THREE.SpotLight(
        spotConfig.color,
        spotConfig.intensity,
        spotConfig.distance,
        spotConfig.angle,
        spotConfig.penumbra,
        spotConfig.decay
      );
      spotLight.position.set(
        spotConfig.position.x,
        spotConfig.position.y,
        spotConfig.position.z
      );
      spotLight.target.position.set(
        spotConfig.target.x,
        spotConfig.target.y,
        spotConfig.target.z
      );
      this.scene.add(spotLight);
      this.scene.add(spotLight.target);
    });
  }

  /**
   * マテリアルを作成
   */
  public createMaterial(config: MaterialConfig): THREE.Material {
    let material: THREE.Material;

    switch (config.type) {
      case "basic":
        material = new THREE.MeshBasicMaterial({
          color: config.base.color,
          opacity: config.base.opacity,
          transparent: config.base.transparent,
          side: this.getMaterialSide(config.base.side),
        });
        break;

      case "standard":
        material = new THREE.MeshStandardMaterial({
          color: config.base.color,
          opacity: config.base.opacity,
          transparent: config.base.transparent,
          side: this.getMaterialSide(config.base.side),
          metalness: config.pbr?.metalness || 0,
          roughness: config.pbr?.roughness || 1,
          emissive: config.pbr?.emissive || 0x000000,
          emissiveIntensity: config.pbr?.emissiveIntensity || 1,
        });
        break;

      case "phong":
        material = new THREE.MeshPhongMaterial({
          color: config.base.color,
          opacity: config.base.opacity,
          transparent: config.base.transparent,
          side: this.getMaterialSide(config.base.side),
          emissive: config.pbr?.emissive || 0x000000,
          emissiveIntensity: config.pbr?.emissiveIntensity || 1,
        });
        break;

      case "physical":
        material = new THREE.MeshPhysicalMaterial({
          color: config.base.color,
          opacity: config.base.opacity,
          transparent: config.base.transparent,
          side: this.getMaterialSide(config.base.side),
          metalness: config.pbr?.metalness || 0,
          roughness: config.pbr?.roughness || 1,
          emissive: config.pbr?.emissive || 0x000000,
          emissiveIntensity: config.pbr?.emissiveIntensity || 1,
        });
        break;

      case "shader":
        if (config.shader) {
          material = new THREE.ShaderMaterial({
            vertexShader: config.shader.vertexShader,
            fragmentShader: config.shader.fragmentShader,
            uniforms: config.shader.uniforms,
            transparent: config.base.transparent,
            side: this.getMaterialSide(config.base.side),
          });
        } else {
          // フォールバック
          material = new THREE.MeshBasicMaterial({
            color: config.base.color,
          });
        }
        break;

      default:
        material = new THREE.MeshBasicMaterial({
          color: config.base.color,
        });
    }

    return material;
  }

  /**
   * マテリアルサイドを取得
   */
  private getMaterialSide(side: "front" | "back" | "double"): THREE.Side {
    switch (side) {
      case "front":
        return THREE.FrontSide;
      case "back":
        return THREE.BackSide;
      case "double":
        return THREE.DoubleSide;
      default:
        return THREE.FrontSide;
    }
  }

  /**
   * LODオブジェクトを作成
   */
  public createLOD(
    id: string,
    levels: Array<{
      geometry: THREE.BufferGeometry;
      material: THREE.Material;
      distance: number;
    }>
  ): THREE.LOD {
    const lod = new THREE.LOD();

    levels.forEach((level) => {
      const mesh = new THREE.Mesh(level.geometry, level.material);
      lod.addLevel(mesh, level.distance);
    });

    this.lodObjects.set(id, lod);
    return lod;
  }

  /**
   * インスタンスメッシュを作成
   */
  public createInstancedMesh(
    id: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    count: number
  ): THREE.InstancedMesh {
    const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.instancedMeshes.set(id, instancedMesh);
    return instancedMesh;
  }

  /**
   * インスタンスを更新
   */
  public updateInstance(
    id: string,
    index: number,
    position: THREE.Vector3,
    rotation: THREE.Euler,
    scale: THREE.Vector3
  ): void {
    const instancedMesh = this.instancedMeshes.get(id);
    if (!instancedMesh) return;

    const matrix = new THREE.Matrix4();
    matrix.compose(
      position,
      new THREE.Quaternion().setFromEuler(rotation),
      scale
    );
    instancedMesh.setMatrixAt(index, matrix);
    instancedMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * フラスタムカリングを実行
   */
  private performFrustumCulling(): void {
    if (!this.config.performance.frustumCulling) return;

    const frustum = new THREE.Frustum();
    const matrix = new THREE.Matrix4().multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    frustum.setFromProjectionMatrix(matrix);

    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.visible = frustum.intersectsObject(object);
      }
    });
  }

  /**
   * レンダリング統計を更新
   */
  private updateStats(): void {
    const now = performance.now();
    const deltaTime = now - this.lastFrameTime;
    this.lastFrameTime = now;

    this.frameCount++;
    this.stats.frameTime = deltaTime;

    // FPS計算（1秒ごと）
    if (now - this.fpsUpdateTime > 1000) {
      this.stats.fps = this.frameCount;
      this.frameCount = 0;
      this.fpsUpdateTime = now;
    }

    // レンダリング情報
    const info = this.renderer.info;
    this.stats.drawCalls = info.render.calls;
    this.stats.triangles = info.render.triangles;
    this.stats.textureMemory = info.memory.textures;
    this.stats.geometryMemory = info.memory.geometries;
  }

  /**
   * レンダリングモードを設定
   */
  public setRenderingMode(mode: RenderingMode): void {
    this.config.mode = mode;

    // すべてのメッシュのマテリアルを更新
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const material = object.material as THREE.Material;

        switch (mode) {
          case RenderingMode.WIREFRAME:
            if ("wireframe" in material) {
              (material as THREE.MeshBasicMaterial).wireframe = true;
            }
            break;

          case RenderingMode.POINT_CLOUD:
            // ポイントクラウドモードの実装
            break;

          case RenderingMode.STANDARD:
          default:
            if ("wireframe" in material) {
              (material as THREE.MeshBasicMaterial).wireframe = false;
            }
            break;
        }
      }
    });
  }

  /**
   * 最適化されたレンダリング
   */
  public render(): void {
    // フラスタムカリング
    this.performFrustumCulling();

    // LOD更新
    this.lodObjects.forEach((lod) => {
      lod.update(this.camera);
    });

    // 統計更新
    this.updateStats();

    // レンダリング
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * 統計情報を取得
   */
  public getStats(): RenderingStats {
    return { ...this.stats };
  }

  /**
   * 設定を更新
   */
  public updateConfig(config: Partial<RenderingConfig>): void {
    this.config = { ...this.config, ...config };
    this.applyConfig();
  }

  /**
   * リソースをクリーンアップ
   */
  public dispose(): void {
    // LODオブジェクトのクリーンアップ
    this.lodObjects.forEach((lod) => {
      lod.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    });
    this.lodObjects.clear();

    // インスタンスメッシュのクリーンアップ
    this.instancedMeshes.forEach((mesh) => {
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material.dispose();
      }
    });
    this.instancedMeshes.clear();
  }
}

import * as THREE from "three";
import { FeatureDetector, Feature } from "./FeatureDetector";

export class ARRenderer {
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private threeCanvas: HTMLCanvasElement;
  private featureDetector: FeatureDetector | null = null;
  private trackedFeature: Feature | null = null;
  private initialAverageDistance: number | null = null; // 初期状態の特徴点間の平均距離

  // Three.js関連
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private cube!: THREE.Mesh;

  constructor(private readonly cv: any) {
    this.video = document.getElementById("camera") as HTMLVideoElement;
    this.canvas = document.getElementById("output") as HTMLCanvasElement;
    this.ctx = this.canvas.getContext("2d")!;

    // Three.js用の新しいcanvasを作成
    this.threeCanvas = document.createElement("canvas");
    this.threeCanvas.style.position = "absolute";
    this.threeCanvas.style.top = "0";
    this.threeCanvas.style.left = "0";
    this.threeCanvas.style.width = "100%";
    this.threeCanvas.style.height = "100%";
    this.threeCanvas.style.pointerEvents = "none";
    document.body.appendChild(this.threeCanvas);

    // Three.jsの初期化
    this.initThreeJS();
  }

  private initThreeJS(): void {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.threeCanvas,
      alpha: true,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000000, 0);

    // 立方体の各面に異なる色を設定
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const materials = [
      new THREE.MeshBasicMaterial({ color: 0xff0000 }), // 右面 - 赤
      new THREE.MeshBasicMaterial({ color: 0x00ff00 }), // 左面 - 緑
      new THREE.MeshBasicMaterial({ color: 0x0000ff }), // 上面 - 青
      new THREE.MeshBasicMaterial({ color: 0xffff00 }), // 下面 - 黄
      new THREE.MeshBasicMaterial({ color: 0x00ffff }), // 前面 - シアン
      new THREE.MeshBasicMaterial({ color: 0xff00ff }), // 後面 - マゼンタ
    ];
    // materialを半透明にする
    materials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.7;
    });

    this.cube = new THREE.Mesh(geometry, materials);
    this.scene.add(this.cube);

    // カメラを固定位置に配置
    this.camera.position.z = 5;

    // ウィンドウサイズ変更時のイベントリスナー
    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  public async initialize(): Promise<void> {
    try {
      await this.initCamera();
      this.featureDetector = new FeatureDetector(this.cv);
      this.startRendering();
    } catch (error) {
      console.error("Initialization error:", error);
    }
  }

  private async initCamera(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    this.video.srcObject = stream;

    // videoのメタデータロード完了を待つ
    await new Promise<void>((resolve) => {
      this.video.onloadedmetadata = () => {
        this.video.width = this.video.videoWidth;
        this.video.height = this.video.videoHeight;
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        resolve();
      };
    });

    await this.video.play();
  }

  private isFeatureValid(feature: Feature): boolean {
    // 特徴点が画面内にあるかチェック
    return (
      feature.x >= 0 &&
      feature.x <= this.canvas.width &&
      feature.y >= 0 &&
      feature.y <= this.canvas.height &&
      feature.trackingCount >= 3
    ); // 安定して追跡できているか
  }

  private findNearestStableFeature(features: Feature[]): Feature | null {
    // 現在追跡中の特徴点がある場合、その特徴点を探す
    if (this.trackedFeature) {
      const currentFeature = features.find(
        (f) => f.id === this.trackedFeature!.id && this.isFeatureValid(f)
      );
      if (currentFeature) {
        return currentFeature; // 追跡中の特徴点が見つかった場合はそれを返す
      }
      this.trackedFeature = null; // 特徴点が見つからなかった場合はリセット
    }

    // 新しい特徴点を探す
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;
    let nearestFeature: Feature | null = null;
    let minDistance = Infinity;

    features.forEach((feature) => {
      if (this.isFeatureValid(feature)) {
        const distance = Math.sqrt(
          Math.pow(feature.x - centerX, 2) + Math.pow(feature.y - centerY, 2)
        );
        if (distance < minDistance) {
          minDistance = distance;
          nearestFeature = feature;
        }
      }
    });

    if (nearestFeature) {
      this.trackedFeature = nearestFeature; // 新しい特徴点の追跡を開始
    }

    return nearestFeature;
  }

  private updateCubePosition(feature: Feature, scale: number): void {
    // キャンバスの座標系をThree.jsの座標系に変換
    // キャンバスの中心を(0,0)とする
    const canvasAspectRatio = this.canvas.width / this.canvas.height;
    const fov = this.camera.fov * (Math.PI / 180);
    const viewportHeight =
      2 * Math.tan(fov / 2) * Math.abs(this.camera.position.z);
    const viewportWidth = viewportHeight * this.camera.aspect;

    // featureを黄色で描画する
    this.ctx.fillStyle = "#FFFF00";
    this.ctx.beginPath();
    this.ctx.arc(feature.x, feature.y, 5, 0, 2 * Math.PI);
    this.ctx.fill();

    // 特徴点の座標を正規化（-1 to 1）
    const normalizedX = (feature.x / this.canvas.width) * 2 - 1;
    const normalizedY = -(feature.y / this.canvas.height) * 2 + 1;

    // 視野角とアスペクト比を考慮してスケーリング
    const worldX = normalizedX * (viewportWidth / 2);
    const worldY = normalizedY * (viewportHeight / 2);

    // キューブの位置を更新
    this.cube.position.x = worldX;
    this.cube.position.y = worldY;
    this.cube.position.z = 0;

    // スケールを適用
    this.cube.scale.set(scale, scale, scale);
  }

  private calculateAverageFeatureDistance(features: Feature[]): number {
    const validFeatures = features.filter((f) => this.isFeatureValid(f));
    if (validFeatures.length < 2) return 0;

    let totalDistance = 0;
    let pairCount = 0;

    // 全ての有効な特徴点ペアの距離を計算
    for (let i = 0; i < validFeatures.length; i++) {
      for (let j = i + 1; j < validFeatures.length; j++) {
        const distance = Math.sqrt(
          Math.pow(validFeatures[i].x - validFeatures[j].x, 2) +
            Math.pow(validFeatures[i].y - validFeatures[j].y, 2)
        );
        totalDistance += distance;
        pairCount++;
      }
    }

    return pairCount > 0 ? totalDistance / pairCount : 0;
  }

  private processFeatures(features: Feature[]): void {
    // 特徴点の描画
    features.forEach(({ x, y, trackingCount }) => {
      this.ctx.fillStyle = trackingCount >= 3 ? "#FF0000" : "#000000";
      this.ctx.beginPath();
      this.ctx.arc(x, y, 3, 0, 2 * Math.PI);
      this.ctx.fill();
    });

    // 平均距離を計算
    const currentAverageDistance =
      this.calculateAverageFeatureDistance(features);

    // 初期状態の距離を保存
    if (this.initialAverageDistance === null && currentAverageDistance > 0) {
      this.initialAverageDistance = currentAverageDistance;
      console.log("Initial average distance set:", this.initialAverageDistance);
    }

    // 距離の比率を計算して出力
    let scale = 1;
    if (this.initialAverageDistance && this.initialAverageDistance > 0) {
      const distanceRatio =
        currentAverageDistance / this.initialAverageDistance;
      scale = Number(distanceRatio.toFixed(2));
      console.log("Distance ratio:", distanceRatio.toFixed(2));
    }

    // キューブの位置更新
    const nearestFeature = this.findNearestStableFeature(features);
    if (nearestFeature) {
      this.updateCubePosition(nearestFeature, scale);
    }
  }

  private render(): void {
    // カメラ映像を描画
    this.ctx.drawImage(this.video, 0, 0);

    // 特徴点検出と描画
    if (this.featureDetector) {
      try {
        const features = this.featureDetector.detectAndTrackFeatures(
          this.canvas
        );
        this.processFeatures(features);
      } catch (error) {
        console.error("OpenCV processing error:", error);
      }
    }

    // Three.jsのレンダリング更新
    this.renderer.render(this.scene, this.camera);

    requestAnimationFrame(() => this.render());
  }

  private startRendering(): void {
    this.render();
  }
}

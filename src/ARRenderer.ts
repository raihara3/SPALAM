import * as THREE from "three";

export class ARRenderer {
  private threeCanvas: HTMLCanvasElement;

  // Three.js関連
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;

  constructor() {
    // this.video = document.getElementById("camera") as HTMLVideoElement;
    // this.canvas = document.getElementById("output") as HTMLCanvasElement;
    // this.ctx = this.canvas.getContext("2d")!;

    // Three.js用の新しいcanvasを作成
    this.threeCanvas = document.createElement("canvas");
    this.threeCanvas.id = "threeCanvas";
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
    // カメラを固定位置に配置
    // TODO: カメラの位置を調整する
    // this.camera.position.x = -0.5;
    this.camera.position.z = 5;

    // ウィンドウサイズ変更時のイベントリスナー
    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

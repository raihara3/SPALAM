/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";

export class ARRenderer {
  private width: number;
  private height: number;

  private threeCanvas: HTMLCanvasElement;

  // Three.js関連
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;

  constructor({ width, height }: { width: number; height: number }) {
    this.width = width;
    this.height = height;
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
      this.width / this.height,
      0.1,
      1000
    );

    // モバイル端末検出
    const isMobile =
      /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      );

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.threeCanvas,
      alpha: true,
      antialias: !isMobile, // モバイルではアンチエイリアスを無効化してパフォーマンス向上
      powerPreference: isMobile ? "low-power" : "high-performance",
      precision: isMobile ? "mediump" : "highp", // モバイルでは精度を下げて安定性向上
    });

    // デバイスピクセル比の設定（モバイルで重要）
    const pixelRatio = Math.min(window.devicePixelRatio, isMobile ? 2 : 3);
    this.renderer.setPixelRatio(pixelRatio);

    this.renderer.setSize(this.width, this.height);
    this.renderer.setClearColor(0x000000, 0);

    console.log(
      `ARRenderer initialized for ${isMobile ? "mobile" : "desktop"} with pixel ratio: ${pixelRatio}`
    );
    // カメラを固定位置に配置
    // TODO: カメラの位置を調整する
    // this.camera.position.x = -0.5;
    this.camera.position.z = 0;

    // ウィンドウサイズ変更時のイベントリスナー
    window.addEventListener("resize", this.resizeHandler);
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

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * リソースを解放
   */
  dispose(): void {
    // シーン内のメッシュやマテリアルを解放
    this.scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => material.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    // レンダラーを解放
    this.renderer.dispose();

    // canvasをDOMから削除
    if (this.threeCanvas.parentNode) {
      this.threeCanvas.parentNode.removeChild(this.threeCanvas);
    }

    // イベントリスナーを削除
    window.removeEventListener("resize", this.resizeHandler);
  }

  private resizeHandler = () => {
    // 現在のウィンドウサイズを取得
    const newWidth = window.innerWidth;
    const newHeight = window.innerHeight;

    // カメラのアスペクト比を更新
    this.camera.aspect = newWidth / newHeight;
    this.camera.updateProjectionMatrix();

    // レンダラーのサイズを更新
    this.renderer.setSize(newWidth, newHeight);

    // 内部の幅・高さを更新
    this.width = newWidth;
    this.height = newHeight;

    console.log(`ARRenderer resized to: ${newWidth}x${newHeight}`);
  };
}

import * as THREE from 'three';
import { FeatureDetector, Feature } from './FeatureDetector';

export class ARRenderer {
    private video: HTMLVideoElement;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private threeCanvas: HTMLCanvasElement;
    private featureDetector: FeatureDetector | null = null;
    
    // Three.js関連
    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private renderer!: THREE.WebGLRenderer;
    private cube!: THREE.Mesh;

    constructor(private readonly cv: any) {
        this.video = document.getElementById('camera') as HTMLVideoElement;
        this.canvas = document.getElementById('output') as HTMLCanvasElement;
        this.ctx = this.canvas.getContext('2d')!;
        
        // Three.js用の新しいcanvasを作成
        this.threeCanvas = document.createElement('canvas');
        this.threeCanvas.style.position = 'absolute';
        this.threeCanvas.style.top = '0';
        this.threeCanvas.style.left = '0';
        this.threeCanvas.style.width = '100%';
        this.threeCanvas.style.height = '100%';
        this.threeCanvas.style.pointerEvents = 'none';
        document.body.appendChild(this.threeCanvas);
        
        // Three.jsの初期化
        this.initThreeJS();
    }

    private initThreeJS(): void {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        
        // 新しいcanvasを使用してレンダラーを初期化
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.threeCanvas,
            alpha: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000000, 0);
        
        // 立方体の各面に異なる色を設定
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const materials = [
            new THREE.MeshBasicMaterial({ color: 0xff0000 }), // 右面 (positive X) - 赤
            new THREE.MeshBasicMaterial({ color: 0x00ff00 }), // 左面 (negative X) - 緑
            new THREE.MeshBasicMaterial({ color: 0x0000ff }), // 上面 (positive Y) - 青
            new THREE.MeshBasicMaterial({ color: 0xffff00 }), // 下面 (negative Y) - 黄
            new THREE.MeshBasicMaterial({ color: 0x00ffff }), // 前面 (positive Z) - シアン
            new THREE.MeshBasicMaterial({ color: 0xff00ff })  // 後面 (negative Z) - マゼンタ
        ];
        
        this.cube = new THREE.Mesh(geometry, materials);
        this.scene.add(this.cube);
        
        this.camera.position.z = 5;

        // ウィンドウサイズ変更時のイベントリスナー
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // デバイスの向きイベントのリスナーを追加
        this.initDeviceOrientation();
    }

    private initDeviceOrientation(): void {
        // デバイスのモーションセンサーが利用可能かチェック
        if (window.DeviceOrientationEvent) {
            // iOSの場合は許可が必要
            if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
                // ユーザーインタラクションが必要なため、ボタンを作成
                const button = document.createElement('button');
                button.textContent = 'モーションセンサーを有効にする';
                button.style.position = 'fixed';
                button.style.bottom = '20px';
                button.style.left = '50%';
                button.style.transform = 'translateX(-50%)';
                button.style.padding = '10px';
                button.style.zIndex = '1000';
                document.body.appendChild(button);

                button.onclick = async () => {
                    try {
                        const response = await (DeviceOrientationEvent as any).requestPermission();
                        if (response === 'granted') {
                            this.startDeviceOrientationListener();
                            button.style.display = 'none';
                        }
                    } catch (error) {
                        console.error('モーションセンサーの許可が得られませんでした:', error);
                    }
                };
            } else {
                // Android等、許可が不要な場合は直接リスナーを開始
                this.startDeviceOrientationListener();
            }
        } else {
            console.log('デバイスのモーションセンサーは利用できません。自動回転を継続します。');
        }
    }

    private startDeviceOrientationListener(): void {
        window.addEventListener('deviceorientation', (event: DeviceOrientationEvent) => {
            if (event.beta === null || event.gamma === null || event.alpha === null) return;

            // デバイスの向きを角度（ラジアン）に変換
            const x = THREE.MathUtils.degToRad(-event.beta + 90); // 前後の傾きを90度手前に倒す
            const y = THREE.MathUtils.degToRad(event.gamma); // 左右の傾き
            const z = THREE.MathUtils.degToRad(event.alpha); // 水平面での回転

            // カメラの位置を更新
            const distance = 5; // カメラと立方体の距離
            this.camera.position.x = distance * Math.sin(y);
            this.camera.position.y = distance * Math.sin(x);
            this.camera.position.z = distance * Math.cos(x) * Math.cos(y);

            // カメラを立方体の中心に向ける
            this.camera.lookAt(new THREE.Vector3(0, 0, 0));
        });
    }

    public async initialize(): Promise<void> {
        try {
            await this.initCamera();
            this.featureDetector = new FeatureDetector(this.cv);
            this.startRendering();
        } catch (error) {
            console.error('Initialization error:', error);
        }
    }

    private async initCamera(): Promise<void> {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
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

    private processFeatures(features: Feature[]): void {
        features.forEach(({ x, y, trackingCount }) => {
            this.ctx.fillStyle = trackingCount >= 3 ? '#FF0000' : '#000000';
            this.ctx.beginPath();
            this.ctx.arc(x, y, 3, 0, 2 * Math.PI);
            this.ctx.fill();
        });
    }

    private render(): void {
        // カメラ映像を描画
        this.ctx.drawImage(this.video, 0, 0);

        // 特徴点検出と描画
        if (this.featureDetector) {
            try {
                const features = this.featureDetector.detectAndTrackFeatures(this.canvas);
                this.processFeatures(features);
            } catch (error) {
                console.error('OpenCV processing error:', error);
            }
        }

        // Three.jsのアニメーション更新（自動回転を無効化）
        if (this.cube) {
            // モーションセンサーを使用する場合は自動回転を無効化
            if (!window.DeviceOrientationEvent) {
                this.cube.rotation.x += 0.01;
                this.cube.rotation.y += 0.01;
            }
            this.renderer.render(this.scene, this.camera);
        }

        requestAnimationFrame(() => this.render());
    }

    private startRendering(): void {
        this.render();
    }
}
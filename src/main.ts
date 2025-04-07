import * as THREE from 'three';

// カメラストリームの取得
async function setupCamera() {
  const video = document.querySelector('#camera') as HTMLVideoElement;
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
    audio: false,
  });
  video.srcObject = stream;
  return new Promise<HTMLVideoElement>((resolve) => {
    video.onloadedmetadata = () => {
      resolve(video);
    };
  });
}

// Three.jsのセットアップ
async function init() {
  // カメラストリームのセットアップ
  const video = await setupCamera();
  const videoTexture = new THREE.VideoTexture(video);

  // Three.jsのシーンセットアップ
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const renderer = new THREE.WebGLRenderer({
    canvas: document.querySelector('#canvas') as HTMLCanvasElement,
    alpha: true,
  });

  // 画面サイズの設定
  const resize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
  };
  window.addEventListener('resize', resize);
  resize();

  // カメラ映像を表示するための平面
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.MeshBasicMaterial({ 
    map: videoTexture,
    side: THREE.DoubleSide,
  });
  const plane = new THREE.Mesh(geometry, material);
  scene.add(plane);

  // アニメーションループ
  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();
}

// 初期化の実行
init().catch(console.error);

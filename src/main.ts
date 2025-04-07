import './style.css';
import { FeatureDetector } from './FeatureDetector';

declare const cv: any;
let isOpenCVReady = false;
let featureDetector: FeatureDetector | null = null;

// カメラストリームの初期化と処理開始
async function initCamera() {
  const video = document.getElementById('camera') as HTMLVideoElement;
  const canvas = document.getElementById('output') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;

  try {
    // カメラストリームの取得
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    // ビデオにストリームを設定
    video.srcObject = stream;

    // videoのメタデータロード完了を待つ
    await new Promise<void>((resolve) => {
      video.onloadedmetadata = () => {
        video.width = video.videoWidth;
        video.height = video.videoHeight;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        resolve();
      };
    });

    // ビデオを再生
    await video.play();
    console.log('Video playback started');

    // フレーム処理ループ
    function processFrame() {
      // カメラ映像をcanvasに描画
      ctx.drawImage(video, 0, 0);

      // OpenCVが利用可能であれば特徴点検出を実行
      if (isOpenCVReady && featureDetector) {
        try {
          // 特徴点検出と追跡を実行
          const features = featureDetector.detectAndTrackFeatures(canvas);

          // 検出した特徴点を描画
          features.forEach(({ x, y, trackingCount }) => {
            // 3フレーム以上追跡できた点は赤、それ以外は黒で描画
            ctx.fillStyle = trackingCount >= 3 ? '#FF0000' : '#000000';
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, 2 * Math.PI);
            ctx.fill();
          });
        } catch (error) {
          console.error('OpenCV processing error:', error);
        }
      }

      // 次のフレームを要求
      requestAnimationFrame(processFrame);
    }

    // フレーム処理開始
    processFrame();

  } catch (error) {
    console.error('Error initializing camera:', error);
  }
}

// OpenCVの読み込み完了時のコールバック
(window as any).onOpenCvReady = () => {
  console.log('OpenCV.js is ready');
  isOpenCVReady = true;
  featureDetector = new FeatureDetector(cv);
};

// アプリケーション開始
initCamera();

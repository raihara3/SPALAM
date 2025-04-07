import './style.css';

declare const cv: any;
let isOpenCVReady = false;

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
      if (isOpenCVReady) {
        try {
          // 画像をOpenCV.jsのMat形式に変換
          const src = cv.imread(canvas);
          const gray = new cv.Mat();
          
          // グレースケール変換
          cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

          // 特徴点検出
          const maxCorners = 100;
          const qualityLevel = 0.01;
          const minDistance = 10;
          const mask = new cv.Mat();
          const blockSize = 3;
          const useHarrisDetector = false;
          const k = 0.04;
          const points = new cv.Mat();

          cv.goodFeaturesToTrack(
            gray,              // 入力画像
            points,           // 出力される特徴点
            maxCorners,       // 最大検出数
            qualityLevel,     // 品質レベル
            minDistance,      // 最小距離
            mask,            // マスク
            blockSize,       // ブロックサイズ
            useHarrisDetector,// Harris検出器を使用するかどうか
            k                // k値
          );

          // 検出した特徴点を黒い点で描画
          for (let i = 0; i < points.rows; i++) {
            const x = points.data32F[i * 2];
            const y = points.data32F[i * 2 + 1];
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, 2 * Math.PI);
            ctx.fill();
          }

          // メモリ解放
          src.delete();
          gray.delete();
          points.delete();
          mask.delete();
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
};

// アプリケーション開始
initCamera();

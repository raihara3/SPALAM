/**
 * SPALAM 基本使用例
 * 
 * このファイルはSPALAMの基本的な使用方法を示すサンプルコードです。
 * 実際のプロジェクトでは、これらのパターンを参考にして実装してください。
 */

import { createSPALAM, SPALAMEvents } from '../src/SPALAM';

/**
 * 基本的な使用例
 */
async function basicExample() {
  // 1. SPALAMインスタンスの作成
  const spalam = createSPALAM()
    .useWebGPU()              // GPU加速を使用
    .enableDebug()            // デバッグ表示を有効化
    .build();

  // 2. イベントリスナーの設定
  spalam
    .on('frame:processed', (frameData) => {
      console.log(`フレーム処理完了: ${frameData.features.length}個の特徴点を検出`);
    })
    .on('plane:detected', (planeData) => {
      console.log('平面が検出されました!');
      console.log(`位置: ${planeData.position.x}, ${planeData.position.y}, ${planeData.position.z}`);
      console.log(`サイズ: ${planeData.size.width} x ${planeData.size.height}`);
      console.log(`信頼度: ${planeData.confidence}`);
    })
    .on('state:changed', (state) => {
      console.log(`状態変更: ${state}`);
    })
    .on('error', (error) => {
      console.error('エラーが発生しました:', error);
    });

  // 3. SPALAM開始
  try {
    await spalam.start();
    console.log('SPALAM開始しました');
  } catch (error) {
    console.error('SPALAM開始に失敗しました:', error);
  }
}

/**
 * カスタム設定での使用例
 */
async function advancedExample() {
  const spalam = createSPALAM()
    // 特徴点検出の詳細設定
    .features({
      maxCorners: 200,         // 最大特徴点数
      qualityLevel: 0.005,     // 品質閾値
      minDistance: 15,         // 特徴点間の最小距離
      showFeatures: true       // 特徴点の表示
    })
    // 深度推定の詳細設定
    .depth({
      modelId: 'depth-anything-v2-large',  // 高精度モデルを使用
      device: 'webgpu',                    // GPU使用
      showDepth: true                      // 深度マップ表示
    })
    // 平面推定の詳細設定
    .plane({
      ransacIterations: 2000,    // RANSAC反復回数
      ransacThreshold: 0.05,     // RANSAC閾値
      smoothingIterations: 5     // スムージング反復回数
    })
    .build();

  // イベントリスナー設定
  spalam.on('plane:detected', (plane) => {
    // 平面検出時の処理
    if (plane.confidence > 0.8) {
      console.log('高信頼度の平面を検出');
      // ARコンテンツを配置する処理など
    }
  });

  // 手動レンダリング制御の例
  await spalam.start({ autoRender: false });
  
  // 手動でレンダリングループを開始
  spalam.render();
}

/**
 * ライフサイクル管理の例
 */
async function lifecycleExample() {
  const spalam = createSPALAM()
    .useWebGPU()
    .build();

  // 状態監視
  spalam.on('state:changed', (state) => {
    console.log(`現在の状態: ${state}`);
  });

  // 開始
  await spalam.start();

  // 5秒後に一時停止
  setTimeout(() => {
    spalam.pause();
    console.log('一時停止しました');
  }, 5000);

  // 8秒後に再開
  setTimeout(() => {
    spalam.resume();
    console.log('再開しました');
  }, 8000);

  // 15秒後に停止と破棄
  setTimeout(() => {
    spalam.stop();
    spalam.dispose();
    console.log('SPALAMを終了しました');
  }, 15000);
}

/**
 * 設定変更の例
 */
function configurationExample() {
  const spalam = createSPALAM()
    .useWebGPU()
    .build();

  // 動的設定変更
  spalam.updateConfig({
    features: {
      maxCorners: 150,
      qualityLevel: 0.008
    },
    plane: {
      ransacIterations: 1500
    }
  });

  // 現在の設定確認
  const config = spalam.getConfig();
  console.log('現在の設定:', config);

  // 状態確認
  console.log('アクティブ状態:', spalam.isActive());
  console.log('平面検出状態:', spalam.isPlaneDetected());

  return spalam;
}

/**
 * エラーハンドリングの例
 */
async function errorHandlingExample() {
  const spalam = createSPALAM()
    .useWebGPU()
    .build();

  spalam.on('error', (error) => {
    switch (error.type) {
      case 'camera_access_denied':
        console.error('カメラアクセスが拒否されました');
        // ユーザーに権限要求を促すUI表示など
        break;
      case 'webgpu_not_supported':
        console.warn('WebGPUがサポートされていません。CPUに切り替えます');
        // CPUモードに切り替え
        spalam.updateConfig({ depth: { device: 'cpu' } });
        break;
      case 'model_load_failed':
        console.error('深度推定モデルの読み込みに失敗しました');
        // 軽量モデルに切り替える等の対応
        break;
      default:
        console.error('未知のエラー:', error);
    }
  });

  try {
    await spalam.start();
  } catch (error) {
    console.error('開始に失敗:', error);
    // フォールバック処理
  }
}

/**
 * カスタムビデオ入力の例
 */
async function customVideoExample() {
  // 既存のビデオ要素を取得
  const videoElement = document.getElementById('myVideo') as HTMLVideoElement;
  
  const spalam = createSPALAM()
    .useWebGPU()
    .build();

  // カスタムビデオ要素を使用
  await spalam.start({ video: videoElement });
}

// サンプル実行
if (typeof window !== 'undefined') {
  // ブラウザ環境での実行例
  window.addEventListener('load', () => {
    basicExample().catch(console.error);
  });
}

export {
  basicExample,
  advancedExample,
  lifecycleExample,
  configurationExample,
  errorHandlingExample,
  customVideoExample
};
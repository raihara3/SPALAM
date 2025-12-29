// import "./style.css";
import SPALAM from "./SPALAM";

// デバイス情報をログ出力
console.log("User Agent:", navigator.userAgent);
console.log("Platform:", navigator.platform);

// SPALAMのインスタンスを作成（デフォルト設定を使用）
const spalam = new SPALAM();

// 状態変更を監視
spalam.onStateChange((event) => {
  console.log(`State changed: ${event.previousState} -> ${event.currentState}`);
});

// エラーハンドリングを強化
spalam.on("error", (error) => {
  console.error("SPALAM Error:", error);
  // ユーザーに分かりやすいエラーメッセージを表示
  const errorDiv = document.createElement("div");
  errorDiv.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(255, 0, 0, 0.9);
    color: white;
    padding: 20px;
    border-radius: 8px;
    z-index: 9999;
    max-width: 80%;
    text-align: center;
  `;
  let errorMessage = error.message;
  let actionText = "詳細はデベロッパーツールのコンソールを確認してください";

  // エラータイプ別のメッセージ
  if (error.message.includes("WASM depth estimation failed") || 
      error.message.includes("not supported on mobile devices")) {
    // モバイルでの深度推定失敗は期待される動作なのでエラー表示しない
    return;
  } else if (error.message.includes("Depth estimation unavailable")) {
    errorMessage = "深度推定機能が利用できません";
    actionText = "特徴点検出と簡易深度計算で動作を継続します";
  } else if (
    error.message.includes("Model download failed") ||
    error.message.includes("CDN returned HTML")
  ) {
    errorMessage = "AIモデルのダウンロードに失敗しました";
    actionText =
      "ネットワーク制限またはCDN問題です。再読み込みを試してください";
  } else if (
    error.message.includes("Camera") ||
    error.message.includes("camera")
  ) {
    errorMessage = "カメラへのアクセスに失敗しました";
    actionText = "カメラの使用許可を確認してください";
  } else if (error.message.includes("denied")) {
    errorMessage = "カメラの使用が拒否されました";
    actionText = "ブラウザの設定でカメラの使用を許可してください";
  } else if (
    error.message.includes("Not found") ||
    error.message.includes("NotFoundError")
  ) {
    errorMessage = "カメラが見つかりません";
    actionText = "カメラが接続されているか確認してください";
  }

  errorDiv.innerHTML = `
    <h3>SPALAM</h3>
    <p>${errorMessage}</p>
    <p><small>${actionText}</small></p>
    <button onclick="window.location.reload()">再読み込み</button>
  `;
  document.body.appendChild(errorDiv);
});

// OpenCV読み込み待機
const waitForOpenCV = (): Promise<void> => {
  return new Promise((resolve) => {
    if (typeof cv !== 'undefined' && cv.Mat) {
      resolve();
    } else {
      const checkInterval = setInterval(() => {
        if (typeof cv !== 'undefined' && cv.Mat) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    }
  });
};

// SPALAMを開始（より詳細なエラーハンドリング）
const startSPALAM = async () => {
  const hideLoading = () => {
    const loading = document.getElementById("loading");
    if (loading) {
      loading.style.display = "none";
    }
  };

  try {
    console.log("Starting SPALAM...");

    // ローディングメッセージ更新
    const updateLoadingMessage = (message: string) => {
      const loadingDetail = document.getElementById("loading-detail");
      if (loadingDetail) {
        loadingDetail.innerHTML = `<small>${message}</small>`;
      }
    };

    const isMobile =
      /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      );
    
    updateLoadingMessage("OpenCV.jsを読み込み中...");
    await waitForOpenCV();
    
    if (isMobile) {
      updateLoadingMessage("モバイルデバイス: WASM深度推定を読み込み中...");
    } else {
      updateLoadingMessage("AI深度推定モデルを読み込み中...");
    }

    await spalam.start();
    console.log("SPALAM started successfully");
    hideLoading();

    // モバイルデバイスでIMUトラッキング許可ボタンを表示
    // iOS Safariではセンサーアクセスにユーザージェスチャーが必要
    if (isMobile) {
      const imuButton = document.createElement("button");
      imuButton.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 100, 200, 0.9);
        color: white;
        padding: 15px 25px;
        border-radius: 8px;
        border: none;
        z-index: 9999;
        text-align: center;
        font-size: 16px;
        cursor: pointer;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
      `;
      imuButton.textContent = "📱 タップしてARトラッキングを有効化";
      document.body.appendChild(imuButton);

      imuButton.addEventListener("click", async () => {
        imuButton.textContent = "有効化中...";
        imuButton.style.background = "rgba(100, 100, 100, 0.9)";

        console.log("Enabling IMU tracking for mobile device...");
        const imuSuccess = await spalam.enableIMUTracking();

        if (imuSuccess) {
          console.log("IMU tracking enabled successfully");
          spalam.setIMUDebug(true);
          imuButton.textContent = "✓ ARトラッキング有効";
          imuButton.style.background = "rgba(0, 150, 0, 0.9)";
        } else {
          console.warn("IMU tracking initialization failed");
          imuButton.textContent = "❌ 有効化に失敗";
          imuButton.style.background = "rgba(200, 50, 50, 0.9)";
        }

        // 2秒後にボタンを非表示
        setTimeout(() => {
          if (imuButton.parentNode) {
            imuButton.parentNode.removeChild(imuButton);
          }
        }, 2000);
      });
    }
  } catch (error) {
    console.error("Failed to start SPALAM:", error);
    hideLoading();

    // モバイルデバイス向けの追加チェック
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("OpenCV.js")) {
      console.warn(
        "OpenCV.js loading failed. This might be due to mobile device limitations."
      );
    }

    if (errorMessage.includes("camera")) {
      console.warn("Camera access failed. Please check permissions.");
    }
  }
};

// DOM読み込み完了後に実行
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startSPALAM);
} else {
  startSPALAM();
}

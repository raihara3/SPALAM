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
    if (isMobile) {
      updateLoadingMessage("モバイルデバイス: WASM深度推定を読み込み中...");
    } else {
      updateLoadingMessage("AI深度推定モデルを読み込み中...");
    }

    await spalam.start();
    console.log("SPALAM started successfully");
    hideLoading();

    // モバイルデバイスでの成功メッセージ
    if (isMobile) {
      const infoDiv = document.createElement("div");
      infoDiv.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 150, 0, 0.9);
        color: white;
        padding: 10px 20px;
        border-radius: 8px;
        z-index: 9999;
        text-align: center;
        font-size: 14px;
      `;
      infoDiv.innerHTML = `
        <p>📱 モバイルモード: WASM深度推定または簡易深度計算</p>
      `;
      document.body.appendChild(infoDiv);

      // 3秒後に非表示
      setTimeout(() => {
        if (infoDiv.parentNode) {
          infoDiv.parentNode.removeChild(infoDiv);
        }
      }, 3000);
    }
  } catch (error) {
    console.error("Failed to start SPALAM:", error);
    hideLoading();

    // モバイルデバイス向けの追加チェック
    if (error.message.includes("OpenCV.js")) {
      console.warn(
        "OpenCV.js loading failed. This might be due to mobile device limitations."
      );
    }

    if (error.message.includes("camera")) {
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

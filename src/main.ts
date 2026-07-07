/*
 * Copyright 2025 raihara3
 * SPDX-License-Identifier: Apache-2.0
 */

import SPALAM from "./SPALAM";

// デバイス情報をログ出力
console.log("User Agent:", navigator.userAgent);
console.log("Platform:", navigator.platform);

const isMobile =
  /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );

let spalam: SPALAM | null = null;

const updateStatus = (message: string) => {
  const status = document.getElementById("start-status");
  if (status) {
    status.textContent = message;
  }
};

const hideStartScreen = () => {
  const startScreen = document.getElementById("start-screen");
  if (startScreen) {
    startScreen.style.display = "none";
  }
};

const showLoading = () => {
  const loading = document.getElementById("loading");
  if (loading) {
    loading.style.display = "block";
  }
};

const hideLoading = () => {
  const loading = document.getElementById("loading");
  if (loading) {
    loading.style.display = "none";
  }
};

const updateLoadingMessage = (message: string) => {
  const loadingDetail = document.getElementById("loading-detail");
  if (loadingDetail) {
    loadingDetail.innerHTML = `<small>${message}</small>`;
  }
};

// iOS DeviceMotion パーミッション取得
const requestMotionPermission = async (): Promise<boolean> => {
  // iOS 13+ ではユーザージェスチャー内でパーミッションをリクエストする必要がある
  if (
    typeof DeviceMotionEvent !== "undefined" &&
    typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === "function"
  ) {
    try {
      const permission = await (DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission();
      return permission === "granted";
    } catch (error) {
      console.warn("DeviceMotion permission request failed:", error);
      return false;
    }
  }
  // iOS以外やiOS 12以下はパーミッション不要
  return true;
};

// iOS DeviceOrientation パーミッション取得
const requestOrientationPermission = async (): Promise<boolean> => {
  if (
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === "function"
  ) {
    try {
      const permission = await (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission();
      return permission === "granted";
    } catch (error) {
      console.warn("DeviceOrientation permission request failed:", error);
      return false;
    }
  }
  return true;
};

// OpenCV読み込み待機
const waitForOpenCV = (): Promise<void> => {
  return new Promise((resolve) => {
    if (typeof cv !== "undefined" && cv.Mat) {
      resolve();
    } else {
      const checkInterval = setInterval(() => {
        if (typeof cv !== "undefined" && cv.Mat) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    }
  });
};

// SPALAM起動
const startSPALAM = async () => {
  hideStartScreen();
  showLoading();

  try {
    updateLoadingMessage("OpenCV.jsを読み込み中...");
    await waitForOpenCV();

    if (isMobile) {
      updateLoadingMessage("モバイルデバイス: WASM深度推定を読み込み中...");
    } else {
      updateLoadingMessage("AI深度推定モデルを読み込み中...");
    }

    // 6DoFトラッキング（ランドマークマップ + RANSAC PnP）を有効化。
    // 無効時は旧パイプライン（向き + DistanceTrackerスケール + 特徴点追従）
    // で動作し、スケール変動・特徴点ドリフト追従・方向のみの再配置という
    // 既知の制約がそのまま現れる
    spalam = new SPALAM({
      tracking: {
        enableSixDof: true,
        minCorrespondences: 50,
        minTrackedCorrespondences: 15,
      },
    });

    // 状態変更を監視
    spalam.onStateChange((event) => {
      console.log(`State changed: ${event.previousState} -> ${event.currentState}`);
    });

    // エラーハンドリング
    spalam.on("error", (error) => {
      console.error("SPALAM Error:", error);

      // モバイルでの深度推定失敗は期待される動作なのでエラー表示しない
      if (
        error.message.includes("WASM depth estimation failed") ||
        error.message.includes("not supported on mobile devices")
      ) {
        return;
      }

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

      if (error.message.includes("Depth estimation unavailable")) {
        errorMessage = "深度推定機能が利用できません";
        actionText = "特徴点検出と簡易深度計算で動作を継続します";
      } else if (
        error.message.includes("Model download failed") ||
        error.message.includes("CDN returned HTML")
      ) {
        errorMessage = "AIモデルのダウンロードに失敗しました";
        actionText = "ネットワーク制限またはCDN問題です。再読み込みを試してください";
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

    await spalam.start();
    console.log("SPALAM started successfully");
    spalam.setDrawFeaturesEnabled(false);
    hideLoading();
    createDebugPanel(spalam);

    // モバイルデバイスでIMUトラッキングを有効化
    if (isMobile) {
      console.log("Enabling IMU tracking for mobile device...");
      const imuSuccess = await spalam.enableIMUTracking();
      if (imuSuccess) {
        console.log("IMU tracking enabled successfully");
      } else {
        console.warn("IMU tracking initialization failed");
      }
    }
  } catch (error) {
    console.error("Failed to start SPALAM:", error);
    hideLoading();

    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("OpenCV.js")) {
      console.warn("OpenCV.js loading failed. This might be due to mobile device limitations.");
    }
    if (errorMessage.includes("camera")) {
      console.warn("Camera access failed. Please check permissions.");
    }
  }
};

// 起動ボタンのクリックハンドラ
const handleStartClick = async () => {
  const button = document.getElementById("start-button") as HTMLButtonElement;
  if (!button) return;

  button.disabled = true;
  button.textContent = "Starting...";

  try {
    // モーションセンサーのパーミッションを取得（iOSではユーザージェスチャー内で必要）
    if (isMobile) {
      updateStatus("モーションセンサーの許可を確認中...");

      const motionGranted = await requestMotionPermission();
      const orientationGranted = await requestOrientationPermission();

      if (!motionGranted || !orientationGranted) {
        console.warn("Motion sensor permission not granted");
        updateStatus("モーションセンサーの許可が必要です");
      } else {
        console.log("Motion sensor permissions granted");
      }
    }

    // SPALAM起動
    await startSPALAM();
  } catch (error) {
    console.error("Start failed:", error);
    button.disabled = false;
    button.textContent = "Start AR";
    updateStatus("起動に失敗しました。再度お試しください。");
  }
};

// デバッグパネルの作成
const createDebugPanel = (instance: SPALAM) => {
  const panel = document.createElement("div");
  panel.id = "debug-panel";
  panel.style.cssText = `
    position: fixed;
    bottom: 10px;
    right: 10px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 6px;
  `;

  const createToggleButton = (
    label: string,
    initial: boolean,
    onChange: (enabled: boolean) => void,
  ): HTMLButtonElement => {
    const button = document.createElement("button");
    let enabled = initial;

    const updateStyle = () => {
      button.textContent = `${label}: ${enabled ? "ON" : "OFF"}`;
      button.style.cssText = `
        background: ${enabled ? "rgba(0,200,0,0.8)" : "rgba(100,100,100,0.8)"};
        color: white;
        border: none;
        padding: 8px 14px;
        border-radius: 5px;
        font-family: monospace;
        font-size: 13px;
        cursor: pointer;
      `;
    };

    updateStyle();
    button.addEventListener("click", () => {
      enabled = !enabled;
      updateStyle();
      onChange(enabled);
    });

    return button;
  };

  panel.appendChild(
    createToggleButton("Features", instance.isDrawFeaturesEnabled(), (enabled) => {
      instance.setDrawFeaturesEnabled(enabled);
    }),
  );

  // 6DoFトラッキング診断HUD: どのリンク（初期化 / 追跡 / 復帰）で
  // 問題が起きているかを実機で切り分けるための情報
  const hud = document.createElement("div");
  hud.style.cssText = `
    background: rgba(0,0,0,0.7);
    color: #0ff;
    font-family: monospace;
    font-size: 12px;
    padding: 8px 10px;
    border-radius: 5px;
    white-space: pre;
  `;
  panel.appendChild(hud);

  setInterval(() => {
    const sixDof = instance.getSixDofTrackingStatistics();
    const frame = instance.getFrameBudgetStatistics();
    const lines = [
      `state: ${instance.getTrackingState()}`,
      sixDof
        ? `6dof: ${sixDof.isInitialized ? "initialized" : "not initialized"}` +
          `\nlandmarks: ${sixDof.landmarks.landmarkCount}` +
          `\nreproj: ${sixDof.landmarks.averageReprojectionError.toFixed(2)}px`
        : "6dof: disabled",
      `fps: ${frame.fps.toFixed(1)}  frame: ${frame.averageFrameMs.toFixed(1)}ms`,
      `over budget: ${(frame.overBudgetRatio * 100).toFixed(0)}%`,
    ];
    hud.textContent = lines.join("\n");
  }, 250);

  document.body.appendChild(panel);
};

// DOM読み込み完了後にイベントリスナーを設定
const init = () => {
  const startButton = document.getElementById("start-button");
  if (startButton) {
    startButton.addEventListener("click", handleStartClick);
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

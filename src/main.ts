// import "./style.css";
import SPALAM from "./SPALAM";

// SPALAMのインスタンスを作成（デフォルト設定を使用）
const spalam = new SPALAM();

// 状態変更を監視
spalam.onStateChange((event) => {
  console.log(`State changed: ${event.previousState} -> ${event.currentState}`);
});

// SPALAMを開始
spalam.start().catch((error) => {
  console.error("Failed to start SPALAM:", error);
});

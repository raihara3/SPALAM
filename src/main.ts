// import "./style.css";
import { SPALAM } from "./index";

// Initialize OpenCV from CDN as fallback
const initOpenCVFromCDN = async () => {
  return new Promise<void>((resolve, reject) => {
    // Check if OpenCV is already loaded
    if ((window as any).cv && (window as any).cv.Mat) {
      console.log("OpenCV already available");
      resolve();
      return;
    }

    console.log("Creating OpenCV script element...");
    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
    script.async = true;
    
    script.onload = () => {
      console.log("OpenCV script loaded, waiting for initialization...");
      let attempts = 0;
      const maxAttempts = 100; // 10 seconds max
      
      const checkCV = () => {
        attempts++;
        if ((window as any).cv && (window as any).cv.Mat) {
          console.log(`OpenCV initialized after ${attempts} attempts`);
          resolve();
        } else if (attempts >= maxAttempts) {
          reject(new Error("OpenCV initialization timeout after script load"));
        } else {
          setTimeout(checkCV, 100);
        }
      };
      checkCV();
    };
    
    script.onerror = (error) => {
      console.error("Script load error:", error);
      reject(new Error("Failed to load OpenCV script from CDN"));
    };
    
    console.log("Adding OpenCV script to page...");
    document.head.appendChild(script);
    
    // Overall timeout after 15 seconds
    setTimeout(() => {
      reject(new Error("OpenCV CDN load timeout (15s)"));
    }, 15000);
  });
};

// Initialize OpenCV directly from CDN
const initOpenCV = async () => {
  console.log("Loading OpenCV from CDN...");
  return initOpenCVFromCDN();
};

async function main() {
  try {
    console.log("Starting SPALAM initialization...");
    
    // Initialize OpenCV first
    showStatus("Loading OpenCV...");
    try {
      await initOpenCV();
      console.log("✅ OpenCV loaded");
      showStatus("OpenCV loaded successfully");
      await new Promise(resolve => setTimeout(resolve, 500)); // Give user time to see status
    } catch (error) {
      console.error("OpenCV loading failed:", error);
      showError("OpenCV loading failed: " + error.message);
      
      // For now, just show the error and don't continue
      console.log("Stopping execution due to OpenCV failure");
      return;
    }
    
    const spalam = new SPALAM();
    
    // Setup event listeners
    spalam.on("initializing", () => console.log("🔄 SPALAM initializing..."));
    spalam.on("initialized", () => console.log("✅ SPALAM initialized"));
    spalam.on("started", () => console.log("🚀 SPALAM started"));
    spalam.on("error", (error) => {
      console.error("❌ SPALAM error:", error);
      // Show user-friendly error message
      showError("SPALAM Error: " + error.message);
    });
    spalam.on("frameProcessed", (result) => console.log("📷 Frame processed - confidence:", result?.confidence));
    spalam.on("fittingProgress", (progress) => console.log(`🔧 Fitting progress: ${progress.current}/${progress.total}`));
    
    // Add loading indicator
    showStatus("Initializing SPALAM...");
    
    // Initialize and start
    console.log("Calling spalam.initialize()...");
    await spalam.initialize();
    console.log("SPALAM initialization complete");
    
    showStatus("Starting camera...");
    console.log("Calling spalam.start()...");
    await spalam.start();
    console.log("SPALAM start complete");
    
    showStatus("SPALAM is running");
    
  } catch (error) {
    console.error("❌ Failed to start SPALAM:", error);
    showError("Failed to start SPALAM: " + error.message);
  }
}

function showStatus(message) {
  const statusDiv = document.getElementById("status") || createStatusDiv();
  statusDiv.textContent = message;
  statusDiv.style.color = "#333";
}

function showError(message) {
  const statusDiv = document.getElementById("status") || createStatusDiv();
  statusDiv.textContent = message;
  statusDiv.style.color = "#ff0000";
}

function createStatusDiv() {
  // Remove loading div if it exists
  const loading = document.getElementById('loading');
  if (loading) loading.remove();
  
  const div = document.createElement("div");
  div.id = "status";
  div.style.position = "fixed";
  div.style.top = "10px";
  div.style.left = "10px";
  div.style.background = "rgba(255, 255, 255, 0.9)";
  div.style.padding = "10px";
  div.style.borderRadius = "5px";
  div.style.zIndex = "1000";
  div.style.fontFamily = "Arial, sans-serif";
  document.body.appendChild(div);
  return div;
}

// Add error boundary for unhandled errors
window.addEventListener('error', (event) => {
  console.error('Unhandled error:', event.error);
  showError('Unexpected error: ' + event.error.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  showError('Async error: ' + event.reason.message);
});

main();

// Simple test without OpenCV
console.log("Starting simple test...");

function showStatus(message: string) {
  const statusDiv = document.getElementById("status") || createStatusDiv();
  statusDiv.textContent = message;
  statusDiv.style.color = "#333";
}

function createStatusDiv() {
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

async function testBasicFunctionality() {
  try {
    showStatus("Testing basic functionality...");
    
    // Test camera access
    showStatus("Testing camera access...");
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: "environment" } 
    });
    
    showStatus("Camera access successful!");
    
    // Create video element
    const video = document.createElement("video");
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    video.style.position = "fixed";
    video.style.top = "0";
    video.style.left = "0";
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "cover";
    document.body.appendChild(video);
    
    showStatus("Video stream active - basic test successful!");
    
  } catch (error) {
    console.error("Test failed:", error);
    showStatus("Test failed: " + error.message);
  }
}

testBasicFunctionality();
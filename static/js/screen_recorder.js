/**
 * screen_recorder.js
 *
 * Composites screen and webcam onto a hidden <canvas>.
 * The webcam feed is CROPPED to only show the user's eyes.
 * Records the canvas stream as a WebM blob.
 */

let _mediaRecorder = null;
let _recordedChunks = [];
let _compositeCanvas = null;
let _compositeCtx = null;
let _animFrameId = null;
let _screenStream = null;
let _screenVideo = null;

// The current bounding box for the eyes
window._eyeCrop = { sx: 0, sy: 0, sw: 100, sh: 50, isValid: false };

/**
 * Calculates a tight bounding box strictly around the eyeballs/eyelids
 * based on MediaPipe landmarks (Eyebrows removed).
 */
window._updateEyeRegion = function(landmarks, vWidth, vHeight) {
    // Indices for STRICTLY eye corners and eyelids (No eyebrows)
    // Left eye: 33, 133 (corners), 159 (top), 145 (bottom)
    // Right eye: 362, 263 (corners), 386 (top), 374 (bottom)
    const eyePoints = [33, 133, 362, 263, 159, 145, 386, 374];
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    
    eyePoints.forEach(idx => {
        const lm = landmarks[idx];
        if(lm.x < minX) minX = lm.x;
        if(lm.x > maxX) maxX = lm.x;
        if(lm.y < minY) minY = lm.y;
        if(lm.y > maxY) maxY = lm.y;
    });

    // Drastically reduced padding for a much tighter crop
    const padX = 0.04; // Only 4% extra space on the sides
    const padY = 0.06; // Only 6% extra space above/below (down from 15%)
    
    minX = Math.max(0, minX - padX);
    maxX = Math.min(1, maxX + padX);
    minY = Math.max(0, minY - padY);
    maxY = Math.min(1, maxY + padY);

    window._eyeCrop = {
        sx: minX * vWidth,
        sy: minY * vHeight,
        sw: (maxX - minX) * vWidth,
        sh: (maxY - minY) * vHeight,
        isValid: true
    };
};

export async function startScreenRecording(webcamVideoEl) {
  try {
    // 1. Request screen capture (Hint to browser to default to Entire Screen)
    _screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always", displaySurface: "monitor" },
      audio: false
    });

    // 2. VALIDATE: Did they actually pick "Entire Screen"?
    const videoTrack = _screenStream.getVideoTracks()[0];
    const settings = videoTrack.getSettings();

    if (settings.displaySurface && settings.displaySurface !== "monitor") {
        videoTrack.stop(); // Kill the stream immediately
        throw new Error("NOT_MONITOR"); // Trigger the catch block
    }

    // 3. Create hidden video element
    _screenVideo = document.createElement("video");
    _screenVideo.srcObject = _screenStream;
    _screenVideo.muted = true;
    _screenVideo.style.display = "none";
    document.body.appendChild(_screenVideo);
    await _screenVideo.play();

    // 4. Create hidden composite canvas
    _compositeCanvas = document.createElement("canvas");
    _compositeCanvas.width = 1280;
    _compositeCanvas.height = 720;
    _compositeCanvas.style.display = "none";
    document.body.appendChild(_compositeCanvas);
    _compositeCtx = _compositeCanvas.getContext("2d");

    _drawFrame(webcamVideoEl);

    // 5. Record the canvas stream
    const canvasStream = _compositeCanvas.captureStream(15);
    _recordedChunks = [];

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";

    _mediaRecorder = new MediaRecorder(canvasStream, { mimeType });

    _mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) _recordedChunks.push(e.data);
    };

    _mediaRecorder.start(1000);
    console.log("[ScreenRecorder] Eye-Crop Recording started.");

  } catch (err) {
    console.error("[ScreenRecorder] Failed to start:", err);
    throw err; // Send error back to experiment.js
  }
}

export async function stopScreenRecording() {
  if (!_mediaRecorder || _mediaRecorder.state === "inactive") return;

  return new Promise((resolve) => {
    _mediaRecorder.onstop = async () => {
      if (_animFrameId) cancelAnimationFrame(_animFrameId);
      if (_screenStream) _screenStream.getTracks().forEach(t => t.stop());
      if (_screenVideo) _screenVideo.remove();
      if (_compositeCanvas) _compositeCanvas.remove();

      if (_recordedChunks.length > 0) {
        const blob = new Blob(_recordedChunks, { type: "video/webm" });
        await _uploadRecording(blob);
      }
      resolve();
    };

    _mediaRecorder.stop();
  });
}

function _drawFrame(webcamVideoEl) {
  const ctx = _compositeCtx;
  const W = _compositeCanvas.width;
  const H = _compositeCanvas.height;

  // Draw Screen
  if (_screenVideo && _screenVideo.readyState >= 2) {
    ctx.drawImage(_screenVideo, 0, 0, W, H);
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
  }

  // Draw EYE-CROP PiP
  if (webcamVideoEl && webcamVideoEl.readyState >= 2 && window._eyeCrop.isValid) {
    const crop = window._eyeCrop;
    
    // Set a fixed width for the PiP, dynamically calculate height to maintain natural aspect ratio of the eyes
    const PIP_W = 320; 
    const PIP_H = PIP_W * (crop.sh / crop.sw);
    const MARGIN = 16;
    const px = W - PIP_W - MARGIN;
    const py = H - PIP_H - MARGIN;

    ctx.save();
    _roundRect(ctx, px, py, PIP_W, PIP_H, 8);
    ctx.clip();
    
    // CRITICAL: 9-argument drawImage to crop the source video
    // drawImage(image, source_x, source_y, source_w, source_h, dest_x, dest_y, dest_w, dest_h)
    ctx.drawImage(webcamVideoEl, crop.sx, crop.sy, crop.sw, crop.sh, px, py, PIP_W, PIP_H);
    ctx.restore();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    _roundRect(ctx, px, py, PIP_W, PIP_H, 8);
    ctx.stroke();
  }

  // Draw Distraction Warning Overlay
  if (window._isDistracted) {
      ctx.fillStyle = "rgba(255, 0, 0, 0.85)";
      ctx.fillRect(0, 0, W, 100);
      ctx.fillStyle = "white";
      ctx.font = "bold 48px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("WARNING: PLEASE LOOK AT THE SCREEN", W / 2, 50);
  }

  _animFrameId = requestAnimationFrame(() => _drawFrame(webcamVideoEl));
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function _uploadRecording(blob) {
  try {
    const formData = new FormData();
    formData.append("recording", blob, "session_recording.webm");

    const res = await fetch("/save_screen_recording", {
      method: "POST",
      body: formData
    });

    if (res.ok) {
      console.log("[ScreenRecorder] WebM Upload successful.");
    } else {
      console.warn("[ScreenRecorder] Upload failed:", res.status);
    }
  } catch (err) {
    console.error("[ScreenRecorder] Upload error:", err);
  }
}
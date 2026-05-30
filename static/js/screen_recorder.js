/**
 * screen_recorder.js
 *
 * Composites screen, webcam (top-left), and gaze dot onto a hidden <canvas>.
 * Records the canvas stream as a WebM blob, uploading in 30-second chunks.
 */

let _mediaRecorder = null;
let _recordedChunks = [];
let _compositeCanvas = null;
let _compositeCtx = null;
let _animFrameId = null;
let _screenStream = null;
let _screenVideo = null;

export async function startScreenRecording(webcamVideoEl) {
  try {
    _screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
          cursor: "always",
          displaySurface: "monitor"
      },
      audio: false,
      surfaceSwitching: "exclude"
    });

    const videoTrack = _screenStream.getVideoTracks()[0];
    const settings = videoTrack.getSettings();

    if (settings.displaySurface !== "monitor") {
        videoTrack.stop();
        throw new Error("NOT_MONITOR");
    }

    _screenVideo = document.createElement("video");
    _screenVideo.srcObject = _screenStream;
    _screenVideo.muted = true;
    _screenVideo.style.display = "none";
    document.body.appendChild(_screenVideo);
    await _screenVideo.play();

    _compositeCanvas = document.createElement("canvas");
    _compositeCanvas.width = 1280;
    _compositeCanvas.height = 720;
    _compositeCanvas.style.display = "none";
    document.body.appendChild(_compositeCanvas);
    _compositeCtx = _compositeCanvas.getContext("2d");

    _drawFrame(webcamVideoEl);

    const canvasStream = _compositeCanvas.captureStream(15);
    _recordedChunks = [];

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";

    _mediaRecorder = new MediaRecorder(canvasStream, { mimeType });

    _mediaRecorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0) {
            await _uploadRecording(e.data);
        }
    };

    _mediaRecorder.start(30000);
    console.log("[ScreenRecorder] Recording started (screen + camera + gaze).");

  } catch (err) {
    console.error("[ScreenRecorder] Failed to start:", err);
    throw err;
  }
}

export async function stopScreenRecording() {
  if (!_mediaRecorder || _mediaRecorder.state === "inactive") return;

  return new Promise((resolve) => {
    _mediaRecorder.onstop = () => {
      if (_animFrameId) cancelAnimationFrame(_animFrameId);
      if (_screenStream) _screenStream.getTracks().forEach(t => t.stop());
      if (_screenVideo) _screenVideo.remove();
      if (_compositeCanvas) _compositeCanvas.remove();
      resolve();
    };

    _mediaRecorder.stop();
  });
}

function _drawFrame(webcamVideoEl) {
  const ctx = _compositeCtx;
  const W = _compositeCanvas.width;
  const H = _compositeCanvas.height;

  // 1. Draw screen
  if (_screenVideo && _screenVideo.readyState >= 2) {
    ctx.drawImage(_screenVideo, 0, 0, W, H);
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
  }

  // 2. Draw webcam PiP (top-left, full face)
  if (webcamVideoEl && webcamVideoEl.readyState >= 2) {
    const PIP_W = 200;
    const PIP_H = 150;
    const MARGIN = 12;
    const px = MARGIN;
    const py = MARGIN;

    ctx.save();
    _roundRect(ctx, px, py, PIP_W, PIP_H, 8);
    ctx.clip();
    ctx.drawImage(webcamVideoEl, px, py, PIP_W, PIP_H);
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 2;
    _roundRect(ctx, px, py, PIP_W, PIP_H, 8);
    ctx.stroke();
  }

  // 3. Draw gaze dot (from sessionStorage, updated by gaze_overlay.js)
  const gazeX = parseFloat(sessionStorage.getItem('_live_gaze_x'));
  const gazeY = parseFloat(sessionStorage.getItem('_live_gaze_y'));
  const blink = sessionStorage.getItem('_live_blink') === '1';

  if (!isNaN(gazeX) && !isNaN(gazeY) && !blink) {
    const sx = gazeX * (W / window.innerWidth);
    const sy = gazeY * (H / window.innerHeight);

    // Halo
    ctx.beginPath();
    ctx.arc(sx, sy, 30, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 80, 80, 0.3)';
    ctx.fill();

    // Dot
    ctx.beginPath();
    ctx.arc(sx, sy, 12, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 50, 50, 0.7)';
    ctx.fill();

    // Center
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }

  // 4. Draw distraction warning overlay
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
      console.log("[ScreenRecorder] Chunk uploaded.");
    } else {
      console.warn("[ScreenRecorder] Upload failed:", res.status);
    }
  } catch (err) {
    console.error("[ScreenRecorder] Upload error:", err);
  }
}

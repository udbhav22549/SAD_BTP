/**
 * screen_recorder.js
 *
 * Captures:
 * - Screen via getDisplayMedia (full screen)
 * - Webcam via the existing <video id="videoCam"> stream
 *
 * Composites them onto a hidden <canvas>:
 * - Screen fills the full canvas
 * - Webcam shown as a rectangular PiP in the bottom-right corner
 *
 * Records the canvas stream as an MP4/WebM blob and uploads it to
 * /save_screen_recording at the end of the session.
 *
 * The user never sees the canvas or the screen-share picker result
 * (canvas is off-screen; video elements are hidden).
 */

let _mediaRecorder = null;
let _recordedChunks = [];
let _compositeCanvas = null;
let _compositeCtx = null;
let _animFrameId = null;
let _screenStream = null;
let _screenVideo = null;
let _activeMimeType = "video/mp4"; // <-- NEW: Track the active format

/**
 * Call once when the experiment starts.
 * @param {HTMLVideoElement} webcamVideoEl  The existing #videoCam element
 * @returns {Promise<void>}
 */
export async function startScreenRecording(webcamVideoEl) {
  try {
    // 1. Request screen capture
    _screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" },
      audio: false
    });

    // 2. Create a hidden video element to play the screen stream
    _screenVideo = document.createElement("video");
    _screenVideo.srcObject = _screenStream;
    _screenVideo.muted = true;
    _screenVideo.style.display = "none";
    document.body.appendChild(_screenVideo);
    await _screenVideo.play();

    // 3. Create hidden composite canvas (match screen resolution)
    _compositeCanvas = document.createElement("canvas");
    _compositeCanvas.width = 1280;
    _compositeCanvas.height = 720;
    _compositeCanvas.style.display = "none";
    document.body.appendChild(_compositeCanvas);
    _compositeCtx = _compositeCanvas.getContext("2d");

    // 4. Start drawing loop
    _drawFrame(webcamVideoEl);

    // 5. Record the canvas stream
    const canvasStream = _compositeCanvas.captureStream(15); // 15 fps is enough
    _recordedChunks = [];

    // --- NEW MP4 LOGIC ---
    let mimeType = "video/mp4";
    
    // If browser does NOT support MP4, fall back to WebM
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      console.warn("[ScreenRecorder] MP4 not supported in this browser. Falling back to WebM.");
      mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
    }
    
    _activeMimeType = mimeType;
    _mediaRecorder = new MediaRecorder(canvasStream, { mimeType: _activeMimeType });
    // ---------------------

    _mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) _recordedChunks.push(e.data);
    };

    _mediaRecorder.start(1000); // collect a chunk every second
    console.log(`[ScreenRecorder] Recording started as ${_activeMimeType}.`);

  } catch (err) {
    console.error("[ScreenRecorder] Failed to start:", err);
    // Non-fatal — experiment continues even if recording fails
  }
}

/**
 * Stop recording and upload the file to the server.
 * @returns {Promise<void>}
 */
export async function stopScreenRecording() {
  if (!_mediaRecorder || _mediaRecorder.state === "inactive") return;

  return new Promise((resolve) => {
    _mediaRecorder.onstop = async () => {
      // Stop animation loop
      if (_animFrameId) cancelAnimationFrame(_animFrameId);

      // Stop screen stream tracks
      if (_screenStream) _screenStream.getTracks().forEach(t => t.stop());

      // Clean up DOM
      if (_screenVideo) _screenVideo.remove();
      if (_compositeCanvas) _compositeCanvas.remove();

      // Upload blob
      if (_recordedChunks.length > 0) {
        // --- NEW MP4 LOGIC ---
        const ext = _activeMimeType.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(_recordedChunks, { type: _activeMimeType });
        await _uploadRecording(blob, ext);
        // ---------------------
      }

      resolve();
    };

    _mediaRecorder.stop();
  });
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function _drawFrame(webcamVideoEl) {
  const ctx = _compositeCtx;
  const W = _compositeCanvas.width;
  const H = _compositeCanvas.height;

  // Draw screen
  if (_screenVideo && _screenVideo.readyState >= 2) {
    ctx.drawImage(_screenVideo, 0, 0, W, H);
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
  }

  // Draw webcam PiP — bottom-right corner
  const PIP_W = 240;
  const PIP_H = 180;
  const MARGIN = 16;
  const px = W - PIP_W - MARGIN;
  const py = H - PIP_H - MARGIN;

  if (webcamVideoEl && webcamVideoEl.readyState >= 2) {
    // Rounded rect clip
    ctx.save();
    _roundRect(ctx, px, py, PIP_W, PIP_H, 8);
    ctx.clip();
    ctx.drawImage(webcamVideoEl, px, py, PIP_W, PIP_H);
    ctx.restore();

    // Border around PiP
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    _roundRect(ctx, px, py, PIP_W, PIP_H, 8);
    ctx.stroke();
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

async function _uploadRecording(blob, ext) {
  try {
    const formData = new FormData();
    // --- NEW MP4 LOGIC ---
    const filename = `session_recording.${ext}`;
    formData.append("recording", blob, filename);
    // ---------------------

    const res = await fetch("/save_screen_recording", {
      method: "POST",
      body: formData
    });

    if (res.ok) {
      console.log(`[ScreenRecorder] Upload successful (${filename}).`);
    } else {
      console.warn("[ScreenRecorder] Upload failed:", res.status);
    }
  } catch (err) {
    console.error("[ScreenRecorder] Upload error:", err);
  }
}
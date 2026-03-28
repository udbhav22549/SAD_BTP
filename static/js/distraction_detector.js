/**
 * distraction_detector.js
 *
 * Detects when the participant is distracted and shows/hides a
 * prominent red warning banner. Detection signals:
 *
 *   1. Face not visible in webcam (no landmarks returned by MediaPipe)
 *   2. Gaze direction pointing significantly away from center
 *      (uses iris landmark positions relative to eye corners)
 *   3. Tab / window blur (document visibilitychange or window blur)
 *
 * The warning element is injected into the DOM once and toggled.
 * A distraction event is also logged via the existing logEvent() callback
 * so it ends up in the session CSV/JSON.
 */

// ─── Config ──────────────────────────────────────────────────────────────────

const GAZE_THRESHOLD = 0.30;   // iris offset ratio — tune if needed (0=centre, 1=edge)
const DEBOUNCE_MS    = 600;    // ms of continuous distraction before warning appears
const WARNING_ID     = "distractionWarning";

// ─── State ───────────────────────────────────────────────────────────────────

let _warningVisible   = false;
let _distractedSince  = null;
let _logEventCallback = null;  // injected by caller
let _tabBlurred       = false;
let _lastFacePresent  = true;
let _detectorInterval = null;
let _faceLandmarker   = null;  // MediaPipe FaceLandmarker instance (injected)

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialise the detector.
 * @param {object}   faceLandmarkerInstance  The MediaPipe FaceLandmarker already initialised
 * @param {Function} logEvent                The logEvent(stage, fields) function from experiment.js
 */
export function initDistractionDetector(faceLandmarkerInstance, logEvent) {
  _faceLandmarker   = faceLandmarkerInstance;
  _logEventCallback = logEvent;

  _injectWarningBanner();
  _attachTabListeners();
}

/**
 * Run a single detection tick against the current video frame.
 * Call this from your existing per-frame analysis loop (e.g. inside face.js).
 * @param {HTMLVideoElement} videoEl
 * @param {object|null}      landmarkResult  Result from faceLandmarker.detectForVideo()
 */
export function detectDistraction(videoEl, landmarkResult) {
  const distracted = _isDistracted(landmarkResult);
  _handleDistractionState(distracted, _tabBlurred ? "tab_blur" : "gaze");
}

/**
 * Stop the detector (call when experiment ends).
 */
export function stopDistractionDetector() {
  if (_detectorInterval) clearInterval(_detectorInterval);
  _hideWarning();
  const el = document.getElementById(WARNING_ID);
  if (el) el.remove();
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function _injectWarningBanner() {
  if (document.getElementById(WARNING_ID)) return;

  const div = document.createElement("div");
  div.id = WARNING_ID;
  div.innerHTML = `
    <span style="font-size:1.6rem; margin-right:10px;">⚠️</span>
    <span>Please focus on the screen!</span>
  `;

  Object.assign(div.style, {
    display:         "none",
    position:        "fixed",
    top:             "0",
    left:            "0",
    width:           "100%",
    zIndex:          "99999",
    background:      "rgba(220, 38, 38, 0.95)",   // red-600
    color:           "#fff",
    fontFamily:      "sans-serif",
    fontSize:        "1.25rem",
    fontWeight:      "700",
    textAlign:       "center",
    padding:         "14px 0",
    letterSpacing:   "0.02em",
    boxShadow:       "0 4px 24px rgba(0,0,0,0.4)",
    transition:      "opacity 0.2s ease",
    pointerEvents:   "none",   // doesn't interfere with clicks
  });

  document.body.appendChild(div);
}

function _attachTabListeners() {
  // Tab/window blur
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      _tabBlurred = true;
      _handleDistractionState(true, "tab_blur");
    } else {
      _tabBlurred = false;
      // Re-evaluate on next frame tick — don't instantly clear
    }
  });

  window.addEventListener("blur", () => {
    _tabBlurred = true;
    _handleDistractionState(true, "window_blur");
  });

  window.addEventListener("focus", () => {
    _tabBlurred = false;
  });
}

/**
 * Determine if the current landmark result represents a distracted state.
 */
function _isDistracted(landmarkResult) {
  // Tab blur always counts
  if (_tabBlurred) return true;

  // No face detected
  if (!landmarkResult || !landmarkResult.faceLandmarks || landmarkResult.faceLandmarks.length === 0) {
    return true;
  }

  const landmarks = landmarkResult.faceLandmarks[0];

  // ── Iris gaze estimation ──────────────────────────────────────────────────
  // MediaPipe 478-point model:
  //   Left eye corners:  33 (inner), 133 (outer)
  //   Left iris centre:  468
  //   Right eye corners: 362 (inner), 263 (outer)
  //   Right iris centre: 473

  try {
    const leftInner  = landmarks[33];
    const leftOuter  = landmarks[133];
    const leftIris   = landmarks[468];
    const rightInner = landmarks[362];
    const rightOuter = landmarks[263];
    const rightIris  = landmarks[473];

    if (!leftIris || !rightIris) return false; // iris points not available

    const leftGaze  = _irisOffset(leftIris,  leftInner,  leftOuter);
    const rightGaze = _irisOffset(rightIris, rightInner, rightOuter);

    const avgOffset = (Math.abs(leftGaze) + Math.abs(rightGaze)) / 2;

    return avgOffset > GAZE_THRESHOLD;

  } catch (_) {
    return false;
  }
}

/**
 * Returns a value in [-1, 1]:
 *   0  = iris is centred between the two eye corners
 *  ±1  = iris is at the extreme corner
 */
function _irisOffset(iris, inner, outer) {
  const eyeWidth = Math.abs(outer.x - inner.x);
  if (eyeWidth < 0.001) return 0;
  const irisRelX = iris.x - inner.x;
  // Normalise to [-1, 1] around centre
  return (irisRelX / eyeWidth - 0.5) * 2;
}

function _handleDistractionState(isDistracted, reason = "gaze") {
  const now = Date.now();

  if (isDistracted) {
    if (!_distractedSince) _distractedSince = now;

    // Only show warning after DEBOUNCE_MS of continuous distraction
    if (!_warningVisible && (now - _distractedSince) >= DEBOUNCE_MS) {
      _showWarning();
      if (_logEventCallback) {
        _logEventCallback("distraction_start", { reason });
      }
    }
  } else {
    if (_distractedSince) {
      const duration = ((now - _distractedSince) / 1000).toFixed(2);
      if (_warningVisible && _logEventCallback) {
        _logEventCallback("distraction_end", { duration_sec: duration });
      }
    }
    _distractedSince = null;
    if (_warningVisible) _hideWarning();
  }
}

function _showWarning() {
  _warningVisible = true;
  const el = document.getElementById(WARNING_ID);
  if (el) {
    el.style.display = "flex";
    el.style.alignItems = "center";
    el.style.justifyContent = "center";
    el.style.opacity = "1";
  }
}

function _hideWarning() {
  _warningVisible = false;
  const el = document.getElementById(WARNING_ID);
  if (el) {
    el.style.display = "none";
  }
}
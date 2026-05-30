/**
 * gaze_overlay.js
 * Runs on the experiment page (index.html).
 * Hooks into calibrated GazeTracker & ScreenRecorder from calibration page.
 */

(async function initGazeOverlay() {
    'use strict';

    let tracker  = window.activeGazeTracker  || null;
    let model    = window.activeCalibModel   || null;

    if (!model) {
        const saved = sessionStorage.getItem('gazeCalibModel');
        if (saved) {
            try { model = CalibrationModel.fromJSON(JSON.parse(saved)); }
            catch (e) { console.warn("[GazeOverlay] Could not restore calib model:", e); }
        }
    }

    if (!tracker) {
        console.warn("[GazeOverlay] GazeTracker not found - re-initialising from camera.");
        tracker = new GazeTracker();

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' }, audio: false
            });
            const hiddenVid     = document.createElement('video');
            hiddenVid.srcObject = stream;
            hiddenVid.muted     = true;
            hiddenVid.autoplay  = true;
            hiddenVid.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;opacity:0;pointer-events:none;';
            document.body.appendChild(hiddenVid);
            await hiddenVid.play();
            await tracker.initialize(hiddenVid);
        } catch (err) {
            console.error("[GazeOverlay] Failed to re-init tracker:", err);
            return;
        }
    }

    if (model) tracker.setCalibrationModel(model);

    const canvas       = document.getElementById('gaze-canvas') || document.createElement('canvas');
    canvas.id          = 'gaze-canvas';
    canvas.style.cssText = `
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: 9999;
        display: none;
    `;
    if (!canvas.parentNode) document.body.appendChild(canvas);

    function resizeCanvas() {
        canvas.width  = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const ctx = canvas.getContext('2d');

    const logger = new GazeLogger({
        fixationWindowMs:    120,
        fixationThresholdPx: 60,
        saccadeVelocityPx:   380,
        sessionStartTime:    performance.now()
    });

    const sessionStart = performance.now();

    let _latestGaze = { x: null, y: null, blink: false };


    function _updateSessionStorageGaze(x, y, blink) {
        sessionStorage.setItem('_live_gaze_x',  x ?? '');
        sessionStorage.setItem('_live_gaze_y',  y ?? '');
        sessionStorage.setItem('_live_blink',   blink ? '1' : '0');
    }

    let _rafId = null;
    let _prevTimestamp = 0;
    const IST_OFFSET = 5.5 * 3600 * 1000;

    function gazeLoop(ts) {
        if (ts - _prevTimestamp < 33) {
            _rafId = requestAnimationFrame(gazeLoop);
            return;
        }
        _prevTimestamp = ts;

        const sample = tracker.processFrame(ts);

        const isoTs = new Date(Date.now() + IST_OFFSET)
            .toISOString().replace('Z', '+05:30');

        if (sample) {
            _latestGaze = {
                x:     sample.gazeX,
                y:     sample.gazeY,
                blink: sample.eyesClosed
            };
            _updateSessionStorageGaze(sample.gazeX, sample.gazeY, sample.eyesClosed);
            logger.addSample(sample, isoTs);
        } else {
            _latestGaze = { x: null, y: null, blink: false };
        }

        _rafId = requestAnimationFrame(gazeLoop);
    }

    _rafId = requestAnimationFrame(gazeLoop);

    window._finalizeEyeTracking = async function () {
        if (_rafId) cancelAnimationFrame(_rafId);
        tracker.destroy();

        const durationMs = performance.now() - sessionStart;
        const summary    = logger.getSummary(durationMs);
        const rawSamples = logger.getRawSamples();

        console.log("[GazeOverlay] Session summary:", summary);

        try {
            await fetch('/save_gaze_data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gaze_data: rawSamples })
            });
        } catch (e) { console.warn("Could not save gaze CSV:", e); }

        try {
            await fetch('/save_gaze_summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(summary)
            });
        } catch (e) { console.warn("Could not save gaze summary:", e); }

        logger.downloadCSV('gaze_backup.csv');
    };

    window.addEventListener('beforeunload', () => {
        if (_rafId) cancelAnimationFrame(_rafId);
        tracker.destroy();
    });

    console.log("[GazeOverlay] Gaze overlay active. Call window._finalizeEyeTracking() on experiment end.");

})();

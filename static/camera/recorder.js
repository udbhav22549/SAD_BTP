// static/camera/recorder.js

import { faceLandmarker } from "./face.js";
import { getEmotion, getAUs } from "./analysis.js";

let recording = false;
let activeVideo = null;

export async function startCameraRecording(videoElement) {
    if (!videoElement) {
        console.error("Recorder Error: No video element provided.");
        return;
    }
    console.log("Camera Recorder Started.");
    activeVideo = videoElement;

    // Initialize backend file
    try {
        await fetch("/start_camera_log", { method: "POST" });
    } catch (e) {
        console.error("Could not start log:", e);
    }

    recording = true;
    loop();
}

async function loop() {
    if (!recording) return;

    if (faceLandmarker && activeVideo && activeVideo.readyState >= 2) {
        // 1. Get raw data
        const results = faceLandmarker.detectForVideo(activeVideo, performance.now());
        
        // --- Send Blendshapes to Distraction Detector ---
        if (window._detectDistraction) {
            window._detectDistraction(activeVideo, results);
        }
        
        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
            const lm = results.faceLandmarks[0];
            const eyeIndices = [33, 133, 160, 158, 153, 144, 362, 263, 385, 387, 373, 380, 70, 63, 105, 66, 107, 336, 296, 334, 293, 300];
            let minX = 1, maxX = 0, minY = 1, maxY = 0;
            for (const idx of eyeIndices) {
                if (lm[idx]) {
                    minX = Math.min(minX, lm[idx].x);
                    maxX = Math.max(maxX, lm[idx].x);
                    minY = Math.min(minY, lm[idx].y);
                    maxY = Math.max(maxY, lm[idx].y);
                }
            }
            const padX = (maxX - minX) * 0.3;
            const padY = (maxY - minY) * 0.5;
            sessionStorage.setItem('_eye_crop_x', Math.max(0, minX - padX).toFixed(4));
            sessionStorage.setItem('_eye_crop_y', Math.max(0, minY - padY).toFixed(4));
            sessionStorage.setItem('_eye_crop_w', Math.min(1, maxX - minX + padX * 2).toFixed(4));
            sessionStorage.setItem('_eye_crop_h', Math.min(1, maxY - minY + padY * 2).toFixed(4));
        }

        if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
            const blend = results.faceBlendshapes[0].categories;

            const emotion = getEmotion(blend);
            const aus = getAUs(blend);

            const payload = {
                timestamp: new Date().toISOString(),
                emotion: emotion,
                AUs: aus
            };

            fetch("/append_camera_log", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            }).catch(e => console.log("Log error", e));
        }
    }

    // Loop at 30 FPS (Every 33ms)
    setTimeout(loop, 33);
}

export async function stopCameraRecording() {
    recording = false;
    await fetch("/end_camera_log", { method: "POST" });
    console.log("Camera Recorder Stopped.");
}
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
        
        if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
            const blend = results.faceBlendshapes[0].categories;
            
            // 2. Analyze
            const emotion = getEmotion(blend);
            const aus = getAUs(blend);

            // 3. SEND EVERYTHING 
            // We log every frame (even neutral) to ensure data completeness.
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
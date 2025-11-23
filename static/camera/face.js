// static/camera/face.js

import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

export let faceLandmarker = null;
export let videoEl = null;
export let isCameraReady = false;

export async function initFaceModel() {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
            // CRITICAL CHANGE: This URL points to the model WITH blendshapes
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true, // Now this will work because the model above supports it
        outputFacialTransformationMatrixes: true
    });

    console.log("Face Model Ready (with Blendshapes)");
}
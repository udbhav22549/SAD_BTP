/**
 * gaze_tracker.js
 * Core eye-tracking engine using MediaPipe Face Landmarker.
 * Provides: gaze estimation, blink detection, pupil dilation.
 */

class GazeTracker {
    constructor() {
        this.faceLandmarker = null;
        this.videoElement   = null;
        this.calibModel     = null;

        this.LEFT_EYE_EAR  = [33,  160, 158, 133, 153, 144];
        this.RIGHT_EYE_EAR = [362, 385, 387, 263, 373, 380];

        this.LEFT_IRIS_CENTER  = 468;
        this.RIGHT_IRIS_CENTER = 473;
        this.LEFT_IRIS_RING    = [468, 469, 470, 471, 472];
        this.RIGHT_IRIS_RING   = [473, 474, 475, 476, 477];

        this.LEFT_EYE_INNER  = 133;
        this.LEFT_EYE_OUTER  = 33;
        this.RIGHT_EYE_INNER = 362;
        this.RIGHT_EYE_OUTER = 263;

        this.EAR_THRESHOLD       = 0.22;
        this.BLINK_CONSEC_FRAMES = 2;
        this._blinkFrameCounter  = 0;
        this._blinkInProgress    = false;

        this.isReady = false;
    }

    async initialize(videoElement) {
        this.videoElement = videoElement;

        const vision = await import(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs"
        );

        const { FaceLandmarker, FilesetResolver } = vision;

        const filesetResolver = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );

        this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath:
                    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: true
        });

        this.isReady = true;
        console.log("[GazeTracker] MediaPipe FaceLandmarker ready");
    }

    setCalibrationModel(model) {
        this.calibModel = model;
    }

    _ear(lm, indices) {
        const p = indices.map(i => lm[i]);
        const v1 = this._dist(p[1], p[5]);
        const v2 = this._dist(p[2], p[4]);
        const h  = this._dist(p[0], p[3]);
        return (v1 + v2) / (2.0 * h + 1e-9);
    }

    _dist(a, b) {
        return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    }

    _irisNormalized(lm, centerIdx, innerCorner, outerCorner, topIdx, botIdx) {
        const iris  = lm[centerIdx];
        const inner = lm[innerCorner];
        const outer = lm[outerCorner];
        const top   = lm[topIdx];
        const bot   = lm[botIdx];

        const eyeW  = this._dist(inner, outer) + 1e-9;
        const eyeH  = this._dist(top, bot)     + 1e-9;
        const cx    = (inner.x + outer.x) / 2;
        const cy    = (top.y   + bot.y)   / 2;

        return {
            nx: (iris.x - cx) / eyeW,
            ny: (iris.y - cy) / eyeH
        };
    }

    _irisRadius(lm, ringIndices, innerCorner, outerCorner) {
        const center = lm[ringIndices[0]];
        let sumR = 0;
        for (let i = 1; i < ringIndices.length; i++) {
            sumR += this._dist(center, lm[ringIndices[i]]);
        }
        const radius   = sumR / (ringIndices.length - 1);
        const eyeWidth = this._dist(lm[innerCorner], lm[outerCorner]) + 1e-9;
        return radius / eyeWidth;
    }

    _headPose(matrices) {
        if (!matrices || matrices.length === 0) return { pitch: 0, yaw: 0, roll: 0 };
        const m = matrices[0].data;
        const pitch = Math.atan2(-m[9], m[10]) * (180 / Math.PI);
        const yaw   = Math.atan2(m[8],  Math.sqrt(m[9] ** 2 + m[10] ** 2)) * (180 / Math.PI);
        const roll  = Math.atan2(-m[4], m[0])  * (180 / Math.PI);
        return { pitch, yaw, roll };
    }

    processFrame(timestampMs) {
        if (!this.isReady || !this.videoElement || this.videoElement.readyState < 2) return null;

        if (!this._lastTimestamp) this._lastTimestamp = 0;
        if (timestampMs <= this._lastTimestamp) {
            timestampMs = this._lastTimestamp + 1;
        }
        this._lastTimestamp = timestampMs;

        let results;
        try {
            results = this.faceLandmarker.detectForVideo(this.videoElement, timestampMs);
        } catch (e) {
            return null;
        }

        if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
            return null;
        }

        const lm = results.faceLandmarks[0];

        const earLeft  = this._ear(lm, this.LEFT_EYE_EAR);
        const earRight = this._ear(lm, this.RIGHT_EYE_EAR);
        const avgEAR   = (earLeft + earRight) / 2;

        let blinkEvent = false;
        if (avgEAR < this.EAR_THRESHOLD) {
            this._blinkFrameCounter++;
            this._blinkInProgress = true;
        } else {
            if (this._blinkInProgress && this._blinkFrameCounter >= this.BLINK_CONSEC_FRAMES) {
                blinkEvent = true;
            }
            this._blinkFrameCounter = 0;
            this._blinkInProgress   = false;
        }

        const eyesClosed = avgEAR < this.EAR_THRESHOLD;

        const leftIris  = this._irisNormalized(lm, this.LEFT_IRIS_CENTER,
                                                this.LEFT_EYE_INNER, this.LEFT_EYE_OUTER,
                                                this.LEFT_EYE_EAR[1], this.LEFT_EYE_EAR[5]);
        const rightIris = this._irisNormalized(lm, this.RIGHT_IRIS_CENTER,
                                                this.RIGHT_EYE_INNER, this.RIGHT_EYE_OUTER,
                                                this.RIGHT_EYE_EAR[1], this.RIGHT_EYE_EAR[5]);

        const rawIrisX = (leftIris.nx  + rightIris.nx)  / 2;
        const rawIrisY = (leftIris.ny  + rightIris.ny)  / 2;

        const dilLeft  = this._irisRadius(lm, this.LEFT_IRIS_RING,
                                           this.LEFT_EYE_INNER, this.LEFT_EYE_OUTER);
        const dilRight = this._irisRadius(lm, this.RIGHT_IRIS_RING,
                                           this.RIGHT_EYE_INNER, this.RIGHT_EYE_OUTER);

        const headPose = this._headPose(results.facialTransformationMatrixes);

        let gazeX = null, gazeY = null;
        if (this.calibModel && !eyesClosed) {
            const g = this.calibModel.predict(rawIrisX, rawIrisY);
            gazeX   = g.x;
            gazeY   = g.y;
        }

        return {
            earLeft,
            earRight,
            eyesClosed,
            blinkEvent,
            rawIrisX,
            rawIrisY,
            pupilDilationLeft:  dilLeft,
            pupilDilationRight: dilRight,
            gazeX,
            gazeY,
            headPitch: headPose.pitch,
            headYaw:   headPose.yaw,
            headRoll:  headPose.roll
        };
    }

    getRawIris(timestampMs) {
        if (!this.isReady || !this.videoElement || this.videoElement.readyState < 2) return null;

        // MediaPipe requires strictly increasing timestamps
        if (!this._lastTimestamp) this._lastTimestamp = 0;
        if (timestampMs <= this._lastTimestamp) {
            timestampMs = this._lastTimestamp + 1;
        }
        this._lastTimestamp = timestampMs;

        let results;
        try {
            results = this.faceLandmarker.detectForVideo(this.videoElement, timestampMs);
        } catch (e) {
            console.warn("[GazeTracker] detectForVideo error:", e);
            return null;
        }

        if (!results || !results.faceLandmarks || results.faceLandmarks.length === 0) return null;

        const lm = results.faceLandmarks[0];
        const li = this._irisNormalized(lm, this.LEFT_IRIS_CENTER,
                                         this.LEFT_EYE_INNER, this.LEFT_EYE_OUTER,
                                         this.LEFT_EYE_EAR[1], this.LEFT_EYE_EAR[5]);
        const ri = this._irisNormalized(lm, this.RIGHT_IRIS_CENTER,
                                         this.RIGHT_EYE_INNER, this.RIGHT_EYE_OUTER,
                                         this.RIGHT_EYE_EAR[1], this.RIGHT_EYE_EAR[5]);
        return {
            x: (li.nx + ri.nx) / 2,
            y: (li.ny + ri.ny) / 2
        };
    }

    destroy() {
        if (this.faceLandmarker) {
            this.faceLandmarker.close();
            this.faceLandmarker = null;
        }
        this.isReady = false;
    }
}

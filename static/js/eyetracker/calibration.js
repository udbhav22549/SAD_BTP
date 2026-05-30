/**
 * calibration.js
 * 5-point gaze calibration with affine (6-parameter) mapping.
 */

class CalibrationModel {
    constructor(coeffs, sw, sh) {
        this.coeffs = coeffs;
        this.sw = sw;
        this.sh = sh;
    }

    predict(irisX, irisY) {
        const { ax, bx, cx, ay, by, cy } = this.coeffs;
        const x = ax * irisX + bx * irisY + cx;
        const y = ay * irisX + by * irisY + cy;
        return {
            x: Math.max(0, Math.min(this.sw, x)),
            y: Math.max(0, Math.min(this.sh, y))
        };
    }

    toJSON() {
        return { coeffs: this.coeffs, sw: this.sw, sh: this.sh };
    }

    static fromJSON(obj) {
        return new CalibrationModel(obj.coeffs, obj.sw, obj.sh);
    }
}

function _ols(designMatrix, targets) {
    const n = designMatrix.length;
    const p = 3;

    const ATA = [[0,0,0],[0,0,0],[0,0,0]];
    for (let i = 0; i < n; i++) {
        for (let r = 0; r < p; r++) {
            for (let c = 0; c < p; c++) {
                ATA[r][c] += designMatrix[i][r] * designMatrix[i][c];
            }
        }
    }

    const ATb = [0, 0, 0];
    for (let i = 0; i < n; i++) {
        for (let r = 0; r < p; r++) {
            ATb[r] += designMatrix[i][r] * targets[i];
        }
    }

    const inv = _inv3x3(ATA);
    const coeffs = [0, 0, 0];
    for (let r = 0; r < p; r++) {
        for (let c = 0; c < p; c++) {
            coeffs[r] += inv[r][c] * ATb[c];
        }
    }
    return coeffs;
}

function _inv3x3(m) {
    const det = (
          m[0][0] * (m[1][1]*m[2][2] - m[1][2]*m[2][1])
        - m[0][1] * (m[1][0]*m[2][2] - m[1][2]*m[2][0])
        + m[0][2] * (m[1][0]*m[2][1] - m[1][1]*m[2][0])
    );
    if (Math.abs(det) < 1e-12) {
        console.warn("[Calibration] Near-singular matrix; using identity");
        return [[1,0,0],[0,1,0],[0,0,1]];
    }
    return [
        [
            (m[1][1]*m[2][2] - m[1][2]*m[2][1]) / det,
            (m[0][2]*m[2][1] - m[0][1]*m[2][2]) / det,
            (m[0][1]*m[1][2] - m[0][2]*m[1][1]) / det
        ],
        [
            (m[1][2]*m[2][0] - m[1][0]*m[2][2]) / det,
            (m[0][0]*m[2][2] - m[0][2]*m[2][0]) / det,
            (m[0][2]*m[1][0] - m[0][0]*m[1][2]) / det
        ],
        [
            (m[1][0]*m[2][1] - m[1][1]*m[2][0]) / det,
            (m[0][1]*m[2][0] - m[0][0]*m[2][1]) / det,
            (m[0][0]*m[1][1] - m[0][1]*m[1][0]) / det
        ]
    ];
}

function _fitCalibrationModel(points, sw, sh) {
    const design   = points.map(p => [p.irisX, p.irisY, 1]);
    const targetsX = points.map(p => p.screenX);
    const targetsY = points.map(p => p.screenY);

    const [ax, bx, cx] = _ols(design, targetsX);
    const [ay, by, cy] = _ols(design, targetsY);

    return new CalibrationModel({ ax, bx, cx, ay, by, cy }, sw, sh);
}

class CalibrationManager {
    constructor(gazeTracker, dotEl, overlayEl, onComplete, onProgress, onRetry) {
        this.tracker    = gazeTracker;
        this.dot        = dotEl;
        this.overlay    = overlayEl;
        this.onComplete = onComplete;
        this.onProgress = onProgress || (() => {});
        this.onRetry    = onRetry    || (() => {});

        this.TARGETS = [
            { fx: 0.50, fy: 0.50 },
            { fx: 0.92, fy: 0.08 },
            { fx: 0.92, fy: 0.92 },
            { fx: 0.08, fy: 0.92 },
            { fx: 0.08, fy: 0.08 },
        ];

        this.COLLECT_DURATION_MS  = 1500;
        this.TRANSITION_DELAY_MS  = 800;
        this.SHRINK_DURATION_MS   = 300;

        this._collectedPoints = [];
        this._currentStep     = -1;
    }

    async start() {
        this.overlay.style.display = 'block';
        this._collectedPoints = [];
        this._currentStep     = 0;
        await this._runStep(0);
    }

    async _runStep(stepIdx) {
        if (stepIdx >= this.TARGETS.length) {
            await this._finish();
            return;
        }

        const target = this.TARGETS[stepIdx];
        const sw     = window.innerWidth;
        const sh     = window.innerHeight;
        const sx     = target.fx * sw;
        const sy     = target.fy * sh;

        this.onProgress(stepIdx, this.TARGETS.length);

        this._moveDot(sx, sy);
        await this._sleep(this.TRANSITION_DELAY_MS);

        this.dot.classList.add('active');

        const samples = await this._collectSamples(sx, sy, this.COLLECT_DURATION_MS);

        if (samples.length > 0) {
            this._collectedPoints.push(...samples);
        }

        this.dot.classList.remove('active');
        await this._sleep(this.SHRINK_DURATION_MS);

        await this._runStep(stepIdx + 1);
    }

    _collectSamples(screenX, screenY, durationMs) {
        return new Promise(resolve => {
            const samples   = [];
            const startTime = performance.now();
            let nullCount   = 0;
            const loopId    = setInterval(() => {
                const ts  = performance.now();
                const raw = this.tracker.getRawIris(ts);
                if (raw) {
                    samples.push({ screenX, screenY, irisX: raw.x, irisY: raw.y });
                } else {
                    nullCount++;
                }
                if (ts - startTime >= durationMs) {
                    clearInterval(loopId);
                    console.log(`[Calibration] Point (${screenX.toFixed(0)}, ${screenY.toFixed(0)}): ${samples.length} samples, ${nullCount} nulls`);
                    resolve(samples);
                }
            }, 33);
        });
    }

    async _finish() {
        this.overlay.style.display = 'none';

        if (this._collectedPoints.length < 10) {
            this.onRetry();
            return;
        }

        const sw    = window.innerWidth;
        const sh    = window.innerHeight;
        const model = _fitCalibrationModel(this._collectedPoints, sw, sh);

        this.onComplete(model);
    }

    _moveDot(x, y) {
        this.dot.style.left = `${x}px`;
        this.dot.style.top  = `${y}px`;
    }

    _sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}

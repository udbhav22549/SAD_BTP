/**
 * gaze_logger.js
 * Real-time gaze feature extraction and logging.
 * Computes fixations (I-DT), saccades, blinks, pupil dilation.
 */

class GazeLogger {
    constructor(opts = {}) {
        this.fixationWindowMs    = opts.fixationWindowMs    ?? 100;
        this.fixationThresholdPx = opts.fixationThresholdPx ?? 50;
        this.saccadeVelocityPx   = opts.saccadeVelocityPx   ?? 400;
        this.sessionStartTime    = opts.sessionStartTime    ?? performance.now();

        this._rawSamples = [];
        this._window     = [];

        this._inFixation       = false;
        this._fixationStartT   = 0;
        this._fixationCentreX  = 0;
        this._fixationCentreY  = 0;
        this._fixationCount    = 0;
        this._fixationDurations = [];

        this._prevGazeX  = null;
        this._prevGazeY  = null;
        this._prevGazeT  = null;
        this._inSaccade  = false;
        this._saccadeCount = 0;
        this._saccadeVelocities = [];

        this._blinkCount      = 0;
        this._blinkStartT     = null;
        this._blinkDurations  = [];
        this._prevEyesClosed  = false;

        this._pupilBuffer = [];
        this.PUPIL_BUF_LEN = 30;
    }

    addSample(gazeResult, isoTimestamp) {
        const now = performance.now();
        const te  = now - this.sessionStartTime;

        if (!gazeResult) return;

        const {
            gazeX, gazeY,
            rawIrisX, rawIrisY,
            earLeft, earRight,
            eyesClosed, blinkEvent,
            pupilDilationLeft, pupilDilationRight,
            headPitch, headYaw, headRoll
        } = gazeResult;

        if (eyesClosed && !this._prevEyesClosed) {
            this._blinkStartT = now;
        }
        if (!eyesClosed && this._prevEyesClosed && this._blinkStartT !== null) {
            const dur = now - this._blinkStartT;
            this._blinkDurations.push(dur);
            this._blinkStartT = null;
        }
        if (blinkEvent) this._blinkCount++;
        this._prevEyesClosed = eyesClosed;

        const avgDil = (pupilDilationLeft + pupilDilationRight) / 2;
        this._pupilBuffer.push(avgDil);
        if (this._pupilBuffer.length > this.PUPIL_BUF_LEN) this._pupilBuffer.shift();

        let fixation    = false;
        let fixationX   = null;
        let fixationY   = null;
        let fixDurMs    = null;
        let saccade     = false;
        let saccadeVel  = null;

        if (gazeX !== null && gazeY !== null && !eyesClosed) {
            const pt = { x: gazeX, y: gazeY, t: now };

            if (this._prevGazeX !== null) {
                const dx  = gazeX - this._prevGazeX;
                const dy  = gazeY - this._prevGazeY;
                const dt  = (now - this._prevGazeT) / 1000;
                const vel = Math.sqrt(dx * dx + dy * dy) / (dt + 1e-9);
                saccadeVel = Math.round(vel);

                if (vel > this.saccadeVelocityPx) {
                    saccade = true;
                    if (!this._inSaccade) {
                        this._saccadeCount++;
                        this._inSaccade = true;
                    }
                    this._saccadeVelocities.push(vel);
                } else {
                    this._inSaccade = false;
                }
            }
            this._prevGazeX = gazeX;
            this._prevGazeY = gazeY;
            this._prevGazeT = now;

            this._window.push(pt);
            while (this._window.length > 1 && (now - this._window[0].t) > this.fixationWindowMs) {
                this._window.shift();
            }

            if (this._window.length >= 3) {
                const xs = this._window.map(p => p.x);
                const ys = this._window.map(p => p.y);
                const dispersion = (Math.max(...xs) - Math.min(...xs)) +
                                   (Math.max(...ys) - Math.min(...ys));

                if (dispersion < this.fixationThresholdPx) {
                    fixation = true;
                    fixationX = xs.reduce((a, b) => a + b) / xs.length;
                    fixationY = ys.reduce((a, b) => a + b) / ys.length;

                    if (!this._inFixation) {
                        this._inFixation     = true;
                        this._fixationStartT = now;
                        this._fixationCount++;
                        this._fixationCentreX = fixationX;
                        this._fixationCentreY = fixationY;
                    } else {
                        fixDurMs = now - this._fixationStartT;
                    }
                } else {
                    if (this._inFixation) {
                        const dur = now - this._fixationStartT;
                        if (dur > 50) this._fixationDurations.push(dur);
                    }
                    this._inFixation = false;
                }
            }
        }

        const row = {
            timestamp:           isoTimestamp,
            time_elapsed_ms:     Math.round(te),
            gaze_x:              gazeX !== null ? Math.round(gazeX) : '',
            gaze_y:              gazeY !== null ? Math.round(gazeY) : '',
            raw_iris_x:          rawIrisX  !== undefined ? rawIrisX.toFixed(4)  : '',
            raw_iris_y:          rawIrisY  !== undefined ? rawIrisY.toFixed(4)  : '',
            ear_left:            earLeft   !== undefined ? earLeft.toFixed(4)   : '',
            ear_right:           earRight  !== undefined ? earRight.toFixed(4)  : '',
            blink:               eyesClosed ? 1 : 0,
            pupil_dilation_left:  pupilDilationLeft  !== undefined ? pupilDilationLeft.toFixed(4)  : '',
            pupil_dilation_right: pupilDilationRight !== undefined ? pupilDilationRight.toFixed(4) : '',
            fixation:            fixation ? 1 : 0,
            fixation_x:          fixationX !== null ? Math.round(fixationX) : '',
            fixation_y:          fixationY !== null ? Math.round(fixationY) : '',
            fixation_duration_ms: fixDurMs !== null ? Math.round(fixDurMs) : '',
            saccade:             saccade ? 1 : 0,
            saccade_velocity_px_per_s: saccadeVel !== null ? saccadeVel : '',
            head_pitch:          headPitch !== undefined ? headPitch.toFixed(2) : '',
            head_yaw:            headYaw   !== undefined ? headYaw.toFixed(2)   : '',
            head_roll:           headRoll  !== undefined ? headRoll.toFixed(2)  : '',
        };

        this._rawSamples.push(row);
    }

    getSummary(totalDurationMs) {
        const totalDurationMin  = totalDurationMs / 60000;
        const blinkRate         = totalDurationMin > 0 ? (this._blinkCount / totalDurationMin) : 0;
        const avgBlinkDuration  = this._blinkDurations.length > 0
            ? this._blinkDurations.reduce((a, b) => a + b, 0) / this._blinkDurations.length
            : 0;
        const avgFixationDur    = this._fixationDurations.length > 0
            ? this._fixationDurations.reduce((a, b) => a + b, 0) / this._fixationDurations.length
            : 0;
        const avgSaccadeVel     = this._saccadeVelocities.length > 0
            ? this._saccadeVelocities.reduce((a, b) => a + b, 0) / this._saccadeVelocities.length
            : 0;
        const medianPupil       = _median(this._pupilBuffer);

        return {
            total_duration_ms:            Math.round(totalDurationMs),
            total_samples:                this._rawSamples.length,
            blink_count:                  this._blinkCount,
            blink_rate_per_min:           blinkRate.toFixed(2),
            avg_blink_duration_ms:        avgBlinkDuration.toFixed(1),
            min_blink_duration_ms:        this._blinkDurations.length > 0 ? Math.min(...this._blinkDurations).toFixed(1) : 0,
            max_blink_duration_ms:        this._blinkDurations.length > 0 ? Math.max(...this._blinkDurations).toFixed(1) : 0,
            fixation_count:               this._fixationCount,
            avg_fixation_duration_ms:     avgFixationDur.toFixed(1),
            saccade_count:                this._saccadeCount,
            avg_saccade_velocity_px_per_s: avgSaccadeVel.toFixed(1),
            median_pupil_dilation_ratio:  medianPupil.toFixed(4),
            fixation_durations_ms:        this._fixationDurations.map(d => Math.round(d)),
            blink_durations_ms:           this._blinkDurations.map(d => Math.round(d)),
        };
    }

    getRawSamples() {
        return this._rawSamples;
    }

    toCSVString() {
        if (this._rawSamples.length === 0) return '';
        const headers = Object.keys(this._rawSamples[0]);
        const rows    = this._rawSamples.map(r =>
            headers.map(h => r[h] !== undefined ? r[h] : '').join(',')
        );
        return [headers.join(','), ...rows].join('\n');
    }

    downloadCSV(filename = 'gaze_data.csv') {
        const csv  = this.toCSVString();
        const blob = new Blob([csv], { type: 'text/csv' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
}

function _median(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid    = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

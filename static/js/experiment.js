document.addEventListener("DOMContentLoaded", () => {

    let currentScreen = "start";
    let currentQuestion = 0;
    let sessionEnded = false;
    let sessionActive = false;
    let sessionStartTime = null;
    window.currentInterval = null;

    // --- Global Timer Variables ---
    let globalTimerInterval = null;
    const globalTimerBar = document.getElementById('globalTimer');

    // --- MCQ Data ---
    let mcqQuestions = [];
    let mcqAnswers = {}; 
    let currentMcqIndex = 0;
    let mcqVisited = new Set();
    let mcqPrevAnswer = {}; 
    let lastMcqIndex = null; 
    let mcqMarked = {};

    // --- Feedback Data ---
    let feedbackQuestions = [];
    let firstSeenTime = {};
    let feedbackIndex = 0;
    let feedbackData = {
        confidence: [],
        guess: [],
        guessType: []
    };

    // --- Image Task Data ---
    let imageIndex = 0;
    let imageDescriptions = [];
    const imageList = ["/static/stage_5_img_0.jpg", "/static/stage_5_img_1.jpg"];

    // --- DOM Elements ---
    const container = document.getElementById('container');
    const alertSound = document.getElementById('alertSound');
    const endBtn = document.getElementById('endBtn');
    const exitBtn = document.getElementById('exitBtn');

    let paragraphText = "";
    let questions = [];

    let cameraModulesLoaded = false;
    let initFaceModel, setupCamera, startCameraRecording, stopCameraRecording;

    // ==========================================
    //  NEW: GLOBAL TIMER FUNCTIONS
    // ==========================================
    function formatTime(sec) {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${s.toString().padStart(2, "0")}`;
    }

    function startGlobalTimer(totalSeconds, label, onEnd) {
        if (!globalTimerBar) return;

        // Clear existing
        if (globalTimerInterval) clearInterval(globalTimerInterval);
        
        let remaining = totalSeconds;
        globalTimerBar.classList.remove("hidden");
        globalTimerBar.style.display = "block"; // Force show
        globalTimerBar.textContent = `${label} — ${formatTime(remaining)}`;

        globalTimerInterval = setInterval(() => {
            remaining--;
            if (remaining < 0) {
                clearInterval(globalTimerInterval);
                globalTimerBar.textContent = `${label} — 0:00`;
                if (typeof onEnd === "function") onEnd();
            } else {
                globalTimerBar.textContent = `${label} — ${formatTime(remaining)}`;
            }
        }, 1000);
    }

    function clearGlobalTimer() {
        if (globalTimerInterval) clearInterval(globalTimerInterval);
        if (globalTimerBar) {
            globalTimerBar.classList.add("hidden");
            globalTimerBar.style.display = "none";
        }
    }

    // ==========================================
    //  EXISTING LOADING LOGIC
    // ==========================================

    async function loadCameraModules() {
        if (cameraModulesLoaded) return;

        const face = await import("/static/camera/face.js");
        const recorder = await import("/static/camera/recorder.js");

        initFaceModel = face.initFaceModel;
        setupCamera = async function() {
            const videoEl = document.getElementById("videoCam");
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            videoEl.srcObject = stream;

            return new Promise(res => {
                videoEl.onloadedmetadata = () => res();
            });
        };
        startCameraRecording = recorder.startCameraRecording;
        stopCameraRecording = recorder.stopCameraRecording;

        cameraModulesLoaded = true;
        console.log("Camera modules loaded.");
    }

    async function loadExperimentData() {
        const [paraRes, quesRes, mcqRes, fbRes] = await Promise.all([
            fetch('/get_paragraph'),
            fetch('/get_questions'),
            fetch('/get_mcq_questions'),
            fetch('/get_feedback_questions')
        ]);

        const paraData = await paraRes.json();
        const quesData = await quesRes.json();
        const mcqData = await mcqRes.json();
        const fbData = await fbRes.json();

        paragraphText = paraData.paragraph;
        questions = quesData.questions;
        mcqQuestions = mcqData.questions;
        feedbackQuestions = fbData.questions;

        console.log("Loaded paragraph:", paragraphText);
        console.log("Loaded subjective questions:", questions.length);
        console.log("Loaded MCQs:", mcqQuestions.length);
        console.log("Loaded Feedback:", feedbackQuestions.length);
    }

    loadExperimentData();

    function getISTTimestamp() {
        const now = new Date();
        const utc = now.getTime() + now.getTimezoneOffset() * 60000;
        const ist = new Date(utc + 5.5 * 60 * 60 * 1000);
        return ist.toISOString().replace("T", " ").split(".")[0] + " IST"; // Simple format
    }

    function getElapsedSeconds() {
        if (!sessionStartTime) return 0;
        return Math.floor((Date.now() - sessionStartTime) / 1000);
    }

    function logEvent(stage, variable_field = {}) {
        const payload = {
            stage: stage,
            timestamp: getISTTimestamp(),
            time_elapsed: getElapsedSeconds(),
            variable_field: variable_field
        };
        console.log("Logging event:", payload);
        fetch('/log_event', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        }).catch(err => console.warn('logEvent failed', err));
    }

    function toggleEndSession(show) {
        document.getElementById("endBtn").style.display = show ? 'inline-block' : 'none';
    }
    function toggleExit(show) {
        document.getElementById("exitBtn").style.display = show ? 'inline-block' : 'none';
    }

    // ==========================================
    //  START SCREEN
    // ==========================================

    function renderStartScreen() {
        sessionActive = false;
        sessionEnded = false;
        currentQuestion = 0;
        currentScreen = "start";
        sessionStartTime = null;
        // container.innerHTML = `
        //     <button id="startBtn" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-8 rounded-lg text-2xl">
        //     Start Experiment
        //     </button>
        // `;
        
        // --- FIX: Attach listener so button works ---
        document.getElementById("startBtn").addEventListener("click", startNewSession);
        
        sessionActive = false;
        toggleEndSession(false);
        toggleExit(true);
    }

    // Keep your old startTimer for internal use if needed (local display)
    function startTimer(duration, onEnd, displayText, showNext = false) {
        let timeLeft = duration;
        container.innerHTML = `
            <h1 class="text-3xl font-semibold mb-6">${displayText}</h1>
            <div class="text-6xl font-bold mb-6" id="countdown">${timeLeft}</div>
            <div class="w-full bg-gray-300 rounded-full h-6 mb-6">
            <div id="progressBar" class="bg-green-500 h-6 rounded-full w-0"></div>
            </div>
            ${showNext ? '<button id="nextBtn" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-lg text-lg">Next</button>' : ''}
        `;

        const progressBar = document.getElementById('progressBar');

        if(window.currentInterval) clearInterval(window.currentInterval);
        window.currentInterval = setInterval(() => {
            timeLeft--;
            const countdownEl = document.getElementById('countdown');
            if(countdownEl) countdownEl.textContent = timeLeft;
            if(progressBar) progressBar.style.width = `${((duration - timeLeft)/duration)*100}%`;
            if(timeLeft <= 0) {
            clearInterval(window.currentInterval);
            window.currentInterval = null;
            onEnd();
            }
        }, 1000);

        if (showNext) {
            const nextBtn = document.getElementById('nextBtn');
            nextBtn.addEventListener('click', () => {
            clearInterval(window.currentInterval);
            window.currentInterval = null;
            onEnd(); 
            });
        }
    }

    async function startNewSession() {
        console.log('Starting new session');

        await loadCameraModules();
        await initFaceModel();
        
        // Fix: get video element before setup
        const videoElement = document.getElementById("videoCam");
        if (!videoElement) return alert("Video element missing");

        await setupCamera();
        
        const resp = await fetch('/start_session', { method: 'POST' });
        if (!resp.ok) {
            if (resp.status === 401) window.location.href = '/login';
            return;
        }

        // Fix: pass element to recorder
        startCameraRecording(videoElement);

        sessionStartTime = Date.now();
        logEvent('session_started');
        sessionActive = true;
        sessionEnded = false;
        toggleEndSession(true);
        toggleExit(false);
        startEyesClosed();
    }

    // ==========================================
    //  STAGES WITH TIMERS ADDED
    // ==========================================

    function startEyesClosed() {
        currentScreen = "eyes_closed";
        startTimer(30, () => {
            alertSound.play();
            logEvent('eyes_closed_finished');
            showParagraph();
        }, "Close your eyes!");
        toggleExit(false);
        toggleEndSession(true);
    }

    function showParagraph() {
        currentScreen = "paragraph";
        const paragraph = paragraphText || "Default paragraph text.";

        // --- TIMER: 1 Minute 30 Seconds (90s) ---
        startGlobalTimer(90, "Stage-1", () => {
            logEvent("speech_baseline_timeout");
            showQuestion();
        });

        container.innerHTML = `
            <h1 class="text-2xl font-semibold mb-6">Please read the following paragraph carefully:</h1>
            <p class="text-lg text-gray-700 mb-8">${paragraph}</p>
            <button id="nextParagraphBtn" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-lg text-xl">
            Next
            </button>
        `;

        document.getElementById('nextParagraphBtn').addEventListener('click', () => {
            logEvent('paragraph_finished');
            alertSound.play();
            showQuestion();
        });
        toggleExit(false);
        toggleEndSession(true);
    }

    function showQuestion() {
        
        // --- LOGIC TO START STAGE TIMERS ---
        // Q1 (Index 0): Start 8 Minute Timer for first 4 questions
        if (currentQuestion === 0) {
            startGlobalTimer(8 * 60, "Stage-2", () => {
                logEvent("stage2_timeout");
                currentQuestion = 4; // Jump to next set
                showQuestion();
            });
        } 
        // Q5 (Index 4): Start 10 Minute Timer for next 4 questions
        else if (currentQuestion === 4) {
            startGlobalTimer(10 * 60, "Stage-3", () => {
                logEvent("stage3_timeout");
                showMcqSection(); // Jump to MCQ
            });
        }

        if(currentQuestion >= questions.length) {
            logEvent('subjective_section_finished');
            showMcqSection();
            return;
        }

        // NOTE: I replaced your local startTimer(15) with the display code below
        // because the 8/10 minute section timers override the 15s per-question timer.
        const q = questions[currentQuestion];
        
        container.innerHTML = `
            <h1 class="text-3xl font-bold mb-6">Question ${currentQuestion + 1}</h1>
            <p class="text-xl mb-6">${q}</p>
            <button id="nextQuestionBtn" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-lg text-lg">Next</button>
        `;

        document.getElementById('nextQuestionBtn').addEventListener('click', () => {
            logEvent(`question_${currentQuestion+1}_finished`);
            currentQuestion++;
            showQuestion();
        });

        toggleExit(false);
        toggleEndSession(true);
    }

    function showMcqSection() {
        currentScreen = "mcq_section";
        currentMcqIndex = 0;
        mcqAnswers = {};

        // --- TIMER: 30 Minutes ---
        startGlobalTimer(30 * 60, "Stage-4", () => {
            logEvent("mcq_timeout");
            showFeedbackForm();
        });

        container.innerHTML = `
            <h1 class="text-3xl font-bold mb-6">MCQ Section</h1>

            <div id="mcqNav" class="grid grid-cols-10 gap-2 mb-6"></div>

            <div id="mcqContainer"></div>

            <div class="mt-6">
            <button id="prevMcq" class="bg-gray-400 text-white font-bold py-2 px-4 rounded mr-2">Previous</button>
            <button id="nextMcq" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded">Next</button>
            <button id="submitMcqs" class="hidden bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded ml-2">Submit</button>
            </div>
        `;

        renderMcqNav();
        renderMcqQuestion();
        toggleExit(false);
        toggleEndSession(true);
    }

    function renderMcqNav() {
        const navContainer = document.getElementById('mcqNav');
        if (!navContainer) return;

        let navButtons = '';

        for (let i = 0; i < mcqQuestions.length; i++) {
            const isMarked = mcqMarked[i];
            const isAnswered = mcqAnswers[i] !== null && mcqAnswers[i] !== undefined;

            let classes = "rounded-full w-10 h-10 flex items-center justify-center font-semibold transition border ";

            if (isMarked && isAnswered) {
                classes += "bg-amber-500 text-white border-amber-600";
            } else if (isMarked) {
                classes += "border-amber-500 text-amber-600 bg-white";
            } else if (isAnswered) {
                classes += "bg-green-500 text-white border-green-600";
            } else {
                classes += "border-gray-300 text-gray-700 bg-gray-100";
            }

            if (i === currentMcqIndex) {
                classes += " ring-2 ring-indigo-500";
            }

            navButtons += `
                <button data-index="${i}"
                        class="${classes}">
                    ${i + 1}
                </button>
            `;
        }

        navContainer.innerHTML = navButtons;

        document.querySelectorAll('#mcqNav button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const selected = document.querySelector('input[name="mcq"]:checked');
                if (selected) mcqAnswers[currentMcqIndex] = selected.value;

                const newIndex = parseInt(e.target.dataset.index, 10);
                currentMcqIndex = newIndex;
                renderMcqQuestion();
            });
        });
    }

    function renderMcqQuestion() {
        const q = mcqQuestions[currentMcqIndex];
        const savedAnswer = mcqAnswers[currentMcqIndex];
        const mcqContainer = document.getElementById('mcqContainer');
        if (!mcqContainer || !q) return;

        if (!firstSeenTime[currentMcqIndex]) {
            firstSeenTime[currentMcqIndex] = getElapsedSeconds();
        }

        if (!mcqVisited.has(currentMcqIndex)) {
            mcqVisited.add(currentMcqIndex);
            logEvent("Qfirstseen", {
                Qn: currentMcqIndex,
                FirsttimeSeen: firstSeenTime[currentMcqIndex]
            });
        }

        if (lastMcqIndex !== null && lastMcqIndex !== currentMcqIndex) {
            logEvent("QChange", {
                Qn: lastMcqIndex,
                Qnto: currentMcqIndex,
                submitted: mcqAnswers[lastMcqIndex] ? "Yes" : "No"
            });
        }
        lastMcqIndex = currentMcqIndex;

        const optionsHtml = q.options.map(opt => `
            <label class="block text-left border rounded-lg p-2 mb-2 cursor-pointer hover:bg-gray-100">
                <input type="radio" name="mcq" value="${opt}" ${savedAnswer === opt ? 'checked' : ''} class="mr-2">
                ${opt}
            </label>
        `).join('');

        mcqContainer.innerHTML = `
            <h2 class="text-xl font-semibold mb-4">Q${currentMcqIndex + 1}. ${q.question}</h2>
            ${optionsHtml}
            <button id="markBtn" class="mt-4 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded">
                ${mcqMarked[currentMcqIndex] ? "Unmark" : "Mark for Review"}
            </button>
        `;

        renderMcqNav();

        const prevBtn = document.getElementById('prevMcq');
        if (prevBtn) {
            prevBtn.style.display = currentMcqIndex > 0 ? 'inline-block' : 'none';
        }

        const submitBtn = document.getElementById('submitMcqs');
        const nextBtn = document.getElementById('nextMcq');
        if (currentMcqIndex === mcqQuestions.length - 1) {
            if (nextBtn) nextBtn.classList.add('hidden');
            if (submitBtn) submitBtn.classList.remove('hidden');
        } else {
            if (nextBtn) nextBtn.classList.remove('hidden');
            if (submitBtn) submitBtn.classList.add('hidden');
        }

        document.querySelectorAll('input[name="mcq"]').forEach(input => {
            input.addEventListener('change', () => {
                const selected = input.value;
                const firstSeen = firstSeenTime[currentMcqIndex];
                const responseTime = getElapsedSeconds() - firstSeen;

                logEvent("QSubmit", {
                    Qn: currentMcqIndex,
                    Soption: selected,
                    FirsttimeSeen: firstSeen,
                    ResponseTime: responseTime
                });

                mcqAnswers[currentMcqIndex] = selected;
                mcqPrevAnswer[currentMcqIndex] = selected;

                renderMcqNav();
            });
        });

        const markBtn = document.getElementById("markBtn");
        if (markBtn) {
            markBtn.addEventListener("click", () => {
                mcqMarked[currentMcqIndex] = !mcqMarked[currentMcqIndex];

                logEvent(mcqMarked[currentMcqIndex] ? "QMark" : "QUnmark", {
                    Qn: currentMcqIndex,
                    Marked: mcqMarked[currentMcqIndex]
                });

                renderMcqQuestion();
            });
        }
    }

    container.addEventListener('click', (e) => {
        if (e.target.id === 'nextMcq') {
            const selected = document.querySelector('input[name="mcq"]:checked');
            if (selected) mcqAnswers[currentMcqIndex] = selected.value;
            if (currentMcqIndex < mcqQuestions.length - 1) {
                currentMcqIndex++;
                renderMcqQuestion();
            }
        }

        if (e.target.id === 'prevMcq') {
            const selected = document.querySelector('input[name="mcq"]:checked');
            if (selected) mcqAnswers[currentMcqIndex] = selected.value;
            if (currentMcqIndex > 0) {
                currentMcqIndex--;
                renderMcqQuestion();
            }
        }

        if (e.target.id === 'submitMcqs') {
            const selected = document.querySelector('input[name="mcq"]:checked');
            if (selected) mcqAnswers[currentMcqIndex] = selected.value;

            if (Object.keys(mcqAnswers).length < mcqQuestions.length) {
                alert("Please answer all questions before submitting.");
                return;
            }

            logEvent("End", {});
            showFeedbackForm();
        }
    });

    function showScoreCard() {
        toggleExit(true);
        toggleEndSession(false);

        let score = 0;
        mcqQuestions.forEach((q, i) => {
            if (mcqAnswers[i] === q.answer) score++;
        });

        let answerStatus = mcqQuestions.map((q, i) =>
            mcqAnswers[i] === q.answer ? "correct" : "incorrect"
        );

        logEvent("SCORE", {
            score: score,
            answerStatus: answerStatus
        });

        container.innerHTML = `
            <h1 class="text-4xl font-bold text-green-600 mb-4">Scorecard</h1>

            <p class="text-lg mb-6">
                You answered 
                <b>${score}</b> out of <b>${mcqQuestions.length}</b> correctly.
            </p>

            <button id="finishBtn"
                class="bg-indigo-600 hover:bg-indigo-700 text-white 
                    font-bold py-3 px-6 rounded-lg text-xl">
                Finish →
            </button>
        `;
    }

    function showFeedbackForm() {
        currentScreen = "feedback";
        toggleExit(false);
        toggleEndSession(true);
        
        // Stop MCQ Timer
        clearGlobalTimer();

        if (!mcqQuestions.length) {
            container.innerHTML = `<p class="text-red-600 font-bold">No MCQ questions found.</p>`;
            return;
        }

        renderFeedbackQuestion();
    }

    function renderFeedbackQuestion() {
        const q = mcqQuestions[feedbackIndex];
        const userAnswer = mcqAnswers[feedbackIndex];

        let optionsHTML = q.options.map(opt => `
            <label class="block border rounded p-2 mb-2 ${opt === userAnswer ? 'bg-yellow-100 border-yellow-400' : ''}">
                <input type="radio" disabled ${opt === userAnswer ? "checked" : ""}>
                ${opt}
            </label>
        `).join("");

        container.innerHTML = `
            <h1 class="text-3xl font-bold mb-4">Feedback (${feedbackIndex + 1}/${mcqQuestions.length})</h1>
            <h2 class="text-xl font-semibold mb-4">${q.question}</h2>

            <div class="mb-6">
                <h3 class="font-semibold mb-2">Your Answer:</h3>
                ${optionsHTML}
            </div>

            <div class="mb-6">
                <label class="font-semibold block mb-2">Confidence (1 = low, 3 = neutral, 5 = high)</label>
                <input id="confidenceSlider" type="range" min="1" max="5" value="3" class="w-full">
                <p id="confValue" class="mt-1 text-gray-700">3</p>
            </div>

            <div class="mb-6">
                <label class="font-semibold block mb-2">Did you guess your answer?</label>
                <select id="guessSelect" class="border p-2 rounded w-full">
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                </select>
            </div>

            <div class="mb-6">
                <label class="font-semibold block mb-2">If guessed, choose type</label>
                <select id="guessTypeSelect" class="border p-2 rounded w-full">
                    <option value="">(Not Applicable)</option>
                    <option value="random">Random</option>
                    <option value="strategic">Strategic</option>
                    <option value="intellectual">Intellectual</option>
                </select>
            </div>

            <div class="mt-8 text-center">
                ${
                    feedbackIndex === mcqQuestions.length - 1
                    ? `<button id="submitFeedback" class="bg-green-600 text-white px-6 py-3 rounded-lg text-xl">Submit Feedback</button>`
                    : `<button id="nextFeedback" class="bg-indigo-600 text-white px-6 py-3 rounded-lg text-xl">Next</button>`
                }
            </div>
        `;

        document.getElementById("confidenceSlider").addEventListener("input", (e) => {
            document.getElementById("confValue").textContent = e.target.value;
        });

        if (document.getElementById("nextFeedback")) {
            document.getElementById("nextFeedback").addEventListener("click", saveFeedbackAndNext);
        }

        if (document.getElementById("submitFeedback")) {
            document.getElementById("submitFeedback").addEventListener("click", submitFinalFeedback);
        }
    }

    function saveFeedbackAndNext() {
        const conf = parseInt(document.getElementById("confidenceSlider").value);
        const guessed = document.getElementById("guessSelect").value === "true";
        let type = document.getElementById("guessTypeSelect").value;

        if (!guessed) type = "";

        feedbackData.confidence.push(conf);
        feedbackData.guess.push(guessed);
        feedbackData.guessType.push(type);

        feedbackIndex++;
        renderFeedbackQuestion();
    }

    function submitFinalFeedback() {
        const conf = parseInt(document.getElementById("confidenceSlider").value);
        const guessed = document.getElementById("guessSelect").value === "true";
        let type = document.getElementById("guessTypeSelect").value;

        if (!guessed) type = "";

        feedbackData.confidence.push(conf);
        feedbackData.guess.push(guessed);
        feedbackData.guessType.push(type);

        logEvent("Feedback", feedbackData);
        console.log("Final Feedback:", feedbackData);

        showImageDescriptionTask();
    }

    function showImageDescriptionTask() {
        currentScreen = "image_description";
        toggleExit(false);
        toggleEndSession(true);

        // --- TIMER: 10 Minutes ---
        startGlobalTimer(10 * 60, "Stage-5", () => {
            logEvent("image_task_timeout");
            // End of experiment when time runs out
            const cameraData = stopCameraRecording();
            fetch("/save_camera_log", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ log: cameraData })
            });
            showScoreCard();
        });

        renderImageDescription();
    }

    function renderImageDescription() {
        const imgSrc = imageList[imageIndex];

        container.innerHTML = `
            <h1 class="text-3xl font-bold mb-6">Image Description (${imageIndex + 1}/2)</h1>
            <p class="text-lg mb-4">Please describe what you see in the image below:</p>

            <img src="${imgSrc}" 
                class="w-full max-w-md mx-auto rounded shadow mb-6" />

            <textarea id="imageDescInput" 
                    class="w-full border rounded p-3 text-lg"
                    rows="5"
                    placeholder="Type your description here..."></textarea>

            <button id="imageNextBtn"
                    class="mt-6 bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-lg text-xl">
                ${imageIndex === imageList.length - 1 ? "Submit" : "Next"}
            </button>
        `;
    }

    function showCompletionScreen() {
        window.location.href = "/thankyou";
    }

    container.addEventListener('click', (e) => {
        // Start button logic moved to renderStartScreen for cleaner init
        
        if (e.target.id === 'newExpBtn') {
            e.preventDefault();
        }
        if (e.target.id === 'feedbackBtn') {
            e.preventDefault();
            showFeedbackForm();
        }
        if (e.target.id === "imageNextBtn") {
            const text = document.getElementById("imageDescInput").value.trim();

            if (!text) {
                alert("Please write your description before proceeding.");
                return;
            }

            imageDescriptions.push(text);

            logEvent("ImageDescription", {
                image_number: imageIndex + 1,
                description: text
            });

            if (imageIndex < imageList.length - 1) {
                imageIndex++;
                renderImageDescription();
                return;
            }

            // Stop and Save
            const cameraData = stopCameraRecording();
            clearGlobalTimer(); // Stop timer

            fetch("/save_camera_log", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ log: cameraData })
            }).catch(err => console.error("Camera log save failed:", err));

            showScoreCard();
        }
    });

    container.addEventListener('click', (e) => {
        if (e.target.id === 'finishBtn') {
            stopCameraRecording();
            logEvent("FINISH", {});
            window.location.href = "/thankyou";
        }
    });

    endBtn.addEventListener('click', () => {
        stopCameraRecording();
        clearGlobalTimer();
        logEvent('session_ended', {});
        window.location.href = "/thankyou";
    });
    
    exitBtn.addEventListener('click', () => {
        stopCameraRecording();
        clearGlobalTimer();
        clearInterval(window.currentInterval);
        logEvent("EXIT", {});
        window.location.href = "/thankyou";
    });

    renderStartScreen();
});
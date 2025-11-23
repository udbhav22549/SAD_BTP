document.addEventListener("DOMContentLoaded", () => {
    // entire previous JS code here
    let currentScreen = "start";
    let currentQuestion = 0;
    let sessionEnded = false;
    let sessionActive = false;
    let sessionStartTime = null;
    window.currentInterval = null;

    // for mcq 
    let mcqQuestions = [];
    let mcqAnswers = {}; // store user’s selected answers
    let currentMcqIndex = 0;

    let mcqVisited = new Set(); // track which questions user saw
    let mcqPrevAnswer = {}; // track last answer for change detection
    let lastMcqIndex = null; // track movement

    let feedbackQuestions = [];
    let firstSeenTime = {};
    let mcqMarked = {};  // Track which questions are marked for review

    const container = document.getElementById('container');
    const alertSound = document.getElementById('alertSound');
    const endBtn = document.getElementById('endBtn');
    const exitBtn = document.getElementById('exitBtn');

    let paragraphText = "";
    let questions = [];

    let feedbackIndex = 0;
    let feedbackData = {
        confidence: [],
        guess: [],
        guessType: []
    };

    // Fetch paragraph and questions from backend

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


    // Call it before experiment starts
    loadExperimentData();

    function getISTTimestamp() {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const ist = new Date(utc + 5.5 * 60 * 60 * 1000);
    const year = ist.getFullYear();
    const month = String(ist.getMonth() + 1).padStart(2, '0');
    const day = String(ist.getDate()).padStart(2, '0');
    const hours = String(ist.getHours()).padStart(2, '0');
    const minutes = String(ist.getMinutes()).padStart(2, '0');
    const seconds = String(ist.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} IST`;
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

    function renderStartScreen() {
    sessionActive = false;
    sessionEnded = false;
    currentQuestion = 0;
    currentScreen = "start";
    sessionStartTime = null;
    container.innerHTML = `
        <button id="startBtn" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-8 rounded-lg text-2xl">
        Start Experiment
        </button>
    `;
    sessionActive = false;
    toggleEndSession(false);  // hide End Session
    toggleExit(true);         // Exit visible only here
    }

    function startTimer(duration, onEnd, displayText, showNext = false) {
    let timeLeft = duration;
    container.innerHTML = `
        <h1 class="text-3xl font-semibold mb-6">${displayText}</h1>
        <div class="text-6xl font-bold mb-6" id="countdown">${timeLeft}</div>
        <div class="w-full bg-gray-300 rounded-full h-6 mb-6">
        <div id="progressBar" class="bg-green-500 h-6 rounded-full w-0"></div>
        </div>
        ${showNext ? '<button id="nextBtn" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg text-lg">Next</button>' : ''}
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

    // Handle manual next button
    if (showNext) {
        const nextBtn = document.getElementById('nextBtn');
        nextBtn.addEventListener('click', () => {
        clearInterval(window.currentInterval);
        window.currentInterval = null;
        onEnd();  // same behavior as timer finishing
        });
    }
    }

    async function startNewSession() {
    console.log('Starting new session');
    const resp = await fetch('/start_session', { method: 'POST' });
    if (!resp.ok) {
        if (resp.status === 401) window.location.href = '/login';
        return;
    }

    sessionStartTime = Date.now();
    logEvent('session_started');
    sessionActive = true;
    sessionEnded = false;
    toggleEndSession(true);
    toggleExit(false);
    startEyesClosed();
    }

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

    // Display paragraph without timer
    container.innerHTML = `
        <h1 class="text-2xl font-semibold mb-6">Please read the following paragraph carefully:</h1>
        <p class="text-lg text-gray-700 mb-8">${paragraph}</p>
        <button id="nextParagraphBtn" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg text-xl">
        Next
        </button>
    `;

    // When Next is clicked, move to questions
    document.getElementById('nextParagraphBtn').addEventListener('click', () => {
        logEvent('paragraph_finished');
        alertSound.play();
        showQuestion();
    });
    toggleExit(false);
    toggleEndSession(true);

    }

    function showQuestion() {
    //  if(currentQuestion >= questions.length) {
    //    sessionActive = false;
    //    sessionEnded = true;
    //    toggleLogout(true);
    //    toggleEndSession(false);
    //    container.innerHTML = `
    //      <h1 class="text-4xl font-bold text-green-600">Experiment Finished</h1>
    //      <p class="mt-4 text-lg text-gray-700">Thank you for participating!</p>
    //      <button id="newExpBtn" class="mt-6 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg text-xl">Start New Experiment</button>
    //    `;
    //    return;
    if(currentQuestion >= questions.length) {
        //alertSound.play();
        logEvent('subjective_section_finished');
        showMcqSection();
        return;
    }
    const q = questions[currentQuestion];
    startTimer(15, () => {
        //alertSound.play();
        logEvent(`question_${currentQuestion+1}_finished`);
        currentQuestion++;
        setTimeout(showQuestion, 300);
    }, q, true); // ✅ manual next enabled
    toggleExit(false);
    toggleEndSession(true);
    }

    function showMcqSection() {
    currentScreen = "mcq_section";
    currentMcqIndex = 0;
    mcqAnswers = {};

    container.innerHTML = `
        <h1 class="text-3xl font-bold mb-6">MCQ Section</h1>

        <!-- Navigation Panel -->
        <div id="mcqNav" class="grid grid-cols-10 gap-2 mb-6"></div>

        <!-- Question Display -->
        <div id="mcqContainer"></div>

        <div class="mt-6">
        <button id="prevMcq" class="bg-gray-400 text-white font-bold py-2 px-4 rounded mr-2">Previous</button>
        <button id="nextMcq" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">Next</button>
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

        // Base classes
        let classes = "rounded-full w-10 h-10 flex items-center justify-center font-semibold transition border ";

        // Yellow-orange scheme
        if (isMarked && isAnswered) {
            // Marked & answered → solid orange
            classes += "bg-amber-500 text-white border-amber-600";
        } else if (isMarked) {
            // Marked only → orange outline
            classes += "border-amber-500 text-amber-600 bg-white";
        } else if (isAnswered) {
            // Answered only → green
            classes += "bg-green-500 text-white border-green-600";
        } else {
            // Not visited / unanswered
            classes += "border-gray-300 text-gray-700 bg-gray-100";
        }

        // Highlight current question with thicker border
        if (i === currentMcqIndex) {
            classes += " ring-2 ring-blue-500";
        }

        navButtons += `
            <button data-index="${i}"
                    class="${classes}">
                ${i + 1}
            </button>
        `;
    }

    navContainer.innerHTML = navButtons;

    // Add event listeners to jump to a question
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

    // Track first time seen
    if (!firstSeenTime[currentMcqIndex]) {
        firstSeenTime[currentMcqIndex] = getElapsedSeconds();
    }

    // Log first seen
    if (!mcqVisited.has(currentMcqIndex)) {
        mcqVisited.add(currentMcqIndex);
        logEvent("Qfirstseen", {
            Qn: currentMcqIndex,
            FirsttimeSeen: firstSeenTime[currentMcqIndex]
        });
    }

    // Log question change (when moving from one to another)
    if (lastMcqIndex !== null && lastMcqIndex !== currentMcqIndex) {
        logEvent("QChange", {
            Qn: lastMcqIndex,
            Qnto: currentMcqIndex,
            submitted: mcqAnswers[lastMcqIndex] ? "Yes" : "No"
        });
    }
    lastMcqIndex = currentMcqIndex;

    // Render options
    const optionsHtml = q.options.map(opt => `
        <label class="block text-left border rounded-lg p-2 cursor-pointer hover:bg-gray-100">
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

    // Update nav + prev / next / submit buttons
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

    // Handle answer selection
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

    // Handle Mark / Unmark
    const markBtn = document.getElementById("markBtn");
    if (markBtn) {
        markBtn.addEventListener("click", () => {
            mcqMarked[currentMcqIndex] = !mcqMarked[currentMcqIndex];

            logEvent(mcqMarked[currentMcqIndex] ? "QMark" : "QUnmark", {
                Qn: currentMcqIndex,
                Marked: mcqMarked[currentMcqIndex]
            });

            // Re-render to update button text & nav color
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
        //logEvent('mcq_section_finished');
        showScoreCard();
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
            <p class="text-lg mb-6">You answered <b>${score}</b> out of <b>${mcqQuestions.length}</b> correctly.</p>
            <button id="feedbackBtn" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg text-xl">
            Give Feedback
            </button>
        `;
    }

    function showFeedbackForm() {
        currentScreen = "feedback";
        toggleExit(false);
        toggleEndSession(true);


        if (!feedbackQuestions.length) {
            container.innerHTML = `<p class="text-red-600 font-bold">No feedback questions found.</p>`;
            return;
        }

        let formHtml = feedbackQuestions.map((q, i) => {
            if (q.options[0] === "TEXT") {
            return `
                <label class="block mb-4">
                <span class="font-semibold">${i + 1}. ${q.question}</span><br>
                <textarea name="q${i + 1}" rows="3" class="border rounded w-full p-2" placeholder="Your answer..."></textarea>
                </label>
            `;
            } else {
            const opts = q.options.map(opt => `<option value="${opt}">${opt}</option>`).join('');
            return `
                <label class="block mb-4">
                <span class="font-semibold">${i + 1}. ${q.question}</span><br>
                <select name="q${i + 1}" class="border rounded w-full p-2">
                    <option value="">Select</option>
                    ${opts}
                </select>
                </label>
            `;
            }
        }).join('');

        container.innerHTML = `
            <h1 class="text-3xl font-bold mb-4">Feedback</h1>
            <form id="feedbackForm" class="space-y-4 text-left">
            ${formHtml}
            <div class="mt-6 text-center">
                <button type="submit" class="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg text-lg">
                Submit Feedback
                </button>
            </div>
            </form>
        `;
    }


    function showCompletionScreen() {
    window.location.href = "/thankyou";
    }

    container.addEventListener('click', (e) => {
    const id = e.target && e.target.id;
    if (id === 'startBtn') {
        e.preventDefault();
        startNewSession();
    }
    if (id === 'newExpBtn') {
        e.preventDefault();
        // renderStartScreen();
    }
    if (id === 'feedbackBtn') {
        e.preventDefault();
        showFeedbackForm();
    }

    });

    document.addEventListener('submit', (e) => {
    if (e.target.id === 'feedbackForm') {
        e.preventDefault();

        const formData = new FormData(e.target);
        const feedback = Object.fromEntries(formData.entries());

        // Log feedback event
        logEvent("Feedback", feedback); // send as real JSON dict

        console.log("Feedback received:", feedback);

        // Move to final screen
        showCompletionScreen();
    }
    });


    endBtn.addEventListener('click', () => {
    logEvent('session_ended', {});
    window.location.href = "/thankyou";

    //  if (!sessionActive) return;
    //  sessionEnded = true;
    //  sessionActive = false;
    //  clearInterval(window.currentInterval);
    //  logEvent('session_ended');
    //  toggleLogout(true);
    //  toggleEndSession(false);
    //  container.innerHTML = `
    //    <h1 class="text-4xl font-bold text-red-600">Session Ended</h1>
    //    <p class="mt-4 text-lg text-gray-700">Thank you for participating!</p>
    //    <button id="newExpBtn" class="mt-6 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg text-xl">Start New Experiment</button>
    //  `;
    });
   
    // EXIT button → go to thank you page
    exitBtn.addEventListener("click", () => {
        clearInterval(window.currentInterval);
        logEvent("EXIT", {});
        window.location.href = "/thankyou";
    });


    // renderStartScreen();
});

from flask import Blueprint, render_template, request, jsonify, redirect, url_for, session, send_from_directory
from database import get_db_connection
from functools import wraps
from datetime import datetime
import os, csv, json

experiment_bp = Blueprint('experiment', __name__)
USER_DATA_DIR = 'user_data'
SESSION_FILES = {}
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'username' not in session:
            return redirect(url_for('auth.login'))
        return f(*args, **kwargs)
    return decorated

def get_current_username():
    return session.get('username')

def get_user_id(username):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT user_id FROM users WHERE username=?", (username,))
    row = cur.fetchone()
    conn.close()
    return row[0] if row else None

@experiment_bp.route('/')
@login_required
def index():
    return render_template('index.html', username=session['username'])


@experiment_bp.route('/get_paragraph')
def get_paragraph():
    paragraph_path = os.path.join(DATA_DIR, 'paragraph.txt')
    with open(paragraph_path, 'r', encoding='utf-8') as f:
        text = f.read().strip()
    return jsonify({"paragraph": text})

@experiment_bp.route('/get_questions')
def get_questions():
    questions_path = os.path.join(DATA_DIR, 'questions.txt')
    with open(questions_path, 'r', encoding='utf-8') as f:
        questions = [line.strip() for line in f if line.strip()]
    return jsonify({"questions": questions})

@experiment_bp.route('/get_mcq_questions')
def get_mcq_questions():
    mcq_path = os.path.join(DATA_DIR, 'mcq_questions.json')
    if not os.path.exists(mcq_path):
        return jsonify({"questions": []})
    with open(mcq_path, 'r', encoding='utf-8') as f:
        mcqs = json.load(f)
    return jsonify({"questions": mcqs})

@experiment_bp.route('/get_feedback_questions')
def get_feedback_questions():
    feedback_path = os.path.join(DATA_DIR, 'feedback_questions.txt')
    if not os.path.exists(feedback_path):
        return jsonify({"questions": []})

    questions = []
    with open(feedback_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if "|" in line:
                q_text, q_opts = line.split("|", 1)
                opts = [opt.strip() for opt in q_opts.split(",")] if q_opts.strip() != "TEXT" else ["TEXT"]
                questions.append({"question": q_text.strip(), "options": opts})
    return jsonify({"questions": questions})


# --- Create new session files (CSV + JSON) ---
from datetime import datetime, timedelta

def get_ist_time():
    # Convert UTC → IST (+5:30)
    return (datetime.utcnow() + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d %H:%M:%S IST")

@experiment_bp.route('/start_session', methods=['POST'])
@login_required
def start_session():
    username = get_current_username()
    user_id = get_user_id(username)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    user_folder = os.path.join(USER_DATA_DIR, username)
    os.makedirs(user_folder, exist_ok=True)

    # Filenames
    base_filename = f"session_{timestamp}"
    csv_path = os.path.join(user_folder, base_filename + ".csv")
    json_path = os.path.join(user_folder, base_filename + ".json")

    ist_timestamp = get_ist_time()

    # --- Create CSV file ---
    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['user_id', 'event_type', 'time_elapsed', 'timestamp', 'variable_field'])
        writer.writerow([user_id, 'session_started', 0, ist_timestamp, ''])

    # --- Create JSON file ---
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump([{
            "user_id": user_id,
            "event_type": "session_started",
            "time_elapsed": 0,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "variable_field": ""
        }], f, indent=4)

    # Store both paths in memory
    SESSION_FILES[username] = {"csv": csv_path, "json": json_path}

    return jsonify({"status": "session_started", "session_file": base_filename}), 200

# --- Log events to both CSV + JSON ---
@experiment_bp.route('/log_event', methods=['POST'])
@login_required
def log_event():
    username = get_current_username()
    user_id = get_user_id(username)
    paths = SESSION_FILES.get(username)

    if not paths or not os.path.exists(paths["csv"]) or not os.path.exists(paths["json"]):
        return jsonify({"error": "No active session. Call /start_session first."}), 400

    data = request.get_json()

    event_type    = data.get("stage")
    timestamp     = data.get("timestamp")
    time_elapsed  = data.get("time_elapsed", -1)
    variable_json = data.get("variable_field", {})   # already JSON from frontend

    # -----------------------------
    # 📌 1. WRITE TO CSV
    # -----------------------------
    with open(paths["csv"], "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            user_id,
            event_type,
            time_elapsed,
            timestamp,
            json.dumps(variable_json, ensure_ascii=False)
        ])

    # -----------------------------
    # 📌 2. WRITE TO JSON LOG
    # -----------------------------
    try:
        with open(paths["json"], "r", encoding="utf-8") as f:
            txt = f.read().strip()
            events = json.loads(txt) if txt else []
    except:
        events = []

    events.append({
        "UserID": user_id,
        "EventType": event_type,
        "TimeElapsed": time_elapsed,
        "timestamp": timestamp,
        "VariableFields": variable_json
    })

    with open(paths["json"], "w", encoding="utf-8") as f:
        json.dump(events, f, indent=4, ensure_ascii=False)

    return jsonify({"status": "logged"}), 200

# --- List all sessions for user ---
@experiment_bp.route('/list_sessions')
@login_required
def list_sessions():
    username = get_current_username()
    user_folder = os.path.join(USER_DATA_DIR, username)
    if not os.path.exists(user_folder):
        return jsonify([])
    files = sorted(os.listdir(user_folder))
    return jsonify(files)

# --- Download session file (CSV or JSON) ---
@experiment_bp.route('/download_session/<session_file>')
@login_required
def download_session(session_file):
    username = get_current_username()
    user_folder = os.path.join(USER_DATA_DIR, username)
    file_path = os.path.join(user_folder, session_file)
    if not os.path.exists(file_path):
        return "File not found", 404
    return send_from_directory(user_folder, session_file, as_attachment=True)

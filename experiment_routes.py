# experiment_routes.py

import sqlite3
from flask import Blueprint, redirect, render_template, request, jsonify, session, send_from_directory, url_for
from datetime import datetime, timedelta
import os, csv, json
import uuid

from database import get_db_connection

experiment_bp = Blueprint('experiment', __name__)

# --- Paths ---
BASE_DIR = os.path.dirname(__file__)
USER_DATA_DIR = os.path.join(BASE_DIR, 'user_data')
DATA_DIR = os.path.join(BASE_DIR, 'data')

os.makedirs(USER_DATA_DIR, exist_ok=True)

# In-memory: current session files per participant_id
SESSION_FILES = {}

# --- Time helpers ---
def get_ist_time_iso():
    """Return IST timestamp in ISO-like format (for logs)."""
    ist = datetime.utcnow() + timedelta(hours=5, minutes=30)
    # example: 2025-11-14T20:40:12.123+05:30
    return ist.strftime("%Y-%m-%dT%H:%M:%S") + "+05:30"

def get_ist_time_human():
    """Return IST timestamp in human format (for CSV)."""
    ist = datetime.utcnow() + timedelta(hours=5, minutes=30)
    return ist.strftime("%Y-%m-%d %H:%M:%S IST")

# --- Participant helper ---
def get_or_create_participant_id():
    """
    For this step:
    - If participant_id exists in session, reuse it
    - Otherwise generate a new one like P20251114_204012_123
    """
    pid = session.get("participant_id")
    if pid:
        return pid

    # Generate reasonably unique ID
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")[:-3]
    pid = f"P{ts}"
    session["participant_id"] = pid
    return pid

# =========================
#  PUBLIC EXPERIMENT ROUTES
# =========================

@experiment_bp.route('/', methods=['GET'])
def participant_page():
    return render_template('participant.html')

@experiment_bp.route('/participant', methods=['POST'])
def participant_submit():
    name   = request.form.get("name")
    email  = request.form.get("email")
    age    = request.form.get("age")
    mobile = request.form.get("mobile")

    institution = request.form.get("institution")
    batch       = request.form.get("batch")
    branch      = request.form.get("branch")
    roll_number = request.form.get("roll_number")
    other_inst  = request.form.get("other_institution")

    # generate participant ID
    participant_id = "P" + uuid.uuid4().hex[:10]
    session['participant_id'] = participant_id
    session["participant_name"] = name

    # create folder for participant
    folder = os.path.join(USER_DATA_DIR, name)
    os.makedirs(folder, exist_ok=True)

    # store details in DB (your table name may differ)
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO participants 
        (participant_id, name, email, age, mobile, institution, batch, branch, roll_number, other_institution)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        participant_id, name, email, age, mobile,
        institution, batch, branch, roll_number, other_inst
    ))

    conn.commit()
    conn.close()

    return redirect(url_for('experiment.instructions_page'))

@experiment_bp.route('/instructions')
def instructions_page():
    return render_template('instructions.html')

@experiment_bp.route('/begin', methods=['POST'])
def begin_experiment():
    name = session.get("participant_name", "Participant")
    participant_id=session.get("participant_id")
    return render_template('index.html', name=name, participant_id=participant_id,show_exit=True)

# ---------- Text / question config ----------

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
                q_text = q_text.strip()
                q_opts = q_opts.strip()
                if q_opts == "TEXT":
                    opts = ["TEXT"]
                else:
                    opts = [opt.strip() for opt in q_opts.split(",")]
                questions.append({"question": q_text, "options": opts})
    return jsonify({"questions": questions})


# ---------- Start session (creates CSV + JSON) ----------

@experiment_bp.route('/start_session', methods=['POST'])
def start_session():
    """
    Called from frontend when participant clicks "Start Experiment".
    - Ensures we have a participant_id in session
    - Creates user_data/<participant_id>/session_<timestamp>.csv / .json
    - Writes the first START row / event
    """
    participant_id = get_or_create_participant_id()
    participant_name = session.get("participant_name")
    timestamp_tag = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

    participant_folder = os.path.join(USER_DATA_DIR, participant_name)
    os.makedirs(participant_folder, exist_ok=True)

    base_filename = f"session_{participant_name}_{timestamp_tag}"
    csv_path = os.path.join(participant_folder, base_filename + ".csv")
    json_path = os.path.join(participant_folder, base_filename + ".json")

    # ---------------------------------------------------
    # CRITICAL FIX: Save this to session for camera_routes
    # ---------------------------------------------------
    session["current_base_filename"] = base_filename

    ist_human = get_ist_time_human()
    ist_iso = get_ist_time_iso()

    # --- Create CSV file ---
    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['UserID', 'EventType', 'TimeElapsed', 'timestamp', 'VariableFields'])
        writer.writerow([participant_id, 'START', 0, ist_iso, json.dumps({}, ensure_ascii=False)])

    # --- Create JSON file ---
    first_event = {
        "UserID": participant_id,
        "EventType": "START",
        "TimeElapsed": 0,
        "timestamp": ist_iso,
        "VariableFields": {}
    }
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump([first_event], f, indent=4, ensure_ascii=False)

    # store paths in memory
    SESSION_FILES[participant_name] = {
        "csv": csv_path,
        "json": json_path
    }

    return jsonify({
        "status": "session_started",
        "session_file": base_filename,
        "participant_id": participant_id
    }), 200


# ---------- Log events (append to CSV + JSON) ----------

@experiment_bp.route('/log_event', methods=['POST'])
def log_event():
    """
    Frontend sends:
    {
      "stage": "QSubmit" | "QChange" | ...,
      "timestamp": "...",              # IST string from JS
      "time_elapsed": <int>,           # seconds from session start
      "variable_field": {...}          # dict, will be stored as JSON
    }
    """
    participant_name = session.get("participant_name")
    participant_id = session.get("participant_id")
    paths = SESSION_FILES.get(participant_name)
    if not participant_id:
        return jsonify({"error": "No participant in session"}), 400

    if not paths or not os.path.exists(paths["csv"]) or not os.path.exists(paths["json"]):
        return jsonify({"error": "No active session. Call /start_session first."}), 400

    data = request.get_json() or {}
    event_type   = data.get("stage")
    timestamp    = data.get("timestamp", get_ist_time_iso())
    time_elapsed = data.get("time_elapsed", -1)
    variable_json = data.get("variable_field", {})

    # ---- 1. Append to CSV ----
    with open(paths["csv"], "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            participant_id,
            event_type,
            time_elapsed,
            timestamp,
            json.dumps(variable_json, ensure_ascii=False)
        ])

    # ---- 2. Append to JSON ----
    try:
        with open(paths["json"], "r", encoding="utf-8") as f:
            txt = f.read().strip()
            events = json.loads(txt) if txt else []
    except Exception:
        events = []

    events.append({
        "UserID": participant_id,
        "EventType": event_type,
        "TimeElapsed": time_elapsed,
        "timestamp": timestamp,
        "VariableFields": variable_json
    })

    with open(paths["json"], "w", encoding="utf-8") as f:
        json.dump(events, f, indent=4, ensure_ascii=False)

    return jsonify({"status": "logged"}), 200


# ---------- Optional: list / download sessions (later for admin) ----------

@experiment_bp.route('/list_sessions')
def list_sessions():
    """
    For now: just list sessions for current participant_id (if any).
    Later we'll move this to admin-only.
    """
    participant_id = session.get("participant_id")
    if not participant_id:
        return jsonify([])

    participant_folder = os.path.join(USER_DATA_DIR, participant_id)
    if not os.path.exists(participant_folder):
        return jsonify([])

    files = sorted(os.listdir(participant_folder))
    return jsonify(files)

@experiment_bp.route('/download_session/<session_file>')
def download_session(session_file):
    """
    Download a CSV/JSON for the current participant.
    Later this will move to admin dashboard.
    """
    participant_id = session.get("participant_id")
    if not participant_id:
        return "No participant in session", 400

    participant_folder = os.path.join(USER_DATA_DIR, participant_id)
    file_path = os.path.join(participant_folder, session_file)
    if not os.path.exists(file_path):
        return "File not found", 404

    return send_from_directory(participant_folder, session_file, as_attachment=True)



@experiment_bp.route('/thankyou')
def thankyou_page():
    return render_template('thankyou.html')


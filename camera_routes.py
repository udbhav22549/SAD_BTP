import os
import json
import csv
from flask import Blueprint, request, session

camera_bp = Blueprint("camera", __name__)

BASE_DIR = os.path.dirname(__file__)
USER_DATA_DIR = os.path.join(BASE_DIR, 'user_data')


def get_camera_files():
    """Recovers the correct paths based on the active experiment session."""
    participant_name = session.get("participant_name")
    base_filename = session.get("current_base_filename")

    if not participant_name or not base_filename:
        return None, None

    folder = os.path.join(USER_DATA_DIR, participant_name)
    csv_path  = os.path.join(folder, f"{base_filename}_camera.csv")
    json_path = os.path.join(folder, f"{base_filename}_camera.json")
    return csv_path, json_path


def get_participant_folder():
    participant_name = session.get("participant_name")
    if not participant_name:
        return None
    return os.path.join(USER_DATA_DIR, participant_name)


# ─────────────────────────────────────────────────────────────────────────────
# Existing routes (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

@camera_bp.route("/start_camera_log", methods=["POST"])
def start_camera_log():
    csv_path, json_path = get_camera_files()
    if not csv_path:
        return {"status": "error", "msg": "Experiment session not started"}, 400

    with open(json_path, "w") as f:
        json.dump([], f, indent=4)

    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["timestamp", "emotion", "AUs"])

    session["camera_initialized"] = True
    return {"status": "started"}


@camera_bp.route("/append_camera_log", methods=["POST"])
def append_camera_log():
    if not session.get("camera_initialized"):
        return {"status": "ignored"}

    data = request.json
    csv_path, json_path = get_camera_files()
    if not csv_path:
        return {"status": "error"}, 400

    timestamp = data.get("timestamp")
    emotion   = data.get("emotion")
    aus       = data.get("AUs")

    try:
        with open(csv_path, "a", newline="") as f:
            writer = csv.writer(f)
            writer.writerow([timestamp, emotion, str(aus)])
    except Exception as e:
        print(f"CSV Write Error: {e}")

    return {"status": "ok"}


@camera_bp.route("/end_camera_log", methods=["POST"])
def end_camera_log():
    session["camera_initialized"] = False
    return {"status": "ended"}


# ─────────────────────────────────────────────────────────────────────────────
# NEW: Save screen recording (WebM blob uploaded from browser)
# ─────────────────────────────────────────────────────────────────────────────

@camera_bp.route("/save_screen_recording", methods=["POST"])
def save_screen_recording():
    folder = get_participant_folder()
    base_filename = session.get("current_base_filename")

    # Safety check: ensure session is active
    if not folder or not base_filename:
        return {"status": "error", "msg": "No active session"}, 400

    if "recording" not in request.files:
        return {"status": "error", "msg": "No file in request"}, 400

    file = request.files["recording"]
    
    # Safety check: Ensure the folder actually exists before writing!
    os.makedirs(folder, exist_ok=True)
    
    save_path = os.path.join(folder, f"{base_filename}_screen_recording.webm")

    # Open in 'ab' (append binary) mode
    try:
        with open(save_path, "ab") as f:
            f.write(file.read())
        return {"status": "chunk_saved"}
    except Exception as e:
        print(f"Error saving video chunk: {e}")
        return {"status": "error", "msg": str(e)}, 500
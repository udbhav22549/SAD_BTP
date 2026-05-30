# eye_tracking_routes.py

from flask import Blueprint, request, session, jsonify, render_template
import os, json, csv
from database import get_db_connection

eye_tracking_bp = Blueprint('eye_tracking', __name__)

BASE_DIR = os.path.dirname(__file__)
USER_DATA_DIR = os.path.join(BASE_DIR, 'user_data')


def _get_participant_folder():
    name = session.get("participant_name")
    if not name:
        return None, None
    folder = os.path.join(USER_DATA_DIR, name)
    os.makedirs(folder, exist_ok=True)
    return name, folder


@eye_tracking_bp.route('/calibration')
def calibration_page():
    name = session.get("participant_name", "Participant")
    return render_template('calibration.html', name=name)


@eye_tracking_bp.route('/save_calibration', methods=['POST'])
def save_calibration():
    _, folder = _get_participant_folder()
    if not folder:
        return jsonify({"error": "No session"}), 400

    data = request.get_json() or {}
    base = session.get("current_base_filename", "session")
    path = os.path.join(folder, f"{base}_calibration.json")

    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

    return jsonify({"status": "saved"})


@eye_tracking_bp.route('/save_gaze_data', methods=['POST'])
def save_gaze_data():
    _, folder = _get_participant_folder()
    if not folder:
        return jsonify({"error": "No session"}), 400

    data = request.get_json() or {}
    samples = data.get("gaze_data", [])
    base = session.get("current_base_filename", "session")
    csv_path = os.path.join(folder, f"{base}_gaze.csv")

    fieldnames = [
        'timestamp', 'time_elapsed_ms',
        'gaze_x', 'gaze_y',
        'raw_iris_x', 'raw_iris_y',
        'ear_left', 'ear_right',
        'blink',
        'pupil_dilation_left', 'pupil_dilation_right',
        'fixation', 'fixation_x', 'fixation_y', 'fixation_duration_ms',
        'saccade', 'saccade_velocity_px_per_s',
        'head_pitch', 'head_yaw', 'head_roll'
    ]

    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore')
        writer.writeheader()
        for s in samples:
            writer.writerow(s)

    return jsonify({"status": "saved", "rows": len(samples), "file": os.path.basename(csv_path)})


@eye_tracking_bp.route('/save_gaze_summary', methods=['POST'])
def save_gaze_summary():
    _, folder = _get_participant_folder()
    if not folder:
        return jsonify({"error": "No session"}), 400

    data = request.get_json() or {}
    base = session.get("current_base_filename", "session")
    path = os.path.join(folder, f"{base}_gaze_summary.json")

    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    return jsonify({"status": "saved"})



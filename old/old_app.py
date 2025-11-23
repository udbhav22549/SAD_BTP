from flask import Flask, render_template, request, jsonify, redirect, url_for, session, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3
import json
import os
from datetime import datetime
from functools import wraps

app = Flask(__name__)
app.secret_key = 'SAD_BTP'  # CHANGE for production

# Paths
DB_PATH = 'experiment.db'
USER_DATA_DIR = 'user_data'
os.makedirs(USER_DATA_DIR, exist_ok=True)

# In-memory mapping of current session file per username (simple, works for single-process)
SESSION_FILES = {}

# --- Database initialization ---
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    # users table
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    ''')
    # timestamps table (for optional relational storage if you want to mirror JSON)
    c.execute('''
        CREATE TABLE IF NOT EXISTS timestamps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            stage TEXT,
            timestamp TEXT,
            session_file TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    conn.commit()
    conn.close()

init_db()

# --- Auth helpers ---
def get_db_connection():
    return sqlite3.connect(DB_PATH)

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'username' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated

def get_current_username():
    return session.get('username')

def get_user_id(username):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id FROM users WHERE username=?", (username,))
    row = cur.fetchone()
    conn.close()
    return row[0] if row else None

# --- Routes: signup, login, logout ---
@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'GET':
        return render_template('signup.html')
    data = request.form
    username = data.get('username', '').strip()
    password = data.get('password', '')
    if not username or not password:
        return render_template('signup.html', error="Username and password required.")
    pw_hash = generate_password_hash(password)
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)", (username, pw_hash))
        conn.commit()
        conn.close()
    except sqlite3.IntegrityError:
        return render_template('signup.html', error="Username already exists.")
    # create user folder
    user_folder = os.path.join(USER_DATA_DIR, username)
    os.makedirs(user_folder, exist_ok=True)
    return redirect(url_for('login'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'GET':
        return render_template('login.html')
    data = request.form
    username = data.get('username', '').strip()
    password = data.get('password', '')
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT password_hash FROM users WHERE username=?", (username,))
    row = cur.fetchone()
    conn.close()
    if not row or not check_password_hash(row[0], password):
        return render_template('login.html', error="Invalid username or password.")
    # set session
    session['username'] = username
    return redirect(url_for('index'))

@app.route('/logout')
def logout():
    session.pop('username', None)
    return redirect(url_for('login'))

# --- Experiment pages ---
@app.route('/')
def index():
    if 'username' not in session:
        return redirect(url_for('login'))
    return render_template('index.html')

# @app.route('/')
# @login_required
# def index():
#     # render the experiment page (your index.html should exist in templates)
#     return render_template('index.html')

# Create new session file for logged-in user
@app.route('/start_session', methods=['POST'])
@login_required
def start_session():
    username = get_current_username()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    user_folder = os.path.join(USER_DATA_DIR, username)
    os.makedirs(user_folder, exist_ok=True)
    filename = f"session_{timestamp}.json"
    path = os.path.join(user_folder, filename)
    # create empty list
    with open(path, 'w') as f:
        json.dump([], f)
    # store mapping in memory
    SESSION_FILES[username] = path
    # also return the filename to frontend in case needed
    return jsonify({"status": "session_started", "session_file": filename}), 200

# Append a log event to the user's current session file
@app.route('/log_event', methods=['POST'])
@login_required
def log_event():
    username = get_current_username()
    path = SESSION_FILES.get(username)
    if not path or not os.path.exists(path):
        return jsonify({"error":"No active session. Call /start_session first."}), 400
    data = request.get_json()
    stage = data.get('stage')
    timestamp = data.get('timestamp')
    # append to JSON
    with open(path, 'r') as f:
        arr = json.load(f)
    arr.append({"stage": stage, "timestamp": timestamp})
    with open(path, 'w') as f:
        json.dump(arr, f, indent=4)
    # Optional: also insert into SQLite timestamps table for relational queries
    user_id = get_user_id(username)
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO timestamps (user_id, stage, timestamp, session_file) VALUES (?, ?, ?, ?)",
                    (user_id, stage, timestamp, os.path.basename(path)))
        conn.commit()
        conn.close()
    except Exception:
        pass
    return jsonify({"status":"success"}), 200

# Get list of session files for current user
@app.route('/list_sessions')
@login_required
def list_sessions():
    username = get_current_username()
    user_folder = os.path.join(USER_DATA_DIR, username)
    if not os.path.exists(user_folder):
        return jsonify([])
    files = sorted(os.listdir(user_folder))
    return jsonify(files)

# Download a session file (only allowed for the logged-in user)
@app.route('/get_timestamps/<session_file>')
@login_required
def get_timestamps(session_file):
    username = get_current_username()
    user_folder = os.path.join(USER_DATA_DIR, username)
    path = os.path.join(user_folder, session_file)
    if not os.path.exists(path):
        return jsonify({"error":"file not found"}), 404
    with open(path, 'r') as f:
        data = json.load(f)
    return jsonify(data)

# Serve raw file (if you want to download)
@app.route('/download_session/<session_file>')
@login_required
def download_session(session_file):
    username = get_current_username()
    user_folder = os.path.join(USER_DATA_DIR, username)
    if not os.path.exists(os.path.join(user_folder, session_file)):
        return "Not found", 404
    return send_from_directory(user_folder, session_file, as_attachment=True)

if __name__ == '__main__':
    app.run(debug=True)

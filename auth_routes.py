from flask import Blueprint, render_template, request, redirect, url_for, session
from werkzeug.security import generate_password_hash, check_password_hash
from database import get_db_connection
import os, sqlite3

auth_bp = Blueprint('auth', __name__)
USER_DATA_DIR = 'user_data'
os.makedirs(USER_DATA_DIR, exist_ok=True)

@auth_bp.route('/signup', methods=['GET', 'POST'])
def signup():
    
    def generate_user_id():
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM users")
        count = cur.fetchone()[0] + 1
        conn.close()
        return f"U{count:03d}"

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
        user_id = generate_user_id()
        cur.execute("INSERT INTO users (username, password_hash, user_id) VALUES (?, ?, ?)", (username, pw_hash, user_id))
        conn.commit()
        conn.close()
    except sqlite3.IntegrityError:
        return render_template('signup.html', error="Username already exists.")

    # Create folder for new user
    os.makedirs(os.path.join(USER_DATA_DIR, username), exist_ok=True)
    return redirect(url_for('auth.login'))

@auth_bp.route('/login', methods=['GET', 'POST'])
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

    session['username'] = username
    return redirect(url_for('experiment.index'))

@auth_bp.route('/logout')
def logout():
    session.pop('username', None)
    return redirect(url_for('auth.login'))

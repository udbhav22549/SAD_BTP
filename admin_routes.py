# admin_routes.py

from flask import Blueprint, render_template, request, redirect, url_for, session, send_from_directory
import sqlite3, os
from database import get_db_connection
import hashlib
# Removed 're' import as sanitize_name_for_path is no longer needed

ADMIN_DATA_DIR = os.path.join(os.path.dirname(__file__), "user_data")

admin_bp = Blueprint('admin', __name__)


# ------------ Helpers ------------
def admin_required(f):
    from functools import wraps
    @wraps(f)
    def secured(*args, **kwargs):
        if "admin_logged_in" not in session:
            return redirect(url_for("admin.admin_login"))
        return f(*args, **kwargs)
    return secured

# NOTE: sanitize_name_for_path function has been removed as per your request.
# The raw participant name will be used directly as the folder name.


# ------------ Admin Login Page ------------
@admin_bp.route("/admin", methods=["GET", "POST"])
def admin_login():
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")

        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT password_hash FROM admins WHERE username=?", (username,))
        row = cur.fetchone()
        conn.close()

        if row:
            hashed = hashlib.sha256(password.encode()).hexdigest()
            if hashed == row[0]:
                session["admin_logged_in"] = True
                session["admin_username"] = username
                return redirect(url_for("admin.admin_dashboard"))

        return render_template("admin_login.html", error="Invalid credentials")

    return render_template("admin_login.html")


# ------------ Admin Dashboard ------------
@admin_bp.route("/admin/dashboard")
@admin_required
def admin_dashboard():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT participant_id, name, email, age, mobile, institution FROM participants")
    participants = cur.fetchall()
    conn.close()
    
    # In the dashboard, we only need to pass the raw list as the raw name is the folder name.
    return render_template("admin_dashboard.html", participants=participants)


# ------------ View Participant Info ------------
@admin_bp.route("/admin/participant/<pid>")
@admin_required
def admin_view_participant(pid):

    conn = get_db_connection()
    cur = conn.cursor()

    # Fetch full participant row
    cur.execute("SELECT * FROM participants WHERE participant_id=?", (pid,))
    data = cur.fetchone()
    conn.close()

    if not data:
        return "Participant not found", 404

    # Extract fields clearly
    (
        db_id,
        participant_id,
        name,
        email,
        age,
        mobile,
        institution,
        batch,
        branch,
        roll_number,
        other_institution
    ) = data

    # Participant folder is EXACTLY the name (no sanitization)
    participant_folder = os.path.join(ADMIN_DATA_DIR, name)
    files = os.listdir(participant_folder) if os.path.exists(participant_folder) else []

    return render_template(
        "participant_detail.html",
        participant=data,
        files=files,
        pid=pid
    )

# ------------ Download User File ------------
@admin_bp.route("/admin/download/<pid>/<filename>")
@admin_required
def admin_download(pid, filename):
    conn = get_db_connection()
    cur = conn.cursor()
    # Look up participant data by PID to get the raw name
    cur.execute("SELECT name FROM participants WHERE participant_id=?", (pid,))
    row = cur.fetchone()
    conn.close()
    
    if not row:
        return "Participant not found", 404
        
    participant_name = row[0]
    
    # Folder lookup uses the raw participant name, NOT the PID
    folder = os.path.join(ADMIN_DATA_DIR, participant_name)
    
    # Check if the folder exists before attempting to serve the file
    if not os.path.exists(folder):
        return f"Data folder for {participant_name} not found.", 404
    
    return send_from_directory(folder, filename, as_attachment=True)


# ------------ Logout ------------
@admin_bp.route("/admin/logout")
def admin_logout():
    session.clear()
    return redirect(url_for("admin.admin_login"))

# ------------ Delete Participant & Files ------------
@admin_bp.route("/admin/delete/<pid>", methods=["POST"])
@admin_required
def admin_delete_participant(pid):
    conn = get_db_connection()
    cur = conn.cursor()

    # Fetch participant name (folder name)
    cur.execute("SELECT name FROM participants WHERE participant_id=?", (pid,))
    row = cur.fetchone()

    if not row:
        conn.close()
        return "Participant not found", 404

    participant_name = row[0]
    conn.close()

    # Folder path: user_data/<participant_name>
    folder_path = os.path.join(ADMIN_DATA_DIR, participant_name)

    # --- Delete folder and all session files ---
    if os.path.exists(folder_path):
        # Remove all files inside
        for f in os.listdir(folder_path):
            try:
                os.remove(os.path.join(folder_path, f))
            except:
                pass
        
        # Remove the folder itself
        try:
            os.rmdir(folder_path)
        except:
            pass

    # --- Delete participant record from database ---
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM participants WHERE participant_id=?", (pid,))
    conn.commit()
    conn.close()

    # Redirect back to dashboard
    return redirect(url_for("admin.admin_dashboard"))

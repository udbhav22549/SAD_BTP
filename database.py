import sqlite3
import os
import hashlib

DB_PATH = 'experiment.db'

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # -----------------------------------------------------
    # TABLE 1: participants
    # -----------------------------------------------------
    c.execute('''
    CREATE TABLE IF NOT EXISTS participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        participant_id TEXT UNIQUE NOT NULL,
        name TEXT,
        email TEXT,
        age INTEGER,
        mobile TEXT,
        institution TEXT,        -- IIITD / Other
        batch TEXT,
        branch TEXT,
        roll_number TEXT,
        other_institution TEXT   -- when institution = Other
        )
    ''')


    # -----------------------------------------------------
    # TABLE 2: admins
    # -----------------------------------------------------
    c.execute('''
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    ''')

    # -----------------------------------------------------
    # Ensure DEFAULT ADMIN exists
    # username: admin
    # password: admin123
    # -----------------------------------------------------
    c.execute("SELECT COUNT(*) FROM admins")
    admin_count = c.fetchone()[0]

    if admin_count == 0:
        default_pass_hash = hashlib.sha256("admin123".encode()).hexdigest()
        c.execute("""
            INSERT INTO admins (username, password_hash)
            VALUES (?, ?)
        """, ("admin", default_pass_hash))
        print("Default admin created: username='admin', password='admin123'")

    # -----------------------------------------------------
    # TABLE 3: participant_sessions (optional summary table)
    # -----------------------------------------------------
    c.execute('''
        CREATE TABLE IF NOT EXISTS participant_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            participant_id TEXT,
            session_file TEXT,
            start_time TEXT,
            end_time TEXT
        )
    ''')

    conn.commit()
    conn.close()


def get_db_connection():
    return sqlite3.connect(DB_PATH)


# Create DB & tables if missing
if not os.path.exists(DB_PATH):
    print("Initializing database...")
    init_db()

from flask import Flask
from database import init_db
from auth_routes import auth_bp
from experiment_routes import experiment_bp
from admin_routes import admin_bp
from camera_routes import camera_bp
from eye_tracking_routes import eye_tracking_bp
import os

app = Flask(__name__)
app.secret_key = 'SAD_BTP'  # change for production
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max upload for video files

USER_DATA_DIR = 'user_data'
os.makedirs(USER_DATA_DIR, exist_ok=True)

# Initialize database
init_db()

# Register blueprints   
app.register_blueprint(admin_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(experiment_bp)
app.register_blueprint(camera_bp)
app.register_blueprint(eye_tracking_bp)

@app.route('/')
def home():
    from flask import redirect, url_for, session
    if 'username' in session:
        return redirect(url_for('experiment.index'))
    return redirect(url_for('auth.login'))

if __name__ == '__main__':
    app.run(debug=True)

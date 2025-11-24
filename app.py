from flask import Flask
from database import init_db
from auth_routes import auth_bp
from experiment_routes import experiment_bp
from admin_routes import admin_bp
from camera_routes import camera_bp
import os

app = Flask(__name__)
app.secret_key = 'SAD_BTP'  # change for production

USER_DATA_DIR = 'user_data'
os.makedirs(USER_DATA_DIR, exist_ok=True)

# Initialize database
init_db()

# Register blueprints   
app.register_blueprint(admin_bp)  
app.register_blueprint(auth_bp)
app.register_blueprint(experiment_bp)
app.register_blueprint(camera_bp)

@app.route('/')
def home():
    from flask import redirect, url_for, session
    if 'username' in session:
        return redirect(url_for('experiment.index'))
    return redirect(url_for('auth.login'))

if __name__ == '__main__':
    app.run(debug=True)

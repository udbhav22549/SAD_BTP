# 📘 Social Anxiety Study — Automated Web-Based Psychological Experiment System

A full-stack, production-ready psychological experiment platform built using **Flask**, **JavaScript**, **TailwindCSS**, and **MediaPipe**, designed for running controlled behavioral experiments online.

This system allows researchers to collect **reaction time**, **MCQ behavior**, **subjective responses**, **feedback**, and newly added **live facial expression action units (AUs)** and **emotion logging** through the participant's webcam — all saved securely on the server.

---

## 🚀 Features Overview

### 🧑‍🔬 Participant Experiment Flow
Participants:

1. Visit the landing page  
2. Fill participant details  
3. Read instructions  
4. Start experiment → automated flow begins  
5. Sections include:
   - **Eyes-Closed Timer (30s)**
   - **Paragraph Reading**
   - **Subjective Questions (Timed)**
   - **MCQ Section with navigation grid**
   - **Confidence & Guessing Feedback**
   - **Image Description Task**
6. Finish → redirected to Thank You page  

Every action is logged in both **CSV** + **JSON** formats.

---

## 🎥 Camera Logging (MediaPipe) 

The system includes **high-frequency facial expression logging**, performed **entirely in-browser** using MediaPipe Face Landmarker.

### Logged every ~33ms:
- `timestamp_original` (ISO 8601)
- `emotion` (neutral, angry, happy, etc.)
- `AUs` (facial action units detected)

Saved per session:
session_<name><timestamp>camera_log.json
session<name><timestamp>_camera_log.csv


Camera starts when “Start Experiment” is clicked and stops when the session ends.

---

## 📝 MCQ System with Detailed Behavioral Tracking

The MCQ module includes advanced behavioral analytics.

### Logged events:
- `Qfirstseen`
- `QChange`
- `QSubmit`
- `QMark`
- `QUnmark`
- `SCORE` (final correctness)

Each log captures response time, navigation pattern, and user interactions.

Navigation grid colors:
- **Green** → answered  
- **Amber outline** → marked  
- **Solid amber** → marked + answered  
- **Gray** → not visited  

---

## 🔐 Admin Portal (Secure)

Admins can:

✔ View all participants  
✔ View participant details  
✔ Download all session files  
✔ Delete participant (DB + file system)  
✔ Inspect CSV and JSON logs  
✔ Confirm camera recordings  

Admin passwords are SHA256-hashed.

---

## 📁 File & Data Storage Structure

Each participant gets a folder inside:

user_data/<participant_name>/

Example contents:

session_<name><timestamp>.csv
session<name><timestamp>.json
session<name><timestamp>camera_log.csv
session<name><timestamp>_camera_log.json



---

## 🧱 Project Directory Structure

project/
│
├── app.py
├── database.py
│
├── routes/
│ ├── experiment_routes.py
│ └── admin_routes.py
│
├── templates/
│ ├── participant.html
│ ├── instructions.html
│ ├── index.html
│ ├── thankyou.html
│ ├── admin_login.html
│ ├── admin_dashboard.html
│ ├── participant_detail.html
│
├── static/
│ ├── js/
│ │ ├── experiment.js
│ │ └── camera/
│ │ ├── face.js
│ │ └── recorder.js
│ ├── audio/
│ │ └── alert.wav
│
├── data/
│ ├── paragraph.txt
│ ├── questions.txt
│ ├── mcq_questions.json
│ └── feedback_questions.txt
│
└── user_data/




---

## ⚙️ Technology Stack

### Backend
- Flask (Python)
- SQLite3
- PythonAnywhere deployment

### Frontend
- TailwindCSS
- Vanilla JavaScript
- MediaPipe Face Landmarker

### Logging
- Dual CSV + JSON logging
- Browser-side facial expression analysis
- Server-side storage

---

TEAM MAVERICKS!!

VitalsCapture rPPG
Contactless Cardiac Monitoring using Computer Vision

Overview
VitalsCapture rPPG is a browser-based system that estimates heart rate, heart rate variability (HRV), and stress levels using only a camera feed. It is built on the principle of remote photoplethysmography (rPPG), where subtle variations in skin color caused by blood flow are analyzed to extract physiological signals.

The goal is to provide a low-cost and accessible alternative for basic cardiac screening, especially in environments where traditional medical devices are not available.

Problem
Most cardiac monitoring solutions rely on dedicated hardware such as ECG sensors, smartwatches, or pulse oximeters. These are often:

Expensive

Not widely available in rural or low-resource settings

Difficult to scale for large populations

At the same time, nearly every smartphone already has a camera capable of capturing useful physiological signals — but extracting those signals reliably is challenging due to noise from lighting, motion, and compression.

What This Project Does
This system processes a short video (live or recorded) and extracts:

Heart Rate (BPM)

Heart Rate Variability (RMSSD)

Stress Level (based on HRV)

Signal Quality Score

If the signal quality is too low (e.g., due to motion or poor lighting), the system avoids returning unreliable results.

How It Works
The camera captures a video stream

A facial region (ROI) is detected and tracked

Subtle changes in the green channel are extracted frame-by-frame

Signal processing techniques filter noise

Peaks are detected to compute heart rate and HRV

HRV features are used to estimate stress level

Results are displayed in real time on the frontend

Tech Stack
Backend
Python

FastAPI (API layer)

Uvicorn (server)

OpenCV (face detection and ROI tracking)

NumPy (numerical computation)

SciPy (signal processing)

Frontend
React (Vite)

Tailwind CSS

Recharts (data visualization)

React Webcam (camera access)

Utilities
html2canvas / jsPDF (report export)

ESLint (code quality)

Features
Real-time camera-based monitoring

Contactless measurement (no wearables required)

HRV-based stress estimation

Signal quality validation (prevents incorrect outputs)

Visual waveform and metrics display

Optional fallback to finger-based PPG (for low-light conditions)

Running the Project
Backend
Bash

pip install -r requirements.txt
uvicorn main:app --reload
Frontend
Bash

npm install
npm run dev
Usage
Open the web app in a browser

Allow camera access

Stay relatively still for ~30 seconds

View heart rate, HRV, and stress output

Limitations
Performance depends on lighting conditions

Sensitive to excessive motion

Not a replacement for medical-grade devices

Intended for screening and educational purposes only

Future Improvements
Multi-region signal fusion (forehead + cheeks)

Better motion compensation

On-device (browser-based) signal processing

Long-term trend tracking

Clinical validation with datasets

Use Cases
Basic health screening in low-resource settings

Telehealth support

Stress monitoring

Research and prototyping

Note
This project is built as a proof-of-concept to demonstrate how widely available devices can be used for physiological monitoring. It is not intended for clinical diagnosis.


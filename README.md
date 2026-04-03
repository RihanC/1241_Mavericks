#Overview
VitalsCapture rPPG is a contactless cardiac monitoring system that uses a standard smartphone or webcam to estimate:
  Heart Rate (BPM)
  Heart Rate Variability (HRV)
  Cardiac Stress Level
  Signal Quality Confidence

It leverages Remote Photoplethysmography (rPPG) to extract subtle blood flow signals from facial video — eliminating the need for wearable devices.

🌍 Problem Statement
Traditional cardiac monitoring requires hardware like ECG sensors or smartwatches, which are:

❌ Expensive

❌ Not accessible in rural or disaster zones

❌ Not scalable for mass screening

Our solution transforms any smartphone into a biometric sensor, enabling low-cost, accessible cardiac screening.

💡 Key Features
🔹 Contactless Monitoring
Uses facial video (no physical contact required)

🔹 Real-Time Analysis
Live heart rate and stress detection

🔹 HRV-Based Stress Detection
Uses RMSSD & signal variability

🔹 Signal Quality Engine
Detects:

Poor lighting

Motion noise

Weak signal

Refuses inaccurate outputs

🔹 Multi-Mode Support
📷 Face-based rPPG (default)

👉 Finger-based PPG (fallback for low light)

🔹 Interactive Dashboard
Live waveform visualization

BPM + HRV display

Stress classification

🧠 How It Works
Camera Feed
   ↓
Face Detection (ROI extraction)
   ↓
Green Channel Signal Extraction
   ↓
Noise Filtering (Bandpass / POS)
   ↓
Peak Detection
   ↓
BPM + HRV Calculation
   ↓
Stress Classification
   ↓
Frontend Visualization
🛠️ Tech Stack
🔹 Backend
Python

FastAPI

Uvicorn

OpenCV

NumPy

SciPy

🔹 Frontend
React (Vite)

Tailwind CSS

Recharts

React Webcam

🔹 Utilities
html2canvas + jsPDF (report generation)

ESLint (code quality)



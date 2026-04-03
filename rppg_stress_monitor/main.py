import base64
import json
import numpy as np
import cv2
import os
import tempfile
import sqlite3
import face_recognition
from pydantic import BaseModel
from fastapi import FastAPI, WebSocket, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from rppg_processor import RPPGProcessor

# DB Setup
DB_PATH = "patients.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS Users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_name TEXT NOT NULL,
            face_encoding TEXT NOT NULL
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS History (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            bpm REAL,
            rmssd REAL,
            resp_rate REAL,
            stress_lvl TEXT,
            FOREIGN KEY (user_id) REFERENCES Users (id)
        )
    ''')
    conn.commit()
    conn.close()

init_db()

class RegisterRequest(BaseModel):
    name: str
    image_b64: str

class LoginRequest(BaseModel):
    image_b64: str

class SaveHistoryRequest(BaseModel):
    user_id: int
    bpm: float
    rmssd: float
    resp_rate: float
    stress_lvl: str

def parse_b64_image(b64_string: str) -> np.ndarray:
    encoded_data = b64_string.split(',')[1] if ',' in b64_string else b64_string
    np_arr = np.frombuffer(base64.b64decode(encoded_data), np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    return frame

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as temp:
        temp.write(await file.read())
        temp_path = temp.name

    try:
        cap = cv2.VideoCapture(temp_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        if fps <= 0 or np.isnan(fps):
            fps = 30.0
            
        batch_processor = RPPGProcessor(fps=int(fps))
        batch_processor.window_size = 9999999 # keep all frames
        
        frame_count = 0
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
                
            batch_processor.add_frame(frame)
            frame_count += 1
            if frame_count > fps * 60: # Max 60 seconds
                break

        cap.release()
        
        # Avoid crashing if no frames had faces
        if len(batch_processor.rgb_buffer) < 30:
            return {"error": "Could not detect face consistently.", "confidence": 0}
            
        metrics = batch_processor.calculate_metrics()
        return metrics
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

@app.post("/register")
async def register_user(req: RegisterRequest):
    frame = parse_b64_image(req.image_b64)
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    # Ensure dlib is robust by utilizing face_recognition standard API
    # Since dlib processes RGB nicely
    encodings = face_recognition.face_encodings(rgb_frame)
    if not encodings:
        return {"error": "No face detected in the image for registration."}
    
    encoding_json = json.dumps(encodings[0].tolist())
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("INSERT INTO Users (user_name, face_encoding) VALUES (?, ?)", (req.name, encoding_json))
    user_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return {"message": "Registered successfully", "user_id": user_id, "name": req.name}

@app.post("/login")
async def login_user(req: LoginRequest):
    frame = parse_b64_image(req.image_b64)
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    encodings = face_recognition.face_encodings(rgb_frame)
    if not encodings:
        return {"error": "No face detected. Please ensure your face is clearly visible."}
    
    user_encoding = encodings[0]
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT id, user_name, face_encoding FROM Users")
    users = cursor.fetchall()
    
    for row in users:
        db_id, db_name, db_encoding_str = row
        db_encoding = np.array(json.loads(db_encoding_str))
        
        matches = face_recognition.compare_faces([db_encoding], user_encoding)
        if matches[0]:
            # Load history
            cursor.execute("SELECT * FROM History WHERE user_id = ? ORDER BY timestamp DESC", (db_id,))
            history_rows = cursor.fetchall()
            history = [{"id": h[0], "timestamp": h[2], "bpm": h[3], "rmssd": h[4], "resp_rate": h[5], "stress_lvl": h[6]} for h in history_rows]
            
            conn.close()
            return {"message": "Login successful", "user_id": db_id, "name": db_name, "history": history}
            
    conn.close()
    return {"error": "User not found. Please register first."}

@app.post("/save_history")
async def save_history(req: SaveHistoryRequest):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''INSERT INTO History (user_id, bpm, rmssd, resp_rate, stress_lvl) 
                      VALUES (?, ?, ?, ?, ?)''', 
                   (req.user_id, req.bpm, req.rmssd, req.resp_rate, req.stress_lvl))
    conn.commit()
    
    # Return updated history
    cursor.execute("SELECT * FROM History WHERE user_id = ? ORDER BY timestamp DESC", (req.user_id,))
    history_rows = cursor.fetchall()
    history = [{"id": h[0], "timestamp": h[2], "bpm": h[3], "rmssd": h[4], "resp_rate": h[5], "stress_lvl": h[6]} for h in history_rows]
    conn.close()
    
    return {"message": "History saved successfully", "history": history}

@app.websocket("/ws/video")
async def video_endpoint(websocket: WebSocket):
    await websocket.accept()
    processor = RPPGProcessor(fps=30)
    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            
            if payload.get("command") == "reset":
                processor = RPPGProcessor(fps=30)
                continue
            
            # Decode frame
            encoded_data = payload['frame'].split(',')[1]
            np_arr = np.frombuffer(base64.b64decode(encoded_data), np.uint8)
            frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            
            # Process & return metrics
            result = processor.process_frame(frame)
            if result:
                await websocket.send_json(result)
    except Exception as e:
        print(f"Connection closed: {e}")

# --- UNIFIED MOBILE DEPLOYMENT ARCHITECTURE ---
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

DIST_PATH = os.path.join(os.path.dirname(__file__), "rppg-client", "dist")
ASSETS_PATH = os.path.join(DIST_PATH, "assets")

# Mount Vite assets folder
if os.path.isdir(ASSETS_PATH):
    app.mount("/assets", StaticFiles(directory=ASSETS_PATH), name="assets")

@app.get("/{full_path:path}")
async def serve_react_app(full_path: str):
    # Route static files (e.g. favicon or manifest)
    file_path = os.path.join(DIST_PATH, full_path)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
        
    # Default everything to index.html (SPA Fallback)
    index_path = os.path.join(DIST_PATH, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
        
    return {"error": "Frontend build not found. Running start.sh will fix this."}

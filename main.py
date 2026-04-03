import base64
import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from ppg_processor import PPGProcessor
import json
import uvicorn
import os

app = FastAPI()

# Mount static files (HTML, JS, CSS)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Processor instance
processor = PPGProcessor(fps=30)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("WebSocket connected")
    try:
        while True:
            try:
                # Receive data from client
                data = await websocket.receive_text()
                message = json.loads(data)
                
                if message["type"] == "frame":
                    # Decode base64 image
                    frame_data = message["data"].split(",")[1]
                    frame_bytes = base64.b64decode(frame_data)
                    
                    # Convert to numpy array
                    nparr = np.frombuffer(frame_bytes, np.uint8)
                    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    
                    if frame is not None:
                        # Extract the green channel
                        green_channel = frame[:, :, 1]
                        green_mean = np.mean(green_channel)
                        
                        # Process signal
                        val, bpm, finger_detected = processor.update(green_mean)
                        
                        # Send response
                        await websocket.send_json({
                            "val": float(val),
                            "bpm": round(float(bpm), 1),
                            "finger_detected": finger_detected
                        })
                
                elif message["type"] == "reset":
                    processor.reset()
                    await websocket.send_json({"status": "reset_done"})
            
            except json.JSONDecodeError:
                continue
            except Exception as e:
                print(f"Frame processing error: {e}")
                continue
                
    except WebSocketDisconnect:
        print("WebSocket disconnected")
    except Exception as e:
        print(f"WebSocket fatal error: {e}")

@app.get("/")
async def get():
    from fastapi.responses import FileResponse
    return FileResponse("static/index.html")

if __name__ == "__main__":
    # Ensure static directory exists
    if not os.path.exists("static"):
        os.makedirs("static")
    if not os.path.exists("static/js"):
        os.makedirs("static/js")
    if not os.path.exists("static/css"):
        os.makedirs("static/css")
        
    print("Starting server on http://0.0.0.0:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)

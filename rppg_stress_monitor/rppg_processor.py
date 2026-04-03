import cv2
import numpy as np
from scipy.signal import butter, filtfilt, find_peaks, periodogram

class RPPGProcessor:
    def __init__(self, fps=30):
        self.fps = fps
        self.rgb_buffer = []
        self.window_size = fps * 15 # Increased to 15s to get better FFT resolution
        self.last_roi_coords = None
        self.warning = None
        
        # Switched to OpenCV's built-in Haar Cascade to solve the MediaPipe Apple Silicon bug.
        self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        
    def extract_roi(self, frame):
        # Convert to Grayscale for the Face detector
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = self.face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(100, 100))
        
        h, w, _ = frame.shape
        self.warning = None
        
        if len(faces) == 0:
            self.warning = "No face detected"
            return None
            
        # If there are multiple faces, pick the largest one
        faces = sorted(faces, key=lambda f: f[2]*f[3], reverse=True)
        x, y, w_box, h_box = faces[0]
        
        # Exclusively target the FOREHEAD (upper 10-30% of bounding box, centered)
        fh_y1 = max(0, int(y + h_box * 0.1))
        fh_y2 = int(y + h_box * 0.3)
        fh_x1 = max(0, int(x + w_box * 0.35))
        fh_x2 = min(w, int(x + w_box * 0.65))
        
        if fh_y1 >= fh_y2 or fh_x1 >= fh_x2:
             return None
             
        # Store relative coordinates for frontend overlay mapping
        self.last_roi_coords = {
            "x": fh_x1 / w,
            "y": fh_y1 / h,
            "w": (fh_x2 - fh_x1) / w,
            "h": (fh_y2 - fh_y1) / h
        }
        
        return frame[fh_y1:fh_y2, fh_x1:fh_x2]
        
    def add_frame(self, frame):
        roi = self.extract_roi(frame)
        if roi is None or roi.size == 0:
            return False
            
        b_mean, g_mean, r_mean = cv2.mean(roi)[:3]
        if max(r_mean, g_mean, b_mean) < 20: 
            self.warning = "Lighting too low, please face a light source"
            
        self.rgb_buffer.append([r_mean, g_mean, b_mean])
        return True

    def process_frame(self, frame):
        self.add_frame(frame)
        
        if len(self.rgb_buffer) > self.window_size:
            self.rgb_buffer.pop(0)
            
        if len(self.rgb_buffer) >= self.fps * 4: # Wait 4 seconds minimum
            metrics = self.calculate_metrics()
            if self.warning and "warning" not in metrics:
                metrics["warning"] = self.warning
            return metrics
        
        return {"status": "Calibrating...", "progress": round(len(self.rgb_buffer)/(self.fps*4) * 100), "roi": self.last_roi_coords, "warning": self.warning}

    def calculate_metrics(self):
        data = np.array(self.rgb_buffer)
        
        if len(data) < 15:
            return {"error": "Not enough frames", "confidence": 0}
            
        r, g, b = data[:,0], data[:,1], data[:,2]
        
        if np.mean(r) == 0 or np.mean(g) == 0 or np.mean(b) == 0:
            return {"error": "Low light error", "confidence": 0}
            
        # POS Algorithm implementation
        rn, gn, bn = r/np.mean(r), g/np.mean(g), b/np.mean(b)
        X = 3*rn - 2*gn
        Y = 1.5*rn + gn - 1.5*bn
        X, Y = X - np.mean(X), Y - np.mean(Y)
        alpha = np.std(X) / (np.std(Y) + 1e-6)
        S = X + alpha * Y
        
        nyq = 0.5 * self.fps
        b_filt, a_filt = butter(2, [0.7/nyq, 3.0/nyq], btype='band')
        
        try:
            filtered_S = filtfilt(b_filt, a_filt, S)
        except ValueError:
             return {"error": "Filter error", "confidence": 0}
        
        signal_variance = np.var(filtered_S)
        if signal_variance < 1e-8:
             return {"error": "Signal zero-variance (Darkness/Blocked)", "confidence": 0}

        peaks, _ = find_peaks(filtered_S, distance=self.fps/3.0) 
        
        if len(peaks) < 3:
            return {"confidence": 0, "error": "Signal too noisy or heart rate < 40 BPM", "roi": self.last_roi_coords}
            
        ibi_frames = np.diff(peaks)
        if len(ibi_frames) == 0:
            return {"confidence": 0, "error": "Insufficient peaks", "roi": self.last_roi_coords}
            
        ibi_ms = (ibi_frames / self.fps) * 1000
        bpm = 60000 / np.mean(ibi_ms)
        
        rmssd = 0
        sdnn = 0
        lf_hf_ratio = 0
        
        if len(ibi_ms) > 1:
            rmssd = np.sqrt(np.mean(np.square(np.diff(ibi_ms))))
            sdnn = np.std(ibi_ms)
            
            # 2. Sympathovagal Balance (LF/HF Ratio)
            if len(ibi_ms) > 4:
                try:
                    time_ibi = np.cumsum(ibi_ms) / 1000.0
                    freq = 4.0
                    interp_time = np.arange(time_ibi[0], time_ibi[-1], 1.0/freq)
                    if len(interp_time) > 4:
                        interp_ibi = np.interp(interp_time, time_ibi, ibi_ms)
                        interp_ibi -= np.mean(interp_ibi)
                        f_psd, Pxx = periodogram(interp_ibi, fs=freq)
                        lf_band = np.logical_and(f_psd >= 0.04, f_psd < 0.15)
                        hf_band = np.logical_and(f_psd >= 0.15, f_psd <= 0.4)
                        lf_power = np.trapz(Pxx[lf_band], f_psd[lf_band]) if np.any(lf_band) else 0
                        hf_power = np.trapz(Pxx[hf_band], f_psd[hf_band]) if np.any(hf_band) else 0
                        if hf_power > 0:
                            lf_hf_ratio = lf_power / hf_power
                except Exception:
                    pass
            
        # 1. Respiratory Rate Extraction
        b_filt_resp, a_filt_resp = butter(2, [0.15/nyq, 0.4/nyq], btype='band')
        resp_rate = 0
        try:
            filtered_resp = filtfilt(b_filt_resp, a_filt_resp, S)
            resp_peaks, _ = find_peaks(filtered_resp, distance=self.fps*1.5)
            if len(resp_peaks) >= 2:
                resp_ibi = np.diff(resp_peaks) / self.fps
                resp_rate = 60.0 / np.mean(resp_ibi)
        except ValueError:
            pass
            
        stress_lvl = "High" if rmssd < 20 else ("Moderate" if rmssd < 45 else "Low")
        
        confidence = min(100, max(0, 100 - (signal_variance * 50)))
        warning_msg = self.warning
        
        if confidence < 40 and not warning_msg:
            warning_msg = "High motion detected, please hold still"
            
        if confidence < 20: 
            return {"error": "Low signal quality (Motion/Light)", "confidence": confidence, "roi": self.last_roi_coords}
            
        waveform_len = min(len(filtered_S), self.fps * 3)
        
        return {
            "bpm": round(bpm, 1),
            "rmssd": round(rmssd, 1),
            "sdnn": round(sdnn, 1),
            "lf_hf_ratio": round(lf_hf_ratio, 2) if lf_hf_ratio else "--",
            "resp_rate": round(resp_rate, 1) if resp_rate else "--",
            "stress": stress_lvl,
            "confidence": round(confidence, 1),
            "waveform": filtered_S[-int(waveform_len):].tolist(),
            "roi": self.last_roi_coords,
            "warning": warning_msg
        }

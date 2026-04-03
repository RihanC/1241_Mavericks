import numpy as np
from scipy.signal import butter, filtfilt, find_peaks
import time

class PPGProcessor:
    def __init__(self, fps=30, window_size=5):
        """
        Initializes the PPG processor.
        :param fps: Sampling frequency (frames per second).
        :param window_size: Size of the rolling window in seconds for BPM calculation.
        """
        self.fps = fps
        self.window_size = window_size
        self.max_buffer_size = fps * window_size
        
        # Signal buffers
        self.raw_signal = []
        self.timestamps = []
        
        # State
        self.bpm = 0.0
        self.filtered_signal = []
        self.last_process_time = 0
        self.is_finger_detected = False

    def update(self, green_mean):
        """
        Add a new sample (mean green intensity) to the buffer.
        """
        now = time.time()
        self.raw_signal.append(green_mean)
        self.timestamps.append(now)
        
        # Maintain buffer size
        if len(self.raw_signal) > self.max_buffer_size:
            self.raw_signal.pop(0)
            self.timestamps.pop(0)
        
        # Check if we have enough data to process (at least 2 seconds)
        if len(self.raw_signal) < self.fps * 2:
            return 0.0, 0.0, False # Not enough data
        
        # Detect finger coverage
        # Simple heuristic: green channel mean should be within a certain range
        # When a finger covers the camera with flash, the value is typically high but stable
        self.is_finger_detected = self._check_finger_coverage(green_mean)
        
        # Periodically compute BPM (e.g., every 0.1s or every frame)
        # But we return the current filtered value every update
        filtered_val, bpm = self._process_signal()
        self.bpm = bpm
        return filtered_val, bpm, self.is_finger_detected

    def _check_finger_coverage(self, val):
        # Relaxed threshold: Some phone sensors have very low green intensity when covered
        return 2 < val < 250

    def _process_signal(self):
        # 1. Bandpass filter: 0.7 Hz to 4.0 Hz (42 BPM to 240 BPM)
        nyquist = 0.5 * self.fps
        low = 0.7 / nyquist
        high = 4.0 / nyquist
        b, a = butter(2, [low, high], btype='band')
        
        signal_array = np.array(self.raw_signal)
        
        # Detrend to remove baseline drift
        signal_array = signal_array - np.mean(signal_array)
        
        # Apply filter
        try:
            filtered = filtfilt(b, a, signal_array)
        except Exception:
            # Fallback if filter fails due to too few samples
            return 0.0, self.bpm
        
        # Normalize filtered signal for visualization (0 to 1 range)
        if len(filtered) > 0:
            f_min = np.min(filtered)
            f_max = np.max(filtered)
            if f_max > f_min:
                normalized = (filtered - f_min) / (f_max - f_min)
            else:
                normalized = np.zeros_like(filtered) + 0.5 # Center the signal if flat
            
            current_filtered_val = normalized[-1]
        else:
            current_filtered_val = 0.5
            normalized = []

        # 2. Peak Detection for BPM
        # We only compute BPM if we have a significant signal
        # find_peaks parameters: distance ensures we don't pick noise peaks
        # minimal distance = 0.5 * fps (at most 120 BPM) or something more dynamic
        # min_distance = (60 / 220) * fps ~ 0.27s
        min_dist = int(0.3 * self.fps) 
        
        peaks, _ = find_peaks(filtered, distance=min_dist)
        
        if len(peaks) > 1:
            peak_intervals = np.diff(peaks) / self.fps # intervals in seconds
            avg_interval = np.mean(peak_intervals)
            if avg_interval > 0:
                bpm = 60.0 / avg_interval
                # Basic outlier rejection
                if bpm < 40 or bpm > 220:
                    bpm = self.bpm # Keep old BPM
            else:
                bpm = self.bpm
        else:
            bpm = self.bpm
            
        return current_filtered_val, bpm

    def reset(self):
        self.raw_signal = []
        self.timestamps = []
        self.bpm = 0.0

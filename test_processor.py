import numpy as np
from ppg_processor import PPGProcessor
import time

def test_ppg_processor():
    fps = 30
    processor = PPGProcessor(fps=fps, window_size=5)
    
    # Generate a synthetic PPG signal: 
    # Sine wave offset by a large value (simulating light intensity)
    # Frequency: 1.2 Hz (72 BPM)
    t = np.linspace(0, 10, 10 * fps)
    pure_signal = np.sin(2 * np.pi * 1.2 * t)
    noise = np.random.normal(0, 0.1, len(t))
    offset = 120
    synthetic_signal = pure_signal + noise + offset
    
    print("Testing PPG Processor with synthetic 72 BPM signal...")
    
    for val in synthetic_signal:
        filtered_val, bpm, finger_detected = processor.update(val)
    
    print(f"Final BPM: {bpm:.1f}")
    assert 70 <= bpm <= 74, f"BPM calculation failed: expected ~72, got {bpm}"
    print("Verification successful!")

if __name__ == "__main__":
    test_ppg_processor()

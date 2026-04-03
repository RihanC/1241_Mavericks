/**
 * PPG BPM Monitor - Client Side Logic
 */

const video = document.getElementById('video');
const canvas = document.getElementById('hidden-canvas');
const ctx = canvas.getContext('2d', { alpha: false });
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const bpmValue = document.getElementById('bpm-value');
const statusIndicator = document.getElementById('status-indicator');
const fingerOverlay = document.getElementById('finger-overlay');
const signalDots = document.querySelectorAll('.dot');

let stream = null;
let ws = null;
let isCapturing = false;
let animationId = null;
let chart = null;
const FPS = 30;
const CANVAS_SIZE = 64; // Low res for bandwidth optimization

// Initialize Chart.js
function initChart() {
    const ctx = document.getElementById('ppg-chart').getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array(60).fill(''),
            datasets: [{
                label: 'PPG Waveform',
                data: Array(60).fill(0),
                borderColor: '#ff3e3e',
                borderWidth: 3,
                pointRadius: 0,
                fill: true,
                backgroundColor: 'rgba(255, 62, 62, 0.1)',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { display: false },
                y: { display: false, min: 0, max: 1 }
            },
            plugins: { legend: { display: false } },
            animation: { duration: 0 } // Disable for real-time
        }
    });
}

// WebSocket setup
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    console.log(`Connecting to WebSocket at ${wsUrl}`);
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log("WebSocket connected successfully");
        statusIndicator.innerText = 'Connected';
        statusIndicator.classList.add('connected');
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.val !== undefined) {
                updateUI(data);
            }
        } catch (e) {
            console.error("Error parsing message:", e);
        }
    };
    
    ws.onerror = (error) => {
        console.error("WebSocket error:", error);
    };
    
    ws.onclose = (event) => {
        console.warn(`WebSocket closed: ${event.reason} (code ${event.code})`);
        statusIndicator.innerText = 'Disconnected - Retrying...';
        statusIndicator.classList.remove('connected');
        // Exponential backoff or simple retry
        setTimeout(connectWebSocket, 3000);
    };
}

function updateUI(data) {
    // Update Waveform
    chart.data.datasets[0].data.push(data.val);
    chart.data.datasets[0].data.shift();
    chart.update('none');
    
    // Update BPM
    if (data.bpm > 0) {
        bpmValue.innerText = data.bpm;
    } else {
        bpmValue.innerText = '--';
    }
    
    // Update Finger Detection
    if (data.finger_detected) {
        fingerOverlay.classList.add('hidden');
    } else {
        fingerOverlay.classList.remove('hidden');
    }
    
    // Update Signal Quality (Dummy logic for now)
    const quality = data.bpm > 0 ? (data.finger_detected ? 3 : 1) : 0;
    signalDots.forEach((dot, i) => {
        dot.classList.toggle('active', i < quality);
    });
}

// Camera control
async function startCamera() {
    try {
        const constraints = {
            video: {
                facingMode: 'environment', // Rear camera for mobile
                width: { ideal: 640 },
                height: { ideal: 480 },
                frameRate: { ideal: FPS }
            }
        };
        
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        
        // Attempt to turn on Flash (Torch) on mobile
        const track = stream.getVideoTracks()[0];
        const capabilities = track.getCapabilities();
        if (capabilities.torch) {
            await track.applyConstraints({ advanced: [{ torch: true }] });
        }
        
        isCapturing = true;
        canvas.width = CANVAS_SIZE;
        canvas.height = CANVAS_SIZE;
        
        captureLoop();
        
    } catch (err) {
        console.error("Camera error:", err);
        alert("Camera access required for PPG measurement.");
    }
}

function stopCamera() {
    isCapturing = false;
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'reset' }));
    }
}

// Main capture loop
function captureLoop() {
    if (!isCapturing) return;
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        // Draw video frame to small canvas
        ctx.drawImage(video, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
        
        // Convert to data URL
        const dataUrl = canvas.toDataURL('image/jpeg', 0.5); // Quality 0.5 to reduce size
        
        // Send to backend
        ws.send(JSON.stringify({
            type: 'frame',
            data: dataUrl
        }));
    }
    
    // Throttle to target FPS
    setTimeout(() => {
        animationId = requestAnimationFrame(captureLoop);
    }, 1000 / FPS);
}

// Event Listeners
startBtn.onclick = () => {
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    startCamera();
};

stopBtn.onclick = () => {
    stopBtn.classList.add('hidden');
    startBtn.classList.remove('hidden');
    stopCamera();
    bpmValue.innerText = '--';
};

// Initialize
initChart();
connectWebSocket();

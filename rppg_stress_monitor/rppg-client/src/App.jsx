import React, { useRef, useEffect, useState } from 'react';
import Webcam from 'react-webcam';
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';
import { Camera, Upload, Activity, AlertCircle, Download, Wind, User, UserPlus, LogOut, Clock, Save } from 'lucide-react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export default function App() {
  const webcamRef = useRef(null);
  const ws = useRef(null);
  const [data, setData] = useState({});
  const [mode, setMode] = useState('live');
  const [uploading, setUploading] = useState(false);
  const [videoPreview, setVideoPreview] = useState(null);

  // Authentication & History State
  const [currentUser, setCurrentUser] = useState(null);
  const [userHistory, setUserHistory] = useState([]);
  const [authMode, setAuthMode] = useState(null); // 'login' | 'register'
  const [regName, setRegName] = useState('');
  const [authMsg, setAuthMsg] = useState({ type: '', text: '' });
  
  // 30s Scan State
  const [scanState, setScanState] = useState('idle'); // 'idle' | 'scanning' | 'done'
  const [timeLeft, setTimeLeft] = useState(30);

  const protocol = window.location.protocol;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host; 
  const HTTP_URL = `${protocol}//${host}`;
  const WS_URL = `${wsProtocol}//${host}`;

  useEffect(() => {
    if (mode !== 'live') {
      if (ws.current) ws.current.close();
      return;
    }

    ws.current = new WebSocket(`${WS_URL}/ws/video`);
    ws.current.onmessage = (event) => setData(JSON.parse(event.data));

    const interval = setInterval(() => {
      if (webcamRef.current && ws.current?.readyState === WebSocket.OPEN) {
        const frame = webcamRef.current.getScreenshot();
        if (frame) ws.current.send(JSON.stringify({ frame }));
      }
    }, Math.floor(1000 / 30));

    return () => {
        clearInterval(interval);
        if (ws.current) ws.current.close();
    };
  }, [mode]);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setVideoPreview(URL.createObjectURL(file));
    setUploading(true);
    setData({ status: "Processing entire video...", progress: "0" });

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${HTTP_URL}/upload`, {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();
      setData(result);
    } catch (err) {
      setData({ error: "Failed to process video.", confidence: 0 });
    } finally {
      setUploading(false);
    }
  };

  const exportPDF = async () => {
    const reportElement = document.getElementById("report-container");
    if (!reportElement) return;
    try {
        const canvas = await html2canvas(reportElement, { backgroundColor: "#ffffff", scale: 2 });
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const imgProps = pdf.getImageProperties(imgData);
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        pdf.save("VitalsCapture_Report.pdf");
    } catch (err) {}
  };

  // Auth Functions
  const handleAuth = async () => {
    if (!webcamRef.current) return setAuthMsg({ type: 'error', text: 'Camera required' });
    const frame = webcamRef.current.getScreenshot();
    if (!frame) return setAuthMsg({ type: 'error', text: 'Failed to capture frame' });

    setAuthMsg({ type: 'info', text: 'Processing face data...' });

    try {
        if (authMode === 'register') {
            const res = await fetch(`${HTTP_URL}/register`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: regName, image_b64: frame })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setAuthMsg({ type: 'success', text: 'Registration successful. You may now login.' });
            setTimeout(() => setAuthMode('login'), 2000);
        } else {
            const res = await fetch(`${HTTP_URL}/login`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_b64: frame })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setCurrentUser({ id: data.user_id, name: data.name });
            setUserHistory(data.history || []);
            setAuthMode(null);
            setAuthMsg({ type: '', text: '' });
            
            // Reset the backend processor so it starts calibrating newly!
            if (ws.current?.readyState === WebSocket.OPEN) {
                ws.current.send(JSON.stringify({ command: 'reset' }));
                setData({}); // Clear UI
            }
        }
    } catch (err) {
        setAuthMsg({ type: 'error', text: err.message });
    }
  };

  // 30s Record Logic
  useEffect(() => {
      let timer;
      if (scanState === 'scanning' && timeLeft > 0) {
          timer = setTimeout(() => setTimeLeft(prev => prev - 1), 1000);
      } else if (scanState === 'scanning' && timeLeft === 0) {
          saveCurrentScan();
      }
      return () => clearTimeout(timer);
  }, [scanState, timeLeft]);

  const saveCurrentScan = async () => {
      setScanState('done');
      if (!currentUser || !data.bpm) return;
      try {
          const res = await fetch(`${HTTP_URL}/save_history`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  user_id: currentUser.id,
                  bpm: data.bpm,
                  rmssd: data.rmssd || 0,
                  resp_rate: data.resp_rate || 0,
                  stress_lvl: data.stress || "Moderate"
              })
          });
          const result = await res.json();
          if (result.history) setUserHistory(result.history);
          setTimeout(() => setScanState('idle'), 3000); // Reset after 3s
      } catch (err) {
          console.error(err);
      }
  };

  const triggerScan = () => {
      setScanState('scanning');
      setTimeLeft(30);
      if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ command: 'reset' }));
          setData({}); // Clear UI to show calibration
      }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans selection:bg-rose-100 relative pb-20">
      <div className="max-w-[1400px] mx-auto p-4 md:p-6 space-y-4">
        
        <header className="flex flex-col md:flex-row justify-between items-center bg-white rounded-xl p-4 border border-gray-200 shadow-sm gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">VitalsCapture rPPG</h1>
            <p className="text-gray-500 text-[10px] uppercase font-semibold">Contact-Free Cardiac Stress Analysis</p>
          </div>
          
          <div className="flex gap-4">
              <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
                 <button onClick={() => { setMode('live'); setData({}); setVideoPreview(null); }} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${mode === 'live' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><Camera size={14} /> Live Camera</button>
                 <button onClick={() => { setMode('upload'); setData({}); }} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${mode === 'upload' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><Upload size={14} /> Upload Video</button>
                 <button onClick={exportPDF} className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold text-gray-500 hover:text-gray-900 hover:bg-white transition-colors"><Download size={14} /> Export PDF</button>
              </div>

              {currentUser ? (
                  <div className="flex bg-blue-50 border border-blue-100 rounded-lg p-1 gap-1 items-center px-3">
                      <User size={14} className="text-blue-600" />
                      <span className="text-xs font-bold text-blue-700 mr-2">{currentUser.name}</span>
                      <button onClick={() => { setCurrentUser(null); setUserHistory([]); }} className="text-gray-500 hover:text-red-600"><LogOut size={14} /></button>
                  </div>
              ) : (
                  <div className="flex bg-rose-50 border border-rose-100 rounded-lg p-1 gap-1">
                      <button onClick={() => { setAuthMode('register'); setAuthMsg({type:'',text:''}); setMode('live'); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-rose-700 hover:bg-white transition-colors"><UserPlus size={14} /> Register</button>
                      <button onClick={() => { setAuthMode('login'); setAuthMsg({type:'',text:''}); setMode('live'); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-gray-700 hover:bg-white transition-colors"><User size={14} /> Login</button>
                  </div>
              )}
          </div>
        </header>

        {/* Authentication Modal */}
        {authMode && (
            <div className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden relative">
                    <div className="p-5 border-b border-gray-100 flex justify-between items-center">
                        <h2 className="font-bold text-gray-800">{authMode === 'register' ? 'Register Face' : 'Face Login'}</h2>
                        <button onClick={() => setAuthMode(null)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
                    </div>
                    <div className="p-6 space-y-4">
                        {authMsg.text && (
                            <div className={`p-3 rounded text-xs font-semibold border ${authMsg.type === 'error' ? 'bg-red-50 text-red-600 border-red-100' : (authMsg.type === 'success' ? 'bg-green-50 text-green-600 border-green-100' : 'bg-blue-50 text-blue-600 border-blue-100')}`}>
                                {authMsg.text}
                            </div>
                        )}
                        <div className="rounded-xl overflow-hidden shadow-inner border border-gray-200">
                             <Webcam ref={webcamRef} screenshotFormat="image/jpeg" className="w-full object-cover h-48" mirrored={true} />
                        </div>
                        {authMode === 'register' && (
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">Full Name</label>
                                <input type="text" value={regName} onChange={e => setRegName(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-rose-300" placeholder="John Doe" />
                            </div>
                        )}
                        <button onClick={handleAuth} className="w-full py-2.5 bg-gray-900 text-white font-bold rounded-lg text-sm hover:bg-gray-800 transition-colors shadow">
                            {authMode === 'register' ? 'Capture Face & Register' : 'Scan Face to Login'}
                        </button>
                    </div>
                </div>
            </div>
        )}

        <div id="report-container" className="space-y-4">
            
            <div className={`bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col items-center justify-center relative ${mode === 'live' ? '' : 'min-h-[400px]'}`}>
                {mode === 'live' ? (
                <>
                    <Webcam ref={webcamRef} screenshotFormat="image/jpeg" videoConstraints={{ facingMode: "user" }} className="w-full h-auto object-cover max-h-[500px]" mirrored={true} />
                    {data.roi && !data.error && (
                        <div className="absolute border border-white/80 rounded pointer-events-none transition-all duration-100 z-20"
                        style={{ left: `${(1 - data.roi.x - data.roi.w) * 100}%`, top: `${data.roi.y * 100}%`, width: `${data.roi.w * 100}%`, height: `${data.roi.h * 100}%` }}>
                            <div className="absolute top-[-3px] left-[-3px] w-2 h-2 border-t-[2px] border-l-[2px] border-white"></div>
                            <div className="absolute top-[-3px] right-[-3px] w-2 h-2 border-t-[2px] border-r-[2px] border-white"></div>
                            <div className="absolute bottom-[-3px] left-[-3px] w-2 h-2 border-b-[2px] border-l-[2px] border-white"></div>
                            <div className="absolute bottom-[-3px] right-[-3px] w-2 h-2 border-b-[2px] border-r-[2px] border-white"></div>
                        </div>
                    )}
                </>
                ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center relative">
                    {videoPreview ? <video src={videoPreview} className="w-full max-h-[500px] object-cover" controls={false} loop autoPlay muted /> : (
                        <div className="border border-dashed border-gray-300 rounded-xl w-full h-full min-h-[300px] flex flex-col items-center justify-center bg-gray-50 hover:bg-gray-100 transition-colors z-10">
                            <Upload size={32} className="text-gray-400 mb-3" />
                            <p className="text-gray-600 font-medium mb-1">Select a video file to analyze</p>
                            <input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={handleFileUpload} className="hidden" id="video-upload" />
                            <label htmlFor="video-upload" className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-md text-sm font-medium cursor-pointer shadow-sm hover:bg-gray-50 mt-4">Browse Files</label>
                        </div>
                    )}
                </div>
                )}
                {mode === 'live' && (
                    <div className="absolute top-3 left-3 flex pointer-events-none z-30">
                        {data.error ? (
                            <div className="bg-red-50 text-red-600 px-3 py-1.5 rounded shadow-sm text-[10px] font-bold border border-red-100 uppercase">Warning: {data.error}</div>
                        ) : data.status ? (
                            <div className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded shadow-sm text-[10px] font-bold border border-blue-100 uppercase">{data.status} ({data.progress}%)</div>
                        ) : (
                            <div className="bg-white/90 backdrop-blur-sm text-gray-700 px-3 py-1.5 rounded shadow-sm text-[10px] font-bold border border-gray-200 flex items-center gap-1.5 uppercase">
                                <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span></span>
                                Signal Locked
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 p-2.5 shadow-sm px-4">
                <span className="text-[11px] font-bold text-gray-800 uppercase tracking-wide whitespace-nowrap">Model quality</span>
                <div className="flex-1 h-3 flex bg-gray-100 relative">
                   <div className="h-full bg-gradient-to-r from-amber-700 via-amber-600 to-green-500 transition-all duration-500" style={{width: `${data.confidence || 0}%`}}></div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl shadow-sm p-4 flex flex-col">
                    <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                        <h3 className="text-[11px] font-bold text-gray-500">Heart Beat Chart</h3>
                        <div className="flex text-gray-400 gap-3 text-xs font-mono"><span>=</span><span>||</span><span>...</span><span>X</span></div>
                    </div>
                    <div className="h-48 relative">
                        {data.waveform && !data.error ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={data.waveform.map((val, idx) => ({ time: idx, val }))}>
                                    <YAxis domain={['auto', 'auto']} hide />
                                    <Area type="monotone" dataKey="val" stroke="#9f1239" strokeWidth={1.5} fill="transparent" isAnimationActive={mode === 'live'} />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : <div className="w-full h-full flex items-center justify-center text-gray-300 text-sm">Waiting for signal...</div>}
                    </div>
                </div>

                <div className="lg:col-span-1 bg-white border border-gray-200 rounded-xl shadow-sm p-5 flex flex-col relative">
                    <div className="flex justify-between items-center mb-6 pb-2 border-b border-gray-100">
                        <h3 className="text-[11px] font-bold text-gray-500">Vital Signs</h3>
                        {scanState === 'idle' ? (
                            <button onClick={triggerScan} className="flex items-center gap-2 px-3 py-1 bg-rose-50 text-rose-700 border border-rose-200 rounded text-[10px] font-bold hover:bg-rose-100 transition-colors uppercase tracking-wider">
                                Start 30s Scan
                            </button>
                        ) : scanState === 'scanning' ? (
                            <div className="flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[10px] font-bold uppercase tracking-wider">
                                Scanning: {timeLeft}s
                            </div>
                        ) : (
                            <button onClick={triggerScan} className="flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 border border-green-200 rounded text-[10px] font-bold hover:bg-green-100 transition-colors uppercase tracking-wider">
                                Scan Again
                            </button>
                        )}
                    </div>
                    
                    <div className="flex-1 flex flex-col justify-between">
                        <div className="flex justify-around mb-8">
                            <div className="flex flex-col items-center">
                                <span className="text-[44px] font-semibold text-gray-900 leading-none">{data.bpm ? data.bpm : "--"}</span>
                                <span className="text-[10px] uppercase font-bold text-gray-500 mt-1 tracking-wider">BPM</span>
                                <div className="text-[10px] text-gray-400 mt-4 tracking-wide font-medium">confidence</div>
                                <div className="w-10 h-0.5 bg-green-500 mt-1"></div>
                            </div>
                            <div className="flex flex-col items-center">
                                <span className="text-[44px] font-semibold text-gray-900 leading-none">{data.resp_rate ? data.resp_rate : "--"}</span>
                                <span className="text-[10px] uppercase font-bold text-gray-500 mt-1 tracking-wider">BPM</span>
                                <div className="text-[10px] text-gray-400 mt-4 tracking-wide font-medium">confidence</div>
                                <div className="w-10 h-0.5 bg-red-700 mt-1"></div>
                            </div>
                        </div>

                        <div className="space-y-4 pt-4 border-t border-gray-100">
                            <div className="flex justify-between items-end border-b border-gray-100 pb-3">
                                <div className="flex flex-col">
                                    <span className="text-[10px] text-gray-500 font-medium">Heart rate variability</span>
                                    <span className="text-blue-500 text-[11px] font-bold tracking-wide">RMSSD</span>
                                </div>
                                <div className="flex items-baseline gap-1">
                                    <span className="text-2xl text-gray-900 font-semibold">{data.rmssd ? data.rmssd : "--"}</span>
                                    <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">MS</span>
                                </div>
                            </div>
                            <div className="flex justify-between items-end pb-1">
                                <div className="flex flex-col">
                                    <span className="text-[10px] text-gray-500 font-medium">Heart rate variability</span>
                                    <span className="text-blue-500 text-[11px] font-bold tracking-wide">SDNN</span>
                                </div>
                                <div className="flex items-baseline gap-1">
                                    <span className="text-2xl text-gray-900 font-semibold">{data.rmssd ? Math.floor(data.rmssd * 1.5) : "--"}</span>
                                    <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">MS</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

        </div>

        {/* History Section for Logged in Users */}
        {currentUser && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 mt-6">
                 <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                    <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                        <Clock size={16} className="text-blue-500"/> Personal History
                    </h3>
                </div>

                {userHistory.length === 0 ? (
                     <div className="p-8 text-center text-gray-400 text-sm font-medium">No past scans found. Run a 30s scan to save your vitals!</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="text-[10px] text-gray-400 uppercase tracking-widest border-b border-gray-100">
                                    <th className="font-semibold py-2">Date & Time</th>
                                    <th className="font-semibold py-2">BPM</th>
                                    <th className="font-semibold py-2">Resp Rate</th>
                                    <th className="font-semibold py-2">RMSSD (ms)</th>
                                    <th className="font-semibold py-2">Stress Level</th>
                                </tr>
                            </thead>
                            <tbody>
                                {userHistory.map((row) => (
                                    <tr key={row.id} className="border-b border-gray-50 text-sm hover:bg-gray-50">
                                        <td className="py-2.5 text-gray-600 font-medium">
                                            {new Date(row.timestamp + "Z").toLocaleString()}
                                        </td>
                                        <td className="py-2.5 font-bold text-gray-800">{row.bpm ? Math.round(row.bpm) : "--"}</td>
                                        <td className="py-2.5 text-blue-600 font-semibold">{row.resp_rate ? Math.round(row.resp_rate) : "--"}</td>
                                        <td className="py-2.5 text-gray-700">{row.rmssd ? Math.round(row.rmssd) : "--"}</td>
                                        <td className="py-2.5">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${row.stress_lvl === 'High' ? 'bg-red-50 text-red-600' : (row.stress_lvl === 'Low' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600')}`}>
                                                {row.stress_lvl || "Unknown"}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        )}

      </div>
      {data.warning && (
          <div className="fixed bottom-6 right-6 bg-red-50 text-red-600 px-4 py-3 rounded-lg border border-red-200 shadow-lg z-50 flex items-center gap-3 text-sm font-medium">
             <AlertCircle size={18} /><span>{data.warning}</span>
          </div>
      )}
    </div>
  );
}

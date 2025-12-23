
import React, { useRef, useState, useCallback, useEffect } from 'react';

interface ScannerProps {
  onCapture: (images: string[]) => void;
  onCancel: () => void;
}

const Scanner: React.FC<ScannerProps> = ({ onCapture, onCancel }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturedImages, setCapturedImages] = useState<string[]>([]);

  const startCamera = useCallback(async () => {
    const constraints: MediaStreamConstraints[] = [
      { 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }, 
        audio: false 
      },
      { video: true, audio: false }
    ];

    let lastError: any = null;
    for (const constraint of constraints) {
      try {
        const s = await navigator.mediaDevices.getUserMedia(constraint);
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
        setError(null);
        return;
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError) {
      setError(`无法访问摄像头: ${lastError.message || '权限被拒绝'}`);
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [startCamera]);

  const captureFrame = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      let width = video.videoWidth;
      let height = video.videoHeight;
      const maxDim = 1200; 
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = (maxDim / width) * height;
          width = maxDim;
        } else {
          width = (maxDim / height) * width;
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, width, height);
        const data = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
        setCapturedImages(prev => [...prev, data]);
      }
    }
  };

  const removeImage = (index: number) => {
    setCapturedImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleDone = () => {
    if (capturedImages.length > 0) {
      onCapture(capturedImages);
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-between p-4 overflow-hidden">
      {/* 顶部状态栏 */}
      <div className="w-full flex justify-between items-center px-4 pt-4 z-10">
        <button onClick={onCancel} className="p-3 bg-white/10 backdrop-blur-md rounded-2xl text-white font-black text-sm">取消</button>
        <div className="px-4 py-2 bg-blue-600 rounded-full text-white text-xs font-black shadow-lg">
          已拍摄 {capturedImages.length} 张
        </div>
      </div>

      {/* 摄像头实时预览 */}
      <div className="relative w-full max-w-md aspect-[3/4] bg-slate-900 rounded-[3rem] overflow-hidden border-2 border-white/10 shadow-2xl flex-shrink-0">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
           <div className="w-72 h-72 border-2 border-white/20 rounded-3xl relative">
              <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-blue-500 rounded-tl-xl"></div>
              <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-blue-500 rounded-br-xl"></div>
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent animate-scan"></div>
           </div>
        </div>
      </div>

      {/* 已捕获图片缩略图托盘 */}
      {capturedImages.length > 0 && (
        <div className="w-full max-w-md flex gap-3 overflow-x-auto py-2 px-1 no-scrollbar">
          {capturedImages.map((img, idx) => (
            <div key={idx} className="relative flex-shrink-0 w-16 h-16 rounded-xl border-2 border-blue-500 overflow-hidden shadow-lg animate-in zoom-in">
              <img src={`data:image/jpeg;base64,${img}`} className="w-full h-full object-cover" />
              <button 
                onClick={() => removeImage(idx)}
                className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white flex items-center justify-center rounded-bl-lg"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 控制中心 */}
      <div className="w-full max-w-md flex items-center justify-around pb-8 px-4">
        <div className="w-16 h-16 invisible"></div> {/* 占位符 */}
        
        <button 
          onClick={captureFrame} 
          disabled={!!error || !stream} 
          className="relative group w-24 h-24 bg-white rounded-full border-[10px] border-slate-800 flex items-center justify-center shadow-2xl active:scale-90 transition-transform disabled:opacity-50"
        >
          <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center text-white group-active:scale-95 transition-transform">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </div>
          {capturedImages.length > 0 && (
            <div className="absolute -top-2 -right-2 w-8 h-8 bg-blue-500 text-white rounded-full border-4 border-black flex items-center justify-center text-xs font-black">
              {capturedImages.length}
            </div>
          )}
        </button>

        <button 
          onClick={handleDone}
          disabled={capturedImages.length === 0}
          className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center transition-all ${capturedImages.length > 0 ? 'bg-emerald-500 text-white scale-110 shadow-lg shadow-emerald-500/30' : 'bg-white/10 text-white/20'}`}
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
          <span className="text-[10px] font-black uppercase mt-1">完成</span>
        </button>
      </div>

      {error && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-600 p-6 rounded-3xl text-center max-w-xs text-white shadow-2xl z-50 animate-in fade-in">
          <p className="font-black mb-4">{error}</p>
          <button onClick={() => { setError(null); startCamera(); }} className="px-6 py-2 bg-white text-red-600 rounded-xl font-black">重试</button>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
      <style>{`
        @keyframes scan { 0% { top: 0; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
        .animate-scan { position: absolute; animation: scan 2.5s ease-in-out infinite; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
};

export default Scanner;

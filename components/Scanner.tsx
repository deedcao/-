
import React, { useRef, useState, useCallback, useEffect } from 'react';

interface ScannerProps {
  onCapture: (base64: string) => void;
  onCancel: () => void;
}

const Scanner: React.FC<ScannerProps> = ({ onCapture, onCancel }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    // 理想分辨率 1080P
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

  const capture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      // 进一步限制最大尺寸为 1200px，确保 Base64 体积极小
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
        // 质量降低到 0.7 以平衡文件大小和清晰度
        const data = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
        onCapture(data);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center p-4">
      <div className="relative w-full max-w-md aspect-[3/4] bg-slate-800 rounded-3xl overflow-hidden border-2 border-blue-500/50 shadow-2xl">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
           <div className="w-64 h-64 border-2 border-blue-400/50 rounded-2xl relative shadow-[0_0_100px_rgba(37,99,235,0.2)]">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-500 rounded-tl-lg"></div>
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-500 rounded-br-lg"></div>
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent animate-scan"></div>
           </div>
           <div className="mt-8 px-4 py-2 bg-blue-600/20 backdrop-blur-md rounded-full text-blue-300 text-xs font-bold border border-blue-500/30">
              请确保光线充足，文字清晰
           </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 bg-red-900/40 backdrop-blur-md border border-red-500/50 p-4 rounded-2xl text-center max-w-xs text-red-200 text-sm font-bold">
          {error}
          <button onClick={() => { setError(null); startCamera(); }} className="mt-2 block w-full text-white bg-red-600 px-3 py-1 rounded-lg">重试</button>
        </div>
      )}

      <div className="mt-10 flex items-center gap-10">
        <button onClick={onCancel} className="px-6 py-3 bg-white/10 text-white rounded-2xl font-bold">返回</button>
        <button onClick={capture} disabled={!!error || !stream} className="w-20 h-20 bg-white rounded-full border-8 border-white/20 flex items-center justify-center shadow-2xl active:scale-90 disabled:opacity-50">
          <div className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center text-white">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </div>
        </button>
        <div className="w-[72px]"></div>
      </div>
      <canvas ref={canvasRef} className="hidden" />
      <style>{`
        @keyframes scan { 0% { top: 0; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
        .animate-scan { position: absolute; animation: scan 2.5s ease-in-out infinite; }
      `}</style>
    </div>
  );
};

export default Scanner;

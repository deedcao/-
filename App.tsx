
import React, { useState, useRef, useEffect } from 'react';
import { AppStage, ProblemAnalysis, ComparisonResult, PracticeQuestion } from './types';
import Scanner from './components/Scanner';
import * as gemini from './services/gemini';

declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
  interface Window {
    aistudio?: AIStudio;
  }
}

// 纯 CSS 渲染的方格组件
const MagicSquareGrid: React.FC<{ data: (string | null)[][] }> = ({ data }) => {
  // 检查是否全为空，防止渲染空白块
  const hasData = data.some(row => row.some(cell => cell !== null && cell !== ''));
  if (!hasData) return null;

  return (
    <div className="grid grid-cols-3 gap-1 bg-slate-300 p-1 rounded-xl w-full max-w-[300px] mx-auto shadow-inner aspect-square">
      {data.map((row, i) => row.map((cell, j) => (
        <div key={`${i}-${j}`} className="bg-white flex items-center justify-center rounded-lg shadow-sm group hover:bg-blue-50 transition-colors">
          {cell ? (
            <span className="text-2xl font-black text-slate-800 tracking-tight">{cell}</span>
          ) : (
            <div className="w-8 h-8 bg-slate-100 rounded-md animate-pulse"></div>
          )}
        </div>
      )))}
    </div>
  );
};

const cleanText = (text: string | undefined): string => {
  if (!text) return '';
  return text
    .replace(/\$/g, '')
    .replace(/\*\*/g, '')
    .replace(/\\times/g, '×')
    .replace(/\\div/g, '÷')
    .replace(/\\text\{([^}]+)\}/g, '$1')
    .trim();
};

const App: React.FC = () => {
  const [stage, setStage] = useState<AppStage>('START');
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState({ text: '', progress: 0 });
  const [errorMsg, setErrorMsg] = useState<React.ReactNode | null>(null);
  const [problem, setProblem] = useState<ProblemAnalysis | null>(null);
  const [userSteps, setUserSteps] = useState('');
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [practice, setPractice] = useState<PracticeQuestion[]>([]);
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(selected);
      }
    };
    checkKey();
    return () => {
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  const decodeAudioData = async (data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> => {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
    return buffer;
  };

  const playExplanation = async () => {
    if (!comparison || isPlayingAudio) return;
    setIsPlayingAudio(true);
    try {
      if (!audioContextRef.current) audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      const ctx = audioContextRef.current;
      const audioBytes = await gemini.generateExplanationAudio(comparison.userStepsAnalysis);
      const audioBuffer = await decodeAudioData(audioBytes, ctx, 24000, 1);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => setIsPlayingAudio(false);
      source.start();
    } catch (err) {
      setIsPlayingAudio(false);
    }
  };

  const handleCapture = async (images: string[]) => {
    setLoading(true);
    setStage('ANALYZING');
    setLoadingStatus({ text: 'AI 正在深度重构题目并修正乱码...', progress: 30 });
    try {
      const result = await gemini.analyzeImage(images);
      setProblem(result);
      setStage('USER_INPUT');
    } catch (err: any) {
      setErrorMsg('识别失败，请确保拍摄清晰且包含完整文字。');
      setStage('START');
    } finally {
      setLoading(false);
    }
  };

  const handleComparison = async () => {
    if (!problem || !userSteps.trim()) return;
    setLoading(true);
    setLoadingStatus({ text: 'AI 正在分析您的逻辑路径...', progress: 50 });
    try {
      const result = await gemini.compareSteps(problem, userSteps);
      setComparison(result);
      setStage('COMPARISON');
    } catch (err) {
      setErrorMsg('诊断失败。');
    } finally {
      setLoading(false);
    }
  };

  const startPractice = async () => {
    setLoading(true);
    setLoadingStatus({ text: '正在生成无乱码的变式练习...', progress: 60 });
    try {
      const result = await gemini.generatePractice(comparison?.weakPoints || [], problem!);
      setPractice(result);
      setStage('PRACTICE');
    } catch (err) {
      setErrorMsg('练习生成失败。');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStage('START');
    setProblem(null);
    setUserSteps('');
    setPractice([]);
    setComparison(null);
    setErrorMsg(null);
  };

  const handleBack = () => {
    if (stage === 'USER_INPUT') setStage('START');
    else if (stage === 'COMPARISON') setStage('USER_INPUT');
    else if (stage === 'PRACTICE') setStage('COMPARISON');
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-12 text-slate-900">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>
          </div>
          <h1 className="text-lg font-black tracking-tight">SmartStudy AI</h1>
        </div>
        <div className="flex gap-2">
           <button onClick={handleSelectKey} className={`p-2 rounded-lg ${hasApiKey ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100'}`}>
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path></svg>
           </button>
           {stage !== 'START' && <button onClick={reset} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-black">重置</button>}
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 sm:p-6">
        {errorMsg && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center justify-between text-red-700">
            <span className="text-sm font-bold">{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-xs font-black opacity-50">关闭</button>
          </div>
        )}

        {stage === 'START' && (
          <div className="py-16 text-center">
            <div className="w-32 h-32 bg-white rounded-[2rem] shadow-xl mx-auto mb-8 flex items-center justify-center">
               <svg className="w-16 h-16 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
            </div>
            <h2 className="text-3xl font-black mb-4">精准错题分析</h2>
            <p className="text-slate-500 mb-12">智能识别题目类型，自动修正 OCR 乱码。</p>
            <div className="flex flex-col gap-4 max-w-xs mx-auto">
              <button onClick={() => setStage('SCANNING')} className="py-5 bg-slate-900 text-white rounded-2xl font-black text-xl shadow-xl active:scale-95 transition-all">连拍识别题目</button>
              <button onClick={() => fileInputRef.current?.click()} className="py-5 bg-white border-2 rounded-2xl font-black text-xl active:scale-95 transition-all">相册导入</button>
              <input type="file" ref={fileInputRef} multiple className="hidden" accept="image/*" onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const files = Array.from(e.target.files || []) as File[];
                const images: string[] = [];
                files.forEach(file => {
                  const reader = new FileReader();
                  reader.onload = (re) => {
                    images.push((re.target?.result as string).split(',')[1]);
                    if (images.length === files.length) handleCapture(images);
                  };
                  reader.readAsDataURL(file);
                });
              }} />
            </div>
          </div>
        )}

        {stage === 'SCANNING' && <Scanner onCapture={handleCapture} onCancel={() => setStage('START')} />}

        {stage === 'USER_INPUT' && problem && (
          <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-white p-6 rounded-[2rem] border shadow-sm space-y-6">
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 bg-blue-600 text-white text-[10px] font-black rounded-full uppercase tracking-widest">
                  重构后的题目 ({problem.subject})
                </span>
              </div>
              
              <div className="space-y-6">
                <p className="text-xl font-bold text-slate-800 leading-relaxed">{cleanText(problem.originalText)}</p>
                
                {/* 智能渲染区 */}
                {problem.gridData && problem.gridData.some(row => row.some(c => c !== null)) ? (
                  <div className="py-4">
                    <MagicSquareGrid data={problem.gridData} />
                    <p className="text-center text-[10px] font-bold text-slate-400 mt-4 uppercase tracking-widest">基于数学逻辑自动还原的方格</p>
                  </div>
                ) : problem.diagram && (
                  <div className="bg-slate-50 p-4 rounded-3xl border border-slate-100 group" onClick={() => setZoomedImage(problem.diagram!)}>
                    <img src={problem.diagram} alt="示意图" className="mx-auto rounded-xl max-h-64 object-contain transition-transform group-hover:scale-[1.02]" />
                    <p className="text-center text-[10px] font-bold text-slate-300 mt-3 uppercase tracking-widest">点击查看清晰大图</p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white p-6 rounded-[2rem] border shadow-sm">
              <h3 className="text-sm font-black mb-6 flex items-center gap-2">
                <div className="w-1 h-4 bg-blue-600 rounded-full"></div>
                AI 标准解析
              </h3>
              <div className="space-y-4">
                {problem.standardSolution.map((s, i) => (
                  <div key={i} className="flex gap-4">
                    <span className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-xs font-black flex-shrink-0">{i + 1}</span>
                    <p className="text-slate-600 font-medium">{cleanText(s)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-6 p-4 bg-slate-900 rounded-2xl flex justify-between items-center text-white">
                <span className="text-xs font-black opacity-50 uppercase">最终答案</span>
                <span className="text-xl font-black">{cleanText(problem.finalAnswer)}</span>
              </div>
            </div>

            <div className="bg-blue-600 p-8 rounded-[2.5rem] text-white shadow-xl">
               <h3 className="text-2xl font-black mb-4 text-center">输入你的解法</h3>
               <textarea 
                 value={userSteps}
                 onChange={(e) => setUserSteps(e.target.value)}
                 className="w-full h-32 p-4 bg-white/10 rounded-2xl border-2 border-white/20 focus:border-white focus:ring-0 placeholder:text-white/30 text-lg"
                 placeholder="在这里输入你的思考过程或计算步骤..."
               />
               <button onClick={handleComparison} disabled={!userSteps.trim() || loading} className="w-full mt-6 py-4 bg-white text-blue-600 rounded-2xl font-black text-lg active:scale-95 disabled:opacity-50 transition-all shadow-lg">开始智能诊断</button>
               <button onClick={handleBack} className="w-full mt-4 text-white/50 text-sm font-black">← 返回重新扫描</button>
            </div>
          </div>
        )}

        {stage === 'COMPARISON' && comparison && (
          <div className="space-y-6 pb-20 animate-in fade-in">
            <div className="bg-emerald-50 border border-emerald-100 p-8 rounded-[2.5rem]">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-black text-emerald-900 tracking-tight">AI 深度诊断报告</h3>
                <button onClick={playExplanation} disabled={isPlayingAudio} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black flex items-center gap-2">
                   {isPlayingAudio ? (
                     <div className="flex gap-1"><div className="w-1 h-3 bg-white animate-bounce"></div><div className="w-1 h-3 bg-white animate-bounce delay-75"></div><div className="w-1 h-3 bg-white animate-bounce delay-150"></div></div>
                   ) : (
                     <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M11 5a1 1 0 011 1v8a1 1 0 11-2 0V6a1 1 0 011-1zM9 7a1 1 0 011 1v4a1 1 0 11-2 0V8a1 1 0 011-1z"></path></svg>
                   )}
                  {isPlayingAudio ? "正在讲解" : "语音解析"}
                </button>
              </div>
              <p className="text-emerald-800 leading-relaxed font-medium text-lg whitespace-pre-wrap">
                {cleanText(comparison.userStepsAnalysis)}
              </p>
            </div>

            <button onClick={startPractice} className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-2xl shadow-xl active:scale-95 transition-all">生成变式练习</button>
            <button onClick={handleBack} className="w-full py-4 border-2 rounded-[2rem] font-black text-slate-500">← 返回修改思路</button>
          </div>
        )}

        {stage === 'PRACTICE' && (
          <div className="space-y-6 pb-20 animate-in fade-in">
            <h2 className="text-3xl font-black px-2">变式强化练习</h2>
            {practice.map((q, i) => (
              <div key={i} className="bg-white p-8 rounded-[2.5rem] border shadow-sm space-y-6">
                <div className="flex justify-between">
                  <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-[10px] font-black">{q.difficulty}</span>
                  <span className="text-slate-200 font-black italic">#{i+1}</span>
                </div>
                <p className="text-2xl font-bold text-slate-800 leading-tight">{cleanText(q.question)}</p>
                {q.gridData && <MagicSquareGrid data={q.gridData} />}
                {q.diagram && (
                   <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                     <img src={q.diagram} className="mx-auto rounded-xl max-h-48 object-contain" alt="练习图示" />
                   </div>
                )}
                <details className="group">
                  <summary className="list-none cursor-pointer p-4 bg-slate-50 rounded-xl flex justify-between font-black text-blue-600">
                    查看答案解析
                    <svg className="w-5 h-5 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                  </summary>
                  <div className="p-4 mt-2 space-y-4 animate-in slide-in-from-top-2">
                    <div className="flex justify-between p-3 bg-slate-900 text-white rounded-lg">
                      <span className="text-xs opacity-50 font-black">正确答案</span>
                      <span className="font-black">{cleanText(q.answer)}</span>
                    </div>
                    {q.solution.map((s, si) => <p key={si} className="text-sm text-slate-500 font-medium">{si+1}. {cleanText(s)}</p>)}
                  </div>
                </details>
              </div>
            ))}
            <button onClick={reset} className="w-full py-5 bg-white border-2 rounded-[2rem] font-black text-xl active:scale-95">完成所有练习</button>
          </div>
        )}
      </main>

      {zoomedImage && (
        <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4 cursor-zoom-out" onClick={() => setZoomedImage(null)}>
          <img src={zoomedImage} className="max-w-full max-h-full rounded-xl shadow-2xl animate-in zoom-in-95" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {loading && (
        <div className="fixed inset-0 bg-white/95 z-50 flex flex-col items-center justify-center p-8 text-center animate-in fade-in">
          <div className="relative w-40 h-40 mb-8">
            <svg className="w-full h-full text-slate-100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="8" /></svg>
            <svg className="absolute top-0 left-0 w-full h-full text-blue-600 animate-[spin_1.5s_linear_infinite]" style={{ strokeDasharray: '283', strokeDashoffset: `${283 - (283 * loadingStatus.progress) / 100}` }} viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" /></svg>
            <div className="absolute inset-0 flex items-center justify-center font-black text-2xl text-blue-600">{Math.round(loadingStatus.progress)}%</div>
          </div>
          <h3 className="text-2xl font-black mb-2">{loadingStatus.text}</h3>
        </div>
      )}
    </div>
  );
};

export default App;

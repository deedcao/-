
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
    setLoadingStatus({ text: 'AI 正在深度重构题目并匹配中国教材库...', progress: 30 });
    try {
      const result = await gemini.analyzeImage(images);
      setProblem(result);
      setStage('USER_INPUT');
      setErrorMsg(null);
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
    setErrorMsg(null);
    setLoadingStatus({ text: 'AI 正在分析您的逻辑路径与物理模型...', progress: 50 });
    try {
      const result = await gemini.compareSteps(problem, userSteps);
      setComparison(result);
      setStage('COMPARISON');
    } catch (err: any) {
      if (err.message === "PRO_MODEL_NOT_FOUND") {
        setErrorMsg(
          <div className="flex flex-col gap-2">
            <span>诊断失败：当前 API Key 无法访问高级诊断模型。</span>
            <button onClick={handleSelectKey} className="text-blue-600 font-black underline text-left">请点击此处选择已开启计费的 API Key</button>
          </div>
        );
      } else {
        setErrorMsg('诊断分析生成失败，请稍后重试。');
      }
    } finally {
      setLoading(false);
    }
  };

  const startPractice = async () => {
    setLoading(true);
    setLoadingStatus({ text: '正在生成深度名师解析的变式练习...', progress: 60 });
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
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>
          </div>
          <h1 className="text-lg font-black tracking-tight">SmartStudy AI</h1>
        </div>
        <div className="flex gap-2">
           <button onClick={handleSelectKey} className={`p-2 rounded-lg transition-colors ${hasApiKey ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path></svg>
           </button>
           {stage !== 'START' && <button onClick={reset} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-black shadow-md active:scale-95 transition-all">重置</button>}
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 sm:p-6">
        {errorMsg && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center justify-between text-red-700 animate-in fade-in slide-in-from-top-4">
            <div className="text-sm font-bold flex-1 pr-4">{errorMsg}</div>
            <button onClick={() => setErrorMsg(null)} className="text-xs font-black opacity-50 hover:opacity-100 flex-shrink-0">关闭</button>
          </div>
        )}

        {stage === 'START' && (
          <div className="py-16 text-center">
            <div className="w-32 h-32 bg-white rounded-[2rem] shadow-xl mx-auto mb-8 flex items-center justify-center border border-slate-100">
               <svg className="w-16 h-16 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
            </div>
            <h2 className="text-4xl font-black mb-4 tracking-tight">AI 物理数学导师</h2>
            <p className="text-slate-500 mb-12 text-lg">连拍题目、智能重构、深度解析。</p>
            <div className="flex flex-col gap-4 max-w-xs mx-auto">
              <button onClick={() => setStage('SCANNING')} className="py-5 bg-slate-900 text-white rounded-2xl font-black text-xl shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /></svg>
                开始拍摄题目
              </button>
              <button onClick={() => fileInputRef.current?.click()} className="py-5 bg-white border-2 border-slate-200 rounded-2xl font-black text-xl active:scale-95 transition-all text-slate-700 hover:bg-slate-50">从相册选择</button>
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
            <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-6">
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 bg-blue-600 text-white text-[10px] font-black rounded-full uppercase tracking-widest shadow-sm">
                  AI 精准重构题目 ({problem.subject})
                </span>
              </div>
              
              <div className="space-y-6">
                <p className="text-xl font-bold text-slate-800 leading-relaxed tracking-tight">{cleanText(problem.originalText)}</p>
                
                {problem.gridData && problem.gridData.some(row => row.some(c => c !== null)) ? (
                  <div className="py-6 bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                    <MagicSquareGrid data={problem.gridData} />
                    <p className="text-center text-[10px] font-bold text-slate-400 mt-6 uppercase tracking-widest">基于数学模型自动校准的 3x3 矩阵</p>
                  </div>
                ) : problem.diagram && (
                  <div className="bg-white p-2 rounded-3xl border border-slate-100 group cursor-zoom-in relative overflow-hidden" onClick={() => setZoomedImage(problem.diagram!)}>
                    <img src={problem.diagram} alt="示意图" className="mx-auto rounded-2xl max-h-80 object-contain transition-transform group-hover:scale-[1.03]" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <p className="absolute bottom-4 left-0 right-0 text-center text-[10px] font-black text-slate-400/80 uppercase tracking-widest">点击查看物理建模大图</p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
              <h3 className="text-sm font-black mb-6 flex items-center gap-2 text-slate-400 uppercase tracking-widest">
                <div className="w-1.5 h-4 bg-blue-500 rounded-full"></div>
                标准解析参考
              </h3>
              <div className="space-y-6">
                {problem.standardSolution.map((s, i) => (
                  <div key={i} className="flex gap-4 group">
                    <div className="w-7 h-7 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-xs font-black flex-shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">{i + 1}</div>
                    <p className="text-slate-600 font-medium leading-relaxed">{cleanText(s)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-8 p-6 bg-slate-900 rounded-3xl flex justify-between items-center text-white shadow-xl">
                <span className="text-xs font-black opacity-40 uppercase tracking-widest">最终判定结果</span>
                <span className="text-2xl font-black">{cleanText(problem.finalAnswer)}</span>
              </div>
            </div>

            <div className="bg-blue-600 p-8 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden group">
               <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform"></div>
               <h3 className="text-2xl font-black mb-6 text-center">在此处录入您的解法步骤</h3>
               <textarea 
                 value={userSteps}
                 onChange={(e) => setUserSteps(e.target.value)}
                 className="w-full h-40 p-5 bg-white/10 rounded-2xl border-2 border-white/10 focus:border-white/40 focus:ring-0 placeholder:text-white/30 text-lg font-medium leading-relaxed resize-none transition-all"
                 placeholder="例如：1.计算截面积之比... 2.考虑连通管高度..."
               />
               <button onClick={handleComparison} disabled={!userSteps.trim() || loading} className="w-full mt-6 py-5 bg-white text-blue-600 rounded-2xl font-black text-xl active:scale-95 disabled:opacity-50 transition-all shadow-xl hover:bg-slate-50">开始智能逻辑诊断</button>
               <button onClick={handleBack} className="w-full mt-4 text-white/50 text-sm font-black hover:text-white transition-colors">← 返回重新扫描题目</button>
            </div>
          </div>
        )}

        {stage === 'COMPARISON' && comparison && (
          <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-6">
            <div className="bg-emerald-50 border border-emerald-100 p-8 rounded-[2.5rem] relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-100/30 rounded-full -mr-32 -mt-32"></div>
              <div className="flex justify-between items-center mb-8 relative z-10">
                <h3 className="text-2xl font-black text-emerald-900 tracking-tight">AI 诊断报告</h3>
                <button onClick={playExplanation} disabled={isPlayingAudio} className={`px-5 py-2.5 rounded-2xl text-xs font-black flex items-center gap-2 shadow-lg transition-all active:scale-90 ${isPlayingAudio ? 'bg-emerald-600 text-white' : 'bg-white text-emerald-600 hover:bg-emerald-100'}`}>
                   {isPlayingAudio ? (
                     <div className="flex gap-1.5 items-end"><div className="w-1.5 h-3.5 bg-white animate-bounce"></div><div className="w-1.5 h-5 bg-white animate-bounce delay-75"></div><div className="w-1.5 h-2.5 bg-white animate-bounce delay-150"></div></div>
                   ) : (
                     <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"></path></svg>
                   )}
                  {isPlayingAudio ? "正在为您讲解" : "收听语音解析"}
                </button>
              </div>
              <div className="relative z-10 space-y-4">
                 <p className="text-emerald-800 leading-loose font-medium text-lg whitespace-pre-wrap bg-white/40 p-6 rounded-3xl backdrop-blur-sm border border-emerald-200/50">
                  {cleanText(comparison.userStepsAnalysis)}
                </p>
              </div>
            </div>

            <button onClick={startPractice} className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-2xl shadow-2xl active:scale-95 transition-all hover:bg-slate-800">生成深度变式练习</button>
            <button onClick={handleBack} className="w-full py-4 border-2 border-slate-200 rounded-[2rem] font-black text-slate-400 hover:text-slate-600 transition-colors">← 返回修改我的思路</button>
          </div>
        )}

        {stage === 'PRACTICE' && (
          <div className="space-y-8 pb-20 animate-in fade-in">
            <div className="px-2">
              <h2 className="text-3xl font-black tracking-tight">名师精选 · 变式强化</h2>
              <p className="text-slate-400 font-bold text-sm mt-1">针对您的薄弱环节（截面积比、连通过程状态）定向生成</p>
            </div>
            
            {practice.map((q, i) => (
              <div key={i} className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm space-y-6 hover:shadow-md transition-shadow">
                <div className="flex justify-between items-center">
                  <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-[10px] font-black uppercase tracking-widest">{q.difficulty}等级</span>
                  <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center font-black text-slate-300 italic">0{i+1}</div>
                </div>
                <p className="text-2xl font-bold text-slate-800 leading-relaxed tracking-tight">{cleanText(q.question)}</p>
                {q.gridData && <MagicSquareGrid data={q.gridData} />}
                {q.diagram && (
                   <div className="bg-slate-50 p-2 rounded-3xl border border-slate-100">
                     <img src={q.diagram} className="mx-auto rounded-2xl max-h-56 object-contain" alt="变式练习插图" />
                   </div>
                )}
                <details className="group">
                  <summary className="list-none cursor-pointer p-5 bg-slate-900 rounded-2xl flex justify-between font-black text-white shadow-lg active:scale-95 transition-all">
                    <span>展开名师深度解析</span>
                    <svg className="w-5 h-5 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7"></path></svg>
                  </summary>
                  <div className="mt-4 space-y-4 animate-in slide-in-from-top-3">
                    <div className="p-5 bg-blue-50 border border-blue-100 rounded-2xl">
                      <div className="text-xs font-black text-blue-400 uppercase tracking-widest mb-3">正确答案</div>
                      <div className="text-2xl font-black text-blue-700">{cleanText(q.answer)}</div>
                    </div>
                    
                    <div className="space-y-4 p-2">
                      <div className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                         <div className="w-3 h-3 bg-blue-600 rounded-full animate-pulse"></div>
                         名师解题看板
                      </div>
                      <div className="space-y-4">
                        {q.solution.map((s, si) => (
                          <div key={si} className="relative pl-6 py-1">
                             <div className="absolute left-0 top-0 bottom-0 w-1 bg-slate-100 rounded-full overflow-hidden">
                               <div className="h-1/3 bg-blue-600 w-full"></div>
                             </div>
                             <p className="text-slate-700 font-medium leading-loose text-lg">{cleanText(s)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </details>
              </div>
            ))}
            <button onClick={reset} className="w-full py-6 bg-white border-4 border-slate-900 rounded-[2.5rem] font-black text-2xl active:scale-95 hover:bg-slate-900 hover:text-white transition-all shadow-xl">完成变式训练</button>
          </div>
        )}
      </main>

      {zoomedImage && (
        <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4 cursor-zoom-out" onClick={() => setZoomedImage(null)}>
          <img src={zoomedImage} className="max-w-full max-h-full rounded-2xl shadow-2xl animate-in zoom-in-95" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {loading && (
        <div className="fixed inset-0 bg-white/95 z-50 flex flex-col items-center justify-center p-8 text-center animate-in fade-in">
          <div className="relative w-48 h-48 mb-10">
            <svg className="w-full h-full text-slate-100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="6" /></svg>
            <svg className="absolute top-0 left-0 w-full h-full text-blue-600 animate-[spin_2s_linear_infinite]" style={{ strokeDasharray: '283', strokeDashoffset: `${283 - (283 * loadingStatus.progress) / 100}` }} viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" /></svg>
            <div className="absolute inset-0 flex items-center justify-center font-black text-3xl text-blue-600">{Math.round(loadingStatus.progress)}%</div>
          </div>
          <h3 className="text-3xl font-black mb-4 tracking-tight">{loadingStatus.text}</h3>
          <p className="text-slate-400 font-bold max-w-xs leading-relaxed italic">“教育不是灌输，而是点燃火种。”</p>
        </div>
      )}
    </div>
  );
};

export default App;

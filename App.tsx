
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

/**
 * 文本清洗工具：剔除 AI 响应中可能残留的 $ 符号、加粗符号等
 */
const cleanText = (text: string | undefined): string => {
  if (!text) return '';
  return text
    .replace(/\$/g, '')              // 剔除 $ 符号
    .replace(/\*\*/g, '')            // 剔除 Markdown 加粗
    .replace(/\\times/g, '×')        // 将 LaTeX 乘号转为通用乘号
    .replace(/\\div/g, '÷')          // 将 LaTeX 除号转为通用除号
    .replace(/\\text\{([^}]+)\}/g, '$1') // 提取 \text{...} 中的内容
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
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
      setErrorMsg(null);
    }
  };

  const decodeAudioData = async (data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> => {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < frameCount; i++) {
        channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
      }
    }
    return buffer;
  };

  const playExplanation = async () => {
    if (!comparison || isPlayingAudio) return;
    setIsPlayingAudio(true);
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      const ctx = audioContextRef.current;
      const audioBytes = await gemini.generateExplanationAudio(comparison.userStepsAnalysis);
      const audioBuffer = await decodeAudioData(audioBytes, ctx, 24000, 1);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => setIsPlayingAudio(false);
      source.start();
    } catch (err) {
      console.error("Audio playback error", err);
      setIsPlayingAudio(false);
    }
  };

  const simulateProgress = (text: string, start: number, end: number, duration: number) => {
    setLoadingStatus(prev => ({ ...prev, text }));
    let current = start;
    const interval = 50;
    const step = (end - start) / (duration / interval);
    const timer = setInterval(() => {
      current += step;
      if (current >= end) {
        clearInterval(timer);
        setLoadingStatus(prev => ({ ...prev, progress: end }));
      } else {
        setLoadingStatus(prev => ({ ...prev, progress: current }));
      }
    }, interval);
    return timer;
  };

  const handleCapture = async (base64: string) => {
    setLoading(true);
    setStage('ANALYZING');
    const pTimer = simulateProgress('AI 正在精准提取题目...', 10, 95, 3000);
    try {
      const result = await gemini.analyzeImage(base64);
      setProblem(result);
      setStage('USER_INPUT');
    } catch (err) {
      setErrorMsg('识别失败，请确保文字清晰且光线明亮。');
      setStage('START');
    } finally {
      clearInterval(pTimer);
      setLoading(false);
    }
  };

  const handleComparison = async () => {
    if (!problem || !userSteps.trim()) return;
    setLoading(true);
    const pTimer = simulateProgress('AI 正在深度复盘思维逻辑...', 20, 95, 5000);
    try {
      const result = await gemini.compareSteps(problem, userSteps);
      setComparison(result);
      setStage('COMPARISON');
    } catch (err) {
      setErrorMsg('诊断失败，请稍后重试。');
    } finally {
      clearInterval(pTimer);
      setLoading(false);
    }
  };

  const startPractice = async () => {
    setLoading(true);
    const pTimer = simulateProgress('正在为您定制巩固练习...', 15, 95, 4000);
    try {
      const result = await gemini.generatePractice(comparison?.weakPoints || [], problem!);
      setPractice(result);
      setStage('PRACTICE');
    } catch (err) {
      setErrorMsg('生成练习失败。');
    } finally {
      clearInterval(pTimer);
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

  return (
    <div className="min-h-screen bg-slate-50 font-sans selection:bg-blue-100 pb-12 text-slate-900">
      <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200/60 px-6 py-4 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-600/20">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 tracking-tight leading-none mb-0.5">SmartStudy AI</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">错题扫码分析专家</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleSelectKey}
            className={`p-2.5 rounded-xl transition-all ${hasApiKey ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path></svg>
          </button>
          {stage !== 'START' && (
            <button onClick={reset} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black shadow-lg shadow-slate-900/10 hover:bg-blue-600 transition-colors">重新开始</button>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 sm:p-6">
        {errorMsg && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-700 animate-in fade-in slide-in-from-top-2">
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            <span className="text-sm font-bold">{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="ml-auto text-xs font-black uppercase tracking-widest opacity-50">关闭</button>
          </div>
        )}

        {stage === 'START' && (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="relative group mb-12">
               <div className="absolute inset-0 bg-blue-600 rounded-[3rem] blur-2xl opacity-20 group-hover:opacity-40 transition-opacity"></div>
               <div className="relative w-40 h-40 bg-white border border-slate-100 rounded-[3rem] shadow-2xl flex items-center justify-center overflow-hidden">
                 <div className="absolute top-0 left-0 w-full h-1.5 bg-blue-600 animate-pulse"></div>
                 <svg className="w-20 h-20 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
               </div>
            </div>
            <h2 className="text-3xl font-black text-slate-900 text-center mb-4">把错题变成成长的阶梯</h2>
            <p className="text-slate-500 font-medium text-center max-w-sm mb-12">通过拍照扫描，AI 将为你深度剖析思维漏洞，关联教材知识，并生成专属巩固题。</p>
            <div className="grid gap-4 w-full max-w-xs">
              <button 
                onClick={() => setStage('SCANNING')}
                className="group relative py-5 bg-slate-900 text-white rounded-[1.5rem] font-black text-xl shadow-xl hover:bg-blue-600 transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-3"
              >
                <span>拍照识别</span>
                <svg className="w-6 h-6 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
              </button>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="py-5 bg-white border-2 border-slate-200 text-slate-700 rounded-[1.5rem] font-black text-xl hover:bg-slate-50 transition-all active:scale-95"
              >
                从相册导入
              </button>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (re) => handleCapture((re.target?.result as string).split(',')[1]);
                  reader.readAsDataURL(file);
                }
              }} />
            </div>
          </div>
        )}

        {stage === 'SCANNING' && <Scanner onCapture={handleCapture} onCancel={() => setStage('START')} />}

        {stage === 'USER_INPUT' && problem && (
          <div className="space-y-6 animate-in slide-in-from-bottom-8 duration-500">
            <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm relative">
              <div className="absolute -top-3 left-6 px-3 py-1 bg-blue-600 text-white text-[10px] font-black rounded-full shadow-lg">OCR 识别题目</div>
              <p className="text-lg font-bold text-slate-800 leading-relaxed pt-2">{cleanText(problem.originalText)}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="px-2.5 py-1 bg-slate-100 text-slate-500 text-[10px] font-black rounded-lg">{problem.subject}</span>
                <span className="px-2.5 py-1 bg-slate-100 text-slate-500 text-[10px] font-black rounded-lg">{problem.grade}</span>
                {problem.keyKnowledgePoints.map(kp => (
                  <span key={kp} className="px-2.5 py-1 bg-blue-50 text-blue-500 text-[10px] font-black rounded-lg"># {cleanText(kp)}</span>
                ))}
              </div>
            </div>

            <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
              <h3 className="text-sm font-black text-slate-900 mb-6 flex items-center gap-2">
                <div className="w-6 h-6 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center text-[10px]">AI</div>
                标准解题思路
              </h3>
              <div className="space-y-5">
                {problem.standardSolution.map((s, i) => (
                  <div key={i} className="flex gap-4 group">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-50 flex items-center justify-center text-[10px] font-black text-slate-400 group-hover:bg-blue-600 group-hover:text-white transition-colors">{i + 1}</span>
                    <p className="text-slate-600 font-medium leading-relaxed">{cleanText(s)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-8 p-4 bg-slate-900 rounded-2xl flex items-center justify-between">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">最终答案</span>
                <span className="text-xl font-black text-white">{cleanText(problem.finalAnswer)}</span>
              </div>
            </div>

            <div className="bg-blue-600 p-8 rounded-[2.5rem] text-white shadow-2xl shadow-blue-600/20">
               <h3 className="text-2xl font-black mb-2">你的思考过程是怎样的？</h3>
               <p className="text-blue-100/80 text-sm font-medium mb-6">告诉 AI 你的想法，即使是错误的。这将帮助我们精准定位盲点。</p>
               <textarea 
                 value={userSteps}
                 onChange={(e) => setUserSteps(e.target.value)}
                 placeholder="例如：我觉得甲的速度应该是乙的两倍..."
                 className="w-full h-32 p-4 bg-white/10 backdrop-blur-md rounded-2xl border-2 border-white/20 focus:border-white focus:ring-0 placeholder:text-white/40 text-lg font-medium transition-all"
               />
               <button 
                 onClick={handleComparison}
                 disabled={!userSteps.trim() || loading}
                 className="w-full mt-6 py-4 bg-white text-blue-600 rounded-2xl font-black text-lg hover:bg-slate-50 transition-all active:scale-95 disabled:opacity-50"
               >
                 开始复盘诊断
               </button>
            </div>
          </div>
        )}

        {stage === 'COMPARISON' && comparison && (
          <div className="space-y-6 animate-in fade-in duration-700">
            <div className="bg-emerald-50 border border-emerald-100 p-8 rounded-[2.5rem] relative overflow-hidden group">
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-black text-emerald-900">AI 逻辑复盘结论</h3>
                  <button 
                    onClick={playExplanation}
                    disabled={isPlayingAudio}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all ${isPlayingAudio ? 'bg-emerald-200 text-emerald-700 animate-pulse' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
                  >
                    {isPlayingAudio ? (
                      <><div className="w-2 h-2 bg-current rounded-full animate-bounce"></div> 讲解中...</>
                    ) : (
                      <><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.983 5.983 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.982 3.982 0 0013 10a3.982 3.982 0 00-1.172-2.828 1 1 0 010-1.415z"></path></svg> 语音讲解</>
                    )}
                  </button>
                </div>
                <p className="text-emerald-800/80 leading-relaxed font-medium text-lg italic">"{cleanText(comparison.userStepsAnalysis)}"</p>
              </div>
              <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-emerald-200/40 rounded-full blur-3xl"></div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
                 <h4 className="text-[10px] font-black text-red-500 uppercase mb-4 tracking-widest">关键差异点</h4>
                 <ul className="space-y-2">
                   {comparison.discrepancies.map((d, i) => (
                     <li key={i} className="flex gap-2 text-sm font-bold text-slate-700">
                       <span className="text-red-400">×</span> {cleanText(d)}
                     </li>
                   ))}
                 </ul>
               </div>
               <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
                 <h4 className="text-[10px] font-black text-blue-500 uppercase mb-4 tracking-widest">需巩固知识点</h4>
                 <div className="flex flex-wrap gap-2">
                   {comparison.weakPoints.map(wp => (
                     <span key={wp} className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold"># {cleanText(wp)}</span>
                   ))}
                 </div>
               </div>
            </div>

            <div className="bg-slate-900 text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden group">
              <div className="relative z-10 flex flex-col h-full">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="text-blue-400 font-black text-xs uppercase tracking-widest mb-2">教材深度关联</h3>
                    <p className="text-2xl font-black group-hover:text-blue-400 transition-colors leading-tight">{cleanText(comparison.textbookReference.textbook)}</p>
                  </div>
                  <div className="p-3 bg-white/5 rounded-2xl">
                    <svg className="w-8 h-8 text-blue-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>
                  </div>
                </div>
                <div className="space-y-1 mb-8">
                  <p className="text-lg font-bold text-slate-200">{cleanText(comparison.textbookReference.chapter)}</p>
                  <p className="text-slate-400 font-medium">{cleanText(comparison.textbookReference.section)}</p>
                  <p className="text-[10px] text-blue-500/60 font-black uppercase tracking-widest mt-2">{cleanText(comparison.textbookReference.path)}</p>
                </div>
                {/* 增加安全检查：只有真实的 http/https 链接才显示按钮 */}
                {comparison.textbookReference.uri && comparison.textbookReference.uri.startsWith('http') && (
                  <a 
                    href={comparison.textbookReference.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-auto w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black text-center transition-all shadow-lg shadow-blue-600/30 active:scale-95 flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                    查看详情与解析
                  </a>
                )}
              </div>
            </div>

            <button 
              onClick={startPractice}
              className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-2xl shadow-xl hover:bg-blue-600 transition-all flex items-center justify-center gap-4 active:scale-95"
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
              生成定制变式练习
            </button>
          </div>
        )}

        {stage === 'PRACTICE' && (
          <div className="space-y-8 animate-in slide-in-from-bottom-12 duration-500">
            <div className="flex items-center justify-between">
              <h2 className="text-3xl font-black text-slate-900 tracking-tight">专属强化练习</h2>
              <span className="px-4 py-1.5 bg-slate-100 text-slate-400 rounded-full text-[10px] font-black">AI GENERATED</span>
            </div>
            <div className="space-y-6">
              {practice.map((q, i) => (
                <div key={i} className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl transition-shadow group">
                  <div className="flex items-center justify-between mb-6">
                    <span className={`px-4 py-1.5 rounded-full text-[10px] font-black tracking-widest uppercase ${
                      q.difficulty === '基础' ? 'bg-emerald-50 text-emerald-600' :
                      q.difficulty === '中等' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'
                    }`}>
                      {q.difficulty}
                    </span>
                    <span className="text-slate-100 font-black text-3xl italic group-hover:text-blue-50 transition-colors">#{i+1}</span>
                  </div>
                  <p className="text-2xl font-bold text-slate-800 leading-snug mb-8">{cleanText(q.question)}</p>
                  
                  <details className="group/details">
                    <summary className="list-none cursor-pointer p-4 bg-slate-50 rounded-2xl flex items-center justify-between font-black text-blue-600 hover:bg-blue-50 transition-colors">
                      查看解析与答案
                      <svg className="w-5 h-5 group-open/details:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                    </summary>
                    <div className="mt-4 p-4 space-y-4 border-t border-slate-100 animate-in fade-in slide-in-from-top-2">
                      <div className="flex items-center justify-between p-3 bg-slate-900 text-white rounded-xl">
                        <span className="text-[10px] font-black opacity-50">正确答案</span>
                        <span className="text-lg font-black">{cleanText(q.answer)}</span>
                      </div>
                      <div className="space-y-3">
                        {q.solution.map((step, si) => (
                          <div key={si} className="flex gap-3 text-sm font-medium text-slate-500">
                            <span className="text-slate-300 font-black">{si+1}.</span>
                            <p>{cleanText(step)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>
                </div>
              ))}
            </div>
            <button 
              onClick={reset}
              className="w-full py-5 bg-white border-2 border-slate-200 text-slate-500 rounded-[2rem] font-black text-xl hover:bg-slate-900 hover:text-white transition-all active:scale-95 shadow-xl shadow-slate-200/20"
            >
              识别下一题
            </button>
          </div>
        )}
      </main>

      {loading && (
        <div className="fixed inset-0 bg-white/95 backdrop-blur-2xl z-50 flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-300">
          <div className="relative w-48 h-48 mb-12">
            <svg className="absolute inset-0 w-full h-full text-slate-100" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="8" />
            </svg>
            <svg className="absolute inset-0 w-full h-full text-blue-600 animate-[spin_1.5s_linear_infinite]" viewBox="0 0 100 100" style={{ strokeDasharray: '283', strokeDashoffset: `${283 - (283 * loadingStatus.progress) / 100}` }}>
              <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-4xl font-black text-blue-600">{Math.round(loadingStatus.progress)}%</span>
            </div>
          </div>
          <h3 className="text-3xl font-black text-slate-900 mb-2">正在深度思考</h3>
          <p className="text-slate-400 font-bold text-lg max-w-xs leading-relaxed animate-pulse">{loadingStatus.text}</p>
        </div>
      )}
    </div>
  );
};

export default App;

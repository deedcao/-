
import React, { useState, useRef, useEffect } from 'react';
import { AppStage, ProblemAnalysis, ComparisonResult, PracticeQuestion, FavoriteItem, Subject } from './types';
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

const subjects: { id: Subject; name: string; icon: React.ReactNode; color: string; border: string; text: string }[] = [
  { id: 'Auto', name: '智能识别', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>, color: 'bg-slate-900', border: 'border-slate-900', text: 'text-slate-900' },
  { id: 'Mathematics', name: '数学', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>, color: 'bg-blue-600', border: 'border-blue-600', text: 'text-blue-600' },
  { id: 'Physics', name: '物理', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>, color: 'bg-indigo-600', border: 'border-indigo-600', text: 'text-indigo-600' },
  { id: 'Chemistry', name: '化学', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517" /></svg>, color: 'bg-emerald-600', border: 'border-emerald-600', text: 'text-emerald-600' },
  { id: 'Biology', name: '生物', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>, color: 'bg-green-600', border: 'border-green-600', text: 'text-green-600' },
  { id: 'English', name: '英语', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9" /></svg>, color: 'bg-purple-600', border: 'border-purple-600', text: 'text-purple-600' },
];

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

const DifficultyBadge: React.FC<{ level: '基础' | '中等' | '困难' }> = ({ level }) => {
  const styles = {
    '基础': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    '中等': 'bg-blue-100 text-blue-700 border-blue-200',
    '困难': 'bg-orange-100 text-orange-700 border-orange-200',
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border uppercase tracking-wider ${styles[level] || styles['基础']}`}>
      {level}
    </span>
  );
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
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<Subject>('Auto');
  const [favFilter, setFavFilter] = useState<Subject | 'All'>('All');
  
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
    const savedFavorites = localStorage.getItem('smartstudy_favorites');
    if (savedFavorites) {
      try { setFavorites(JSON.parse(savedFavorites)); } catch (e) { console.error(e); }
    }
    return () => { if (audioContextRef.current) audioContextRef.current.close(); };
  }, []);

  useEffect(() => { localStorage.setItem('smartstudy_favorites', JSON.stringify(favorites)); }, [favorites]);

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
    } catch (err) { setIsPlayingAudio(false); }
  };

  const handleCapture = async (images: string[]) => {
    setLoading(true);
    setStage('ANALYZING');
    setLoadingStatus({ text: `正在使用${selectedSubject === 'Auto' ? '全科智能分析' : selectedSubject + '专用知识库'}解析中...`, progress: 30 });
    try {
      const result = await gemini.analyzeImage(images, selectedSubject);
      setProblem(result);
      setStage('USER_INPUT');
      setErrorMsg(null);
    } catch (err: any) {
      setErrorMsg('分析失败，请拍摄更清晰的照片。');
      setStage('START');
    } finally { setLoading(false); }
  };

  const handleComparison = async () => {
    if (!problem || !userSteps.trim()) return;
    setLoading(true);
    setLoadingStatus({ text: 'AI 正在比对您的思路...', progress: 50 });
    try {
      const result = await gemini.compareSteps(problem, userSteps);
      setComparison(result);
      setStage('COMPARISON');
    } catch (err: any) { setErrorMsg('诊断失败。'); } finally { setLoading(false); }
  };

  const startPractice = async () => {
    setLoading(true);
    setLoadingStatus({ text: 'AI 正在生成变式练习...', progress: 20 });
    try {
      const interval = setInterval(() => {
        setLoadingStatus(prev => ({ 
          ...prev, 
          progress: Math.min(prev.progress + 5, 95),
          text: prev.progress > 60 ? '正在校验图形逻辑...' : '正在基于考点生成变式...'
        }));
      }, 1000);
      const result = await gemini.generatePractice(comparison?.weakPoints || [], problem!);
      clearInterval(interval);
      setPractice(result);
      setStage('PRACTICE');
    } catch (err) { setErrorMsg('生成练习失败。'); } finally { setLoading(false); }
  };

  const toggleFavorite = (q: PracticeQuestion) => {
    const isFavorited = favorites.some(f => f.question === q.question);
    if (isFavorited) {
      setFavorites(favorites.filter(f => f.question !== q.question));
    } else {
      const newFav: FavoriteItem = { 
        ...q, 
        id: Math.random().toString(36).substr(2, 9), 
        favoritedAt: Date.now(),
        problemType: q.problemType || problem?.subject
      };
      setFavorites([...favorites, newFav]);
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
    else if (stage === 'FAVORITES') setStage('START');
  };

  const handleForward = () => {
    if (stage === 'START' && problem) setStage('USER_INPUT');
    else if (stage === 'USER_INPUT' && comparison) setStage('COMPARISON');
    else if (stage === 'COMPARISON' && practice.length > 0) setStage('PRACTICE');
  };

  // 检查是否可以前进
  const canGoForward = () => {
    if (stage === 'START' && problem) return true;
    if (stage === 'USER_INPUT' && comparison) return true;
    if (stage === 'COMPARISON' && practice.length > 0) return true;
    return false;
  };

  const filteredFavorites = favorites.filter(f => favFilter === 'All' || f.problemType === favFilter);

  return (
    <div className="min-h-screen bg-slate-50 pb-12 text-slate-900 font-sans selection:bg-blue-100">
      {/* 增强型导航栏 */}
      <header className="bg-white/90 backdrop-blur-lg border-b px-4 py-3 flex items-center justify-between sticky top-0 z-40 shadow-sm transition-all">
        <div className="flex items-center gap-2">
          {/* 返回按钮 */}
          {stage !== 'START' && stage !== 'SCANNING' && (
            <button 
              onClick={handleBack} 
              className="flex items-center gap-1 px-3 py-2 bg-slate-900 text-white rounded-xl hover:bg-slate-800 active:scale-95 transition-all shadow-md group"
              title="返回上一级"
            >
              <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7"></path></svg>
              <span className="text-[10px] font-black uppercase tracking-wider hidden xs:block">返回</span>
            </button>
          )}

          {/* 前进按钮 */}
          {canGoForward() && stage !== 'SCANNING' && (
            <button 
              onClick={handleForward} 
              className="flex items-center gap-1 px-3 py-2 bg-slate-900 text-white rounded-xl hover:bg-slate-800 active:scale-95 transition-all shadow-md group"
              title="前进到下一级"
            >
              <span className="text-[10px] font-black uppercase tracking-wider hidden xs:block">前进</span>
              <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7"></path></svg>
            </button>
          )}
          
          {/* Logo 区域 */}
          <div 
            className={`flex items-center gap-2 px-2 py-1.5 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors`}
            onClick={reset}
          >
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-md">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>
            </div>
            <h1 className="text-sm font-black tracking-tight uppercase group hidden md:block">
              SmartStudy <span className="text-blue-600">AI</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
           <button onClick={() => setStage('FAVORITES')} className="p-2.5 bg-pink-50 text-pink-600 rounded-xl hover:bg-pink-100 transition-colors relative group border border-pink-100 shadow-sm">
             <svg className="w-5 h-5 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd"></path></svg>
             {favorites.length > 0 && (
               <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-pink-600 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white font-bold shadow-sm">
                 {favorites.length}
               </span>
             )}
           </button>
           
           <button onClick={handleSelectKey} className={`p-2.5 rounded-xl transition-all border shadow-sm ${hasApiKey ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-50 text-slate-300 border-slate-100'}`}>
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path></svg>
           </button>

           {stage !== 'START' && (
             <button onClick={reset} className="ml-1 px-4 py-2.5 bg-blue-50 text-blue-700 rounded-xl text-[10px] font-black shadow-sm active:scale-95 transition-all uppercase tracking-widest border border-blue-100">
               重置
             </button>
           )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 sm:p-6">
        {errorMsg && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center justify-between text-red-700 animate-in fade-in slide-in-from-top-2">
            <div className="text-sm font-bold flex-1 pr-4">{errorMsg}</div>
            <button onClick={() => setErrorMsg(null)} className="text-xs font-black opacity-50 hover:opacity-100">关闭</button>
          </div>
        )}

        {stage === 'START' && (
          <div className="py-8 animate-in fade-in slide-in-from-bottom-4">
            <div className="mb-12 text-center">
              <div className="w-32 h-32 bg-white rounded-[2.5rem] shadow-2xl mx-auto mb-8 flex items-center justify-center border border-slate-100 relative group overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-indigo-50 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <svg className="w-16 h-16 text-blue-600 relative z-10 transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path></svg>
              </div>
              <h2 className="text-4xl font-black mb-4 tracking-tight">错题扫码专家</h2>
              <p className="text-slate-500 text-lg px-4 max-w-sm mx-auto">拍照重构标准示意图，基于教材库精准诊断您的薄弱环节。</p>
            </div>

            <div className="mb-10">
              <div className="flex items-center justify-between mb-4 px-2">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">学习学科引导</h3>
                <span className="text-[10px] text-blue-500 font-bold bg-blue-50 px-2 py-0.5 rounded-full">当前：{subjects.find(s=>s.id===selectedSubject)?.name}</span>
              </div>
              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-4 px-1 snap-x">
                {subjects.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSubject(s.id)}
                    className={`flex-shrink-0 flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-sm transition-all duration-300 shadow-sm snap-start ${selectedSubject === s.id ? `${s.color} text-white scale-105 shadow-xl` : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-100'}`}
                  >
                    {s.icon}
                    {s.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4 max-w-xs mx-auto">
              <button onClick={() => setStage('SCANNING')} className={`py-6 text-white rounded-[2rem] font-black text-xl shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3 relative overflow-hidden group ${subjects.find(s => s.id === selectedSubject)?.color || 'bg-slate-900'}`}>
                <div className="absolute inset-0 bg-white/10 translate-x-full group-hover:translate-x-0 transition-transform skew-x-12"></div>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                立即开始扫描
              </button>
              <button onClick={() => fileInputRef.current?.click()} className="py-5 bg-white border-2 border-slate-200 rounded-[2rem] font-black text-xl active:scale-95 transition-all text-slate-700 hover:bg-slate-50">从相册导入</button>
              <button onClick={() => setStage('FAVORITES')} className="py-4 bg-pink-50 text-pink-700 rounded-[2rem] font-black text-lg active:scale-95 transition-all flex items-center justify-center gap-2">
                 我的“错题本”
              </button>
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
            <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-6">
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 text-white text-[10px] font-black rounded-full uppercase tracking-widest shadow-sm ${subjects.find(s => s.name === problem.subject)?.color || 'bg-blue-600'}`}>
                  {problem.subject} · AI 重构图
                </span>
                <span className="px-3 py-1 bg-slate-100 text-slate-500 text-[10px] font-black rounded-full uppercase tracking-widest">{problem.grade}</span>
              </div>
              <div className="space-y-6">
                <p className="text-xl font-bold text-slate-800 leading-relaxed tracking-tight">{cleanText(problem.originalText)}</p>
                {problem.diagram && (
                  <div className="bg-white p-1 rounded-[2rem] border border-blue-100 shadow-inner group cursor-zoom-in relative overflow-hidden" onClick={() => setZoomedImage(problem.diagram!)}>
                    <img src={problem.diagram} alt="重构示意图" className="mx-auto rounded-3xl max-h-80 w-full object-contain" />
                    <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                       <span className="bg-white/90 px-4 py-2 rounded-full text-xs font-black text-blue-600 shadow-xl">点击查看高清图</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
              <h3 className="text-sm font-black mb-6 flex items-center gap-2 text-slate-400 uppercase tracking-widest">教材解题参考</h3>
              <div className="space-y-4">
                {problem.standardSolution.map((s, i) => (
                  <div key={i} className="flex gap-4 group">
                    <div className="w-8 h-8 rounded-xl bg-slate-50 flex items-center justify-center text-xs font-black flex-shrink-0 text-slate-400 group-hover:bg-blue-600 group-hover:text-white transition-colors">{i + 1}</div>
                    <p className="text-slate-600 font-medium leading-relaxed pt-1">{cleanText(s)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-8 p-6 bg-slate-900 rounded-[2rem] flex justify-between items-center text-white shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
                <span className="text-xs font-black opacity-40 uppercase tracking-widest relative z-10">标准最终答案</span>
                <span className="text-2xl font-black relative z-10">{cleanText(problem.finalAnswer)}</span>
              </div>
            </div>
            <div className="bg-blue-600 p-8 rounded-[3rem] text-white shadow-2xl relative overflow-hidden group">
               <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-white/10 rounded-full blur-3xl group-hover:scale-110 transition-transform"></div>
               <h3 className="text-2xl font-black mb-6 text-center relative z-10">录入您的解题逻辑</h3>
               <textarea 
                 value={userSteps}
                 onChange={(e) => setUserSteps(e.target.value)}
                 className="w-full h-40 p-6 bg-white/10 rounded-3xl border-2 border-white/20 placeholder:text-white/40 text-lg font-medium resize-none focus:bg-white/20 transition-all outline-none relative z-10"
                 placeholder="在这里输入您的步骤或思路，AI 将为您诊断逻辑漏洞..."
               />
               <button onClick={handleComparison} disabled={!userSteps.trim() || loading} className="w-full mt-6 py-6 bg-white text-blue-600 rounded-[2rem] font-black text-xl active:scale-95 disabled:opacity-50 transition-all shadow-xl relative z-10">智能诊断逻辑错误</button>
            </div>
          </div>
        )}

        {stage === 'COMPARISON' && comparison && (
          <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-6">
            <div className="bg-emerald-50 border border-emerald-100 p-8 rounded-[3rem] relative overflow-hidden shadow-sm">
              <div className="flex justify-between items-center mb-8">
                <div className="flex items-center gap-3">
                   <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center text-white">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 12l2 2 4-4"></path></svg>
                   </div>
                   <h3 className="text-2xl font-black text-emerald-900 tracking-tight">AI 诊断报告</h3>
                </div>
                <button onClick={playExplanation} disabled={isPlayingAudio} className={`px-5 py-2.5 rounded-2xl text-xs font-black flex items-center gap-2 shadow-lg transition-all active:scale-90 ${isPlayingAudio ? 'bg-emerald-600 text-white animate-pulse' : 'bg-white text-emerald-600'}`}>
                   {isPlayingAudio ? "讲解中..." : "语音讲解"}
                </button>
              </div>
              <p className="text-emerald-800 leading-loose font-medium text-lg whitespace-pre-wrap bg-white/60 p-6 rounded-[2rem] backdrop-blur-sm border border-emerald-100/50">
                {cleanText(comparison.userStepsAnalysis)}
              </p>
            </div>
            
            <div className="grid grid-cols-1 gap-4">
               <button onClick={startPractice} className="w-full py-6 bg-slate-900 text-white rounded-[2.5rem] font-black text-2xl shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3">
                 <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                 生成变式强化训练
               </button>
            </div>
          </div>
        )}

        {stage === 'PRACTICE' && (
          <div className="space-y-8 pb-20 animate-in fade-in">
            <div className="flex justify-between items-center px-2">
              <h2 className="text-3xl font-black tracking-tight">名师精选 · {problem?.subject}变式</h2>
            </div>
            {practice.map((q, i) => {
              const isFav = favorites.some(f => f.question === q.question);
              return (
                <div key={i} className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm space-y-6 relative overflow-hidden group">
                  <button onClick={() => toggleFavorite(q)} className={`absolute top-6 right-6 p-4 rounded-[1.5rem] transition-all active:scale-75 shadow-lg border-2 ${isFav ? 'bg-pink-500 text-white border-pink-500' : 'bg-white text-slate-300 border-slate-100 hover:text-pink-400 hover:border-pink-100'}`}>
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd"></path></svg>
                  </button>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center font-black text-slate-300 italic text-xl">0{i+1}</div>
                    <DifficultyBadge level={q.difficulty} />
                  </div>
                  <p className="text-2xl font-bold text-slate-800 pr-16 leading-tight tracking-tight">{cleanText(q.question)}</p>
                  {q.diagram && (
                    <div className="bg-slate-50 p-2 rounded-[2rem] border border-slate-100">
                      <img src={q.diagram} className="mx-auto rounded-3xl max-h-56 object-contain" alt="练习图示" />
                    </div>
                  )}
                  <details className="group/ans">
                    <summary className="list-none cursor-pointer p-5 bg-slate-900 rounded-[1.5rem] flex justify-between font-black text-white shadow-xl hover:bg-slate-800 transition-colors">
                      <span>查看解析</span>
                      <svg className="w-5 h-5 group-open/ans:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7"></path></svg>
                    </summary>
                    <div className="mt-4 space-y-4 animate-in slide-in-from-top-2">
                      <div className="p-6 bg-blue-50 text-blue-700 text-2xl font-black rounded-3xl border border-blue-100">{cleanText(q.answer)}</div>
                      <div className="p-4 leading-loose text-lg text-slate-600 border-l-4 border-blue-100 ml-2">
                         {q.solution.map((s, si) => <p key={si} className="mb-2">{cleanText(s)}</p>)}
                      </div>
                    </div>
                  </details>
                </div>
              );
            })}
            <button onClick={reset} className="w-full py-6 bg-white border-4 border-slate-900 rounded-[2.5rem] font-black text-2xl shadow-xl hover:bg-slate-900 hover:text-white transition-all active:scale-95">完成练习</button>
          </div>
        )}

        {stage === 'FAVORITES' && (
          <div className="space-y-8 pb-20 animate-in fade-in">
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-4">
                <h2 className="text-3xl font-black tracking-tight">我的“错题本”</h2>
              </div>
              <span className="text-xs font-black text-pink-500 bg-pink-50 px-3 py-1 rounded-full uppercase">共 {favorites.length} 题</span>
            </div>

            {/* 错题本学科过滤 */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
               <button 
                 onClick={() => setFavFilter('All')}
                 className={`flex-shrink-0 px-4 py-2 rounded-xl text-xs font-black transition-all ${favFilter === 'All' ? 'bg-slate-900 text-white' : 'bg-white border text-slate-400'}`}
               >
                 全部题目
               </button>
               {subjects.filter(s => s.id !== 'Auto').map(s => (
                 <button 
                    key={s.id}
                    onClick={() => setFavFilter(s.id)}
                    className={`flex-shrink-0 px-4 py-2 rounded-xl text-xs font-black transition-all ${favFilter === s.id ? `${s.color} text-white` : 'bg-white border text-slate-400 hover:border-slate-300'}`}
                 >
                    {s.name}
                 </button>
               ))}
            </div>

            {filteredFavorites.length === 0 ? (
              <div className="py-24 text-center">
                <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6 opacity-40">
                   <svg className="w-12 h-12 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path></svg>
                </div>
                <p className="text-xl font-black text-slate-300 uppercase tracking-widest">还没有收藏该类错题</p>
                <button onClick={() => setStage('START')} className="mt-8 px-8 py-3 bg-blue-600 text-white rounded-2xl font-black shadow-lg hover:shadow-blue-200 transition-all">立即去扫码</button>
              </div>
            ) : (
              <div className="space-y-6">
                {filteredFavorites.sort((a,b) => b.favoritedAt - a.favoritedAt).map((fav) => (
                  <div key={fav.id} className="bg-white p-7 rounded-[3rem] border border-slate-100 shadow-sm space-y-4 relative group">
                    <button onClick={() => toggleFavorite(fav)} className="absolute top-6 right-6 p-3 text-pink-500 hover:scale-110 transition-transform"><svg className="w-7 h-7" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd"></path></svg></button>
                    <div className="flex items-center gap-3">
                      <DifficultyBadge level={fav.difficulty} />
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-md text-white uppercase tracking-tighter ${subjects.find(s=>s.id === fav.problemType || s.name === fav.problemType)?.color || 'bg-slate-400'}`}>
                        {fav.problemType}
                      </span>
                      <span className="text-[10px] text-slate-300 font-bold uppercase">{new Date(fav.favoritedAt).toLocaleDateString()}</span>
                    </div>
                    <p className="text-xl font-bold leading-tight pr-10 text-slate-800">{cleanText(fav.question)}</p>
                    {fav.diagram && <img src={fav.diagram} className="max-h-48 rounded-2xl mx-auto border border-slate-50" />}
                    <details className="group/fav-ans">
                      <summary className="font-black py-3 px-4 bg-slate-50 rounded-2xl cursor-pointer text-blue-600 text-sm flex justify-between">
                         <span>查看解析详情</span>
                         <svg className="w-4 h-4 group-open/fav-ans:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7"></path></svg>
                      </summary>
                      <div className="mt-4 p-4 border-l-4 border-blue-50 space-y-3">
                        <div className="text-xl font-black text-slate-800">答案：{cleanText(fav.answer)}</div>
                        <div className="text-sm text-slate-500 leading-relaxed italic">
                          {fav.solution.map((s, si) => <p key={si} className="mb-2">{cleanText(s)}</p>)}
                        </div>
                      </div>
                    </details>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* 图片放大预览 */}
      {zoomedImage && (
        <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center p-4 cursor-zoom-out animate-in fade-in" onClick={() => setZoomedImage(null)}>
          <img src={zoomedImage} className="max-w-full max-h-[80vh] rounded-2xl shadow-2xl animate-in zoom-in-95" alt="预览图" />
          <button className="mt-8 px-10 py-3 bg-white text-black rounded-full font-black uppercase text-xs shadow-2xl">点击任意位置退出预览</button>
        </div>
      )}

      {/* 全局加载遮罩 */}
      {loading && (
        <div className="fixed inset-0 bg-white/95 z-50 flex flex-col items-center justify-center p-8 text-center animate-in fade-in">
          <div className="relative w-48 h-48 mb-10">
            <svg className="w-full h-full text-slate-100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="6" /></svg>
            <svg className="absolute top-0 left-0 w-full h-full text-blue-600 animate-[spin_2s_linear_infinite]" style={{ strokeDasharray: '283', strokeDashoffset: `${283 - (283 * loadingStatus.progress) / 100}` }} viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" /></svg>
            <div className="absolute inset-0 flex items-center justify-center font-black text-4xl text-blue-600 tracking-tighter">
              {Math.round(loadingStatus.progress)}<span className="text-sm ml-0.5">%</span>
            </div>
          </div>
          <h3 className="text-3xl font-black mb-4 tracking-tight leading-snug max-w-sm text-slate-900">{loadingStatus.text}</h3>
          <p className="text-slate-400 font-medium animate-pulse">AI 正在调取学科知识库进行专业分析...</p>
        </div>
      )}

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        @media (max-width: 400px) {
          .xs\:block { display: none; }
        }
      `}</style>
    </div>
  );
};

export default App;

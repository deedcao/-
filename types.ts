
export interface ProblemAnalysis {
  originalText: string;
  subject: string;
  grade: string;
  standardSolution: string[];
  finalAnswer: string;
  keyKnowledgePoints: string[];
  // Fix: added problemType to match usage in services/gemini.ts (line 123)
  problemType: string;
  diagram?: string; // Base64 image data
  gridData?: (string | null)[][]; // 3x3 grid data for perfect rendering
}

export interface ComparisonResult {
  userStepsAnalysis: string;
  discrepancies: string[];
  weakPoints: string[];
  groundingUrls?: { title: string; uri: string }[];
}

export interface PracticeQuestion {
  question: string;
  solution: string[];
  answer: string;
  difficulty: '基础' | '中等' | '困难';
  // Fix: added problemType to match usage in services/gemini.ts (line 150)
  problemType?: string;
  diagram?: string;
  gridData?: (string | null)[][];
}

export type AppStage = 'START' | 'SCANNING' | 'ANALYZING' | 'USER_INPUT' | 'COMPARISON' | 'PRACTICE';

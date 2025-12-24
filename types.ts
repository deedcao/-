
export type Subject = 'Auto' | 'Mathematics' | 'Physics' | 'Chemistry' | 'Biology' | 'English';

export interface ProblemAnalysis {
  originalText: string;
  subject: string;
  grade: string;
  standardSolution: string[];
  finalAnswer: string;
  keyKnowledgePoints: string[];
  problemType: string;
  diagram?: string; // AI 生成的图（仅用于变式练习）
  sourceImage?: string; // 题目原图（用户拍摄）
  diagramDescription?: string;
  gridData?: (string | null)[][];
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
  problemType?: string;
  diagram?: string;
  gridData?: (string | null)[][];
}

export interface FavoriteItem extends PracticeQuestion {
  id: string;
  favoritedAt: number;
}

export type AppStage = 'START' | 'SCANNING' | 'ANALYZING' | 'USER_INPUT' | 'COMPARISON' | 'PRACTICE' | 'FAVORITES';

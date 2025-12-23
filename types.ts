
export interface ProblemAnalysis {
  originalText: string;
  subject: string;
  grade: string;
  standardSolution: string[];
  finalAnswer: string;
  keyKnowledgePoints: string[];
}

export interface ComparisonResult {
  userStepsAnalysis: string;
  discrepancies: string[];
  weakPoints: string[];
  groundingUrls?: { title: string; uri: string }[];
  textbookReference?: {
    textbook: string;
    chapter: string;
    section: string;
    path: string;
    uri: string;
  };
}

export interface PracticeQuestion {
  question: string;
  solution: string[];
  answer: string;
  difficulty: '基础' | '中等' | '困难';
}

export type AppStage = 'START' | 'SCANNING' | 'ANALYZING' | 'USER_INPUT' | 'COMPARISON' | 'PRACTICE';

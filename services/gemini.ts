
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ProblemAnalysis, ComparisonResult, PracticeQuestion } from "../types";

/**
 * 图像识别逻辑 - 保持纯净文本
 */
export const analyzeImage = async (base64Image: string): Promise<ProblemAnalysis> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { inlineData: { data: base64Image, mimeType: 'image/jpeg' } },
        { text: "请精准识别图片中的题目并提供分步解答。注意：禁止使用 $ 符号或 Markdown 数学定界符。使用易读的文本表达。" }
      ]
    },
    config: {
      systemInstruction: `你是一位教育专家。
1. **识别题目**：禁止使用 $ 符号包裹变量。
2. **结构化解答**：提供标准步骤。
3. **输出格式**：JSON。禁止在字段内使用 ** 等 Markdown 加粗格式。`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          originalText: { type: Type.STRING },
          subject: { type: Type.STRING },
          grade: { type: Type.STRING },
          standardSolution: { type: Type.ARRAY, items: { type: Type.STRING } },
          finalAnswer: { type: Type.STRING },
          keyKnowledgePoints: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["originalText", "subject", "grade", "standardSolution", "finalAnswer", "keyKnowledgePoints"]
      }
    }
  });

  try {
    return JSON.parse(response.text || '{}');
  } catch (e) {
    throw new Error("识别解析失败，请确保图片清晰且光线充足。");
  }
};

/**
 * 差异化思路分析逻辑 - 强制要求真实 URL，禁止虚构协议
 */
export const compareSteps = async (
  problem: ProblemAnalysis,
  userSteps: string
): Promise<ComparisonResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `
      【题目】：${problem.originalText}
      【标准解法】：${problem.standardSolution.join(' -> ')}
      【学生思路】：${userSteps}
      请比对并指出盲区。
      **特别要求：必须通过 Google Search 寻找一个关于该题目知识点的真实、可直接打开的 HTTPS 链接。**
    `,
    config: {
      thinkingConfig: { thinkingBudget: 4000 },
      tools: [{googleSearch: {}}],
      systemInstruction: `你是一位资深教师。请诊断学生错误并提供教材参考。
1. **禁止虚构协议**：绝对禁止返回以 "textbook://" 或其他非标准协议开头的链接。
2. **强制标准协议**：返回的 uri 必须以 "https://" 开头，且必须能在普通浏览器中直接打开。
3. **搜索优先级**：优先链接至国家中小学智慧教育平台(zxx.edu.cn)的具体课程页面；如果找不到，请链接至该知识点对应的“百度百科”或“维基百科”词条。
4. **禁止加粗**：不要使用 ** 符号。`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          userStepsAnalysis: { type: Type.STRING },
          discrepancies: { type: Type.ARRAY, items: { type: Type.STRING } },
          weakPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
          textbookReference: {
            type: Type.OBJECT,
            properties: {
              textbook: { type: Type.STRING },
              chapter: { type: Type.STRING },
              section: { type: Type.STRING },
              path: { type: Type.STRING },
              uri: { type: Type.STRING, description: "必须是以 https:// 开头的真实有效网址" }
            },
            required: ["textbook", "chapter", "section", "path", "uri"]
          }
        },
        required: ["userStepsAnalysis", "discrepancies", "weakPoints", "textbookReference"]
      }
    }
  });

  return JSON.parse(response.text || '{}');
};

/**
 * 针对性练习生成
 */
export const generatePractice = async (weakPoints: string[], problem: ProblemAnalysis): Promise<PracticeQuestion[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `基于知识点：${weakPoints.join(', ')}。生成 3 道变式练习。禁止使用 $ 符号。`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING },
            solution: { type: Type.ARRAY, items: { type: Type.STRING } },
            answer: { type: Type.STRING },
            difficulty: { type: Type.STRING, enum: ["基础", "中等", "困难"] }
          },
          required: ["question", "solution", "answer", "difficulty"]
        }
      }
    }
  });

  return JSON.parse(response.text || '[]');
};

export const generateExplanationAudio = async (text: string): Promise<Uint8Array> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `请用老师语气讲解：${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("语音生成失败");
  
  const binaryString = atob(base64Audio);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

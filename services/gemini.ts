
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ProblemAnalysis, ComparisonResult, PracticeQuestion } from "../types";

/**
 * 图像识别逻辑 - 支持多张图片并行识别与整合
 */
export const analyzeImage = async (images: string[]): Promise<ProblemAnalysis> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // 构建多部分内容，包括所有图片和提示词
  const imageParts = images.map(base64 => ({
    inlineData: { data: base64, mimeType: 'image/jpeg' }
  }));

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        ...imageParts,
        { text: "以上是一道题目的多张拆解图片。请你识别所有图片内容，分析它们之间的逻辑关系（如：图1是题干，图2是配图），并将它们整合为一道完整的题目进行分步解答。注意：禁止使用 $ 符号或 Markdown 数学定界符。使用易读的文本表达。" }
      ]
    },
    config: {
      systemInstruction: `你是一位全能教育专家。
1. **多图合成**：你需要将多张图片中的文字和图像信息合成为一个连贯的题目描述。
2. **规范输出**：禁止使用 $ 符号包裹变量。
3. **结构化解答**：提供标准步骤。
4. **输出格式**：严格执行 JSON。禁止在字段内使用 ** 等 Markdown 加粗格式。`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          originalText: { type: Type.STRING, description: "整合后的完整题目文本描述" },
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
    throw new Error("多图识别解析失败，请确保图片清晰且内容完整。");
  }
};

/**
 * 差异化思路分析逻辑 - 使用 Google Search 寻找参考链接
 */
export const compareSteps = async (
  problem: ProblemAnalysis,
  userSteps: string
): Promise<ComparisonResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // 重要：使用 googleSearch 时，建议不要强制 JSON 输出，且必须手动提取 groundingChunks
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `
      【题目】：${problem.originalText}
      【标准解法】：${problem.standardSolution.join(' -> ')}
      【学生思路】：${userSteps}
      请比对学生解题思路与标准解法的差异，并给出诊断分析。
      要求：
      1. 分析学生在逻辑上的偏差或盲区。
      2. 指出需要巩固的知识点。
      3. 必须通过 Google Search 寻找一个关于该题目知识点的真实、可直接打开的 HTTPS 链接。
    `,
    config: {
      thinkingConfig: { thinkingBudget: 4000 },
      tools: [{googleSearch: {}}],
      systemInstruction: "你是一位资深教师。请诊断学生错误并提供教材参考。返回结果必须包含文字分析和建议。参考链接必须为 HTTPS 协议，优先链接至国家中小学智慧教育平台(zxx.edu.cn)；其次百度百科。不要使用 ** 符号加粗文本。"
    }
  });

  // 提取 groundingChunks 中的 URL
  const groundingUrls: { title: string; uri: string }[] = [];
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (chunks) {
    chunks.forEach((chunk: any) => {
      if (chunk.web && chunk.web.uri) {
        groundingUrls.push({
          title: chunk.web.title || "相关学习链接",
          uri: chunk.web.uri
        });
      }
    });
  }

  // 由于不使用 JSON 模式（遵循 googleSearch 规则），将文本整体作为分析结果
  return {
    userStepsAnalysis: response.text || "未能生成详细分析",
    discrepancies: ["请查看下方的详细文字诊断"],
    weakPoints: problem.keyKnowledgePoints,
    groundingUrls: groundingUrls
  };
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

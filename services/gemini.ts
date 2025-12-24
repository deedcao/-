
import { GoogleGenAI, Type, Modality, GenerateContentResponse } from "@google/genai";
import { ProblemAnalysis, ComparisonResult, PracticeQuestion } from "../types";

/**
 * 核心绘图重构生成器
 * @param prompt 绘图文字描述
 * @param sourceImageBase64 可选：原题参考图的 Base64 数据
 * @param correctionFeedback 可选：来自校验步骤的修正意见
 */
const generateReconstructedDiagram = async (prompt: string, sourceImageBase64?: string, correctionFeedback?: string): Promise<string | undefined> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const instruction = `你是一位教材级别的专业几何绘图专家。
  任务：根据提供的题目文本${sourceImageBase64 ? '和【原始参考图】' : ''}，绘制一张标准、清晰的数字化示意图。
  
  要求：
  1. ${sourceImageBase64 ? '必须严格参考【原始参考图】中的构图布局和标注位置。' : '根据题目描述的几何逻辑进行严密构图。'}
  2. 风格：白底黑线，简约矢量风格。
  3. 标注：仅保留 A, B, C, O 等关键标识，严禁乱码。
  ${correctionFeedback ? `4. 特别注意修正上个版本的错误：${correctionFeedback}` : ''}
  
  题目内容：${prompt}`;

  const parts: any[] = [{ text: instruction }];
  if (sourceImageBase64) {
    parts.unshift({
      inlineData: { data: sourceImageBase64, mimeType: 'image/jpeg' }
    });
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview', 
      contents: { parts },
      config: {
        imageConfig: { aspectRatio: "16:9", imageSize: "1K" }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    }
  } catch (e) {
    console.error("绘图生成失败:", e);
  }
  return undefined;
};

/**
 * 图像逻辑校验器：对比图片与题意是否吻合
 */
const verifyDiagramAccuracy = async (question: string, diagramBase64: string): Promise<{ isAccurate: boolean; feedback: string }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const base64Data = diagramBase64.split(',')[1] || diagramBase64;
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { data: base64Data, mimeType: 'image/png' } },
          { text: `请作为几何老师校验这张图是否准确表达了以下题目的意思。
          题目：${question}
          校验点：
          1. 字母标注位置是否正确？
          2. 几何关系（垂直、平行、平分）是否在视觉上成立？
          3. 是否存在乱码或模糊不清的地方？
          请以 JSON 格式回复：{"isAccurate": boolean, "feedback": "如果不准确，请指出具体哪里错了"}` }
        ]
      },
      config: { responseMimeType: "application/json" }
    });
    
    return JSON.parse(response.text || '{"isAccurate": true, "feedback": ""}');
  } catch (e) {
    return { isAccurate: true, feedback: "" }; // 降级处理
  }
};

/**
 * 题目分析主逻辑
 */
export const analyzeImage = async (images: string[]): Promise<ProblemAnalysis> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const imageParts = images.map(base64 => ({
    inlineData: { data: base64, mimeType: 'image/jpeg' }
  }));

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        ...imageParts,
        { text: "请精准识别题目并分析其核心考点。特别关注几何图形的文字描述（diagramDescription）。" }
      ]
    },
    config: {
      systemInstruction: "你是一位资深教师，擅长将模糊的题目照片重构为结构化的教学内容。",
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
          problemType: { type: Type.STRING },
          diagramDescription: { type: Type.STRING }
        },
        required: ["originalText", "subject", "grade", "standardSolution", "finalAnswer", "keyKnowledgePoints", "problemType", "diagramDescription"]
      }
    }
  });

  const result = JSON.parse(response.text || '{}');
  const originalImage = images[0];
  
  // 初始绘制（结合原图和文字）
  result.diagram = await generateReconstructedDiagram(
    `${result.originalText}。补充绘图信息：${result.diagramDescription}`, 
    originalImage
  );
  
  result.sourceImage = `data:image/jpeg;base64,${originalImage}`;
  return result;
};

export const compareSteps = async (problem: ProblemAnalysis, userSteps: string): Promise<ComparisonResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `题目：${problem.originalText}\n标准答案：${problem.finalAnswer}\n学生思路：${userSteps}`,
    config: { systemInstruction: "你是一位有耐心的导师，请分析学生的思路。" }
  });
  return {
    userStepsAnalysis: response.text || "解析生成失败。",
    discrepancies: [],
    weakPoints: problem.keyKnowledgePoints
  };
};

/**
 * 变式生成逻辑（包含“生成-校验-修正”闭环）
 */
export const generatePractice = async (weakPoints: string[], problem: ProblemAnalysis): Promise<PracticeQuestion[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `基于知识点：${weakPoints.join(',')}，生成3道同类型练习题。`,
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
            difficulty: { type: Type.STRING }
          }
        }
      }
    }
  });

  const questions: PracticeQuestion[] = JSON.parse(response.text || '[]');
  
  // 对每道变式题执行重绘与闭环校验
  for (const q of questions) {
    // 1. 初次绘图
    let diagram = await generateReconstructedDiagram(q.question);
    
    if (diagram) {
      // 2. AI 自动逻辑校验
      const check = await verifyDiagramAccuracy(q.question, diagram);
      
      // 3. 如果不准确，尝试携带反馈重绘一次
      if (!check.isAccurate) {
        console.log(`变式题图形校验未通过: ${check.feedback}，正在重绘...`);
        const correctedDiagram = await generateReconstructedDiagram(q.question, undefined, check.feedback);
        if (correctedDiagram) diagram = correctedDiagram;
      }
    }
    
    q.diagram = diagram;
  }
  
  return questions;
};

export const generateExplanationAudio = async (text: string): Promise<Uint8Array> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `好的，我来讲解一下这道题：${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
    },
  });
  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  const binaryString = atob(base64Audio!);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
};

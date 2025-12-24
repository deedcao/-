
import { GoogleGenAI, Type, Modality, GenerateContentResponse } from "@google/genai";
import { ProblemAnalysis, ComparisonResult, PracticeQuestion, Subject } from "../types";

/**
 * 核心绘图重构生成器
 */
const generateReconstructedDiagram = async (prompt: string, sourceImageBase64?: string, correctionFeedback?: string): Promise<string | undefined> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const instruction = `你是一位教材级别的专业几何绘图与科学图表专家。
  任务：根据提供的题目文本${sourceImageBase64 ? '和【原始参考图】' : ''}，绘制一张标准、清晰的数字化示意图。
  
  要求：
  1. 风格：白底黑线，简约矢量风格。
  2. 标注：保留关键标识（如点、力 F、化学键等），严禁乱码。
  ${correctionFeedback ? `3. 修正建议：${correctionFeedback}` : ''}
  
  内容：${prompt}`;

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
 * 图像逻辑校验器
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
          { text: `请校验这张图是否准确表达了题目意思。
          题目：${question}
          JSON格式回复：{"isAccurate": boolean, "feedback": "string"}` }
        ]
      },
      config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text || '{"isAccurate": true, "feedback": ""}');
  } catch (e) {
    return { isAccurate: true, feedback: "" };
  }
};

/**
 * 题目分析主逻辑：增加学科权重
 */
export const analyzeImage = async (images: string[], preferredSubject: Subject = 'Auto'): Promise<ProblemAnalysis> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const imageParts = images.map(base64 => ({
    inlineData: { data: base64, mimeType: 'image/jpeg' }
  }));

  const subjectPrompt = preferredSubject === 'Auto' 
    ? "请首先识别题目所属学科（数学、物理、化学、生物或英语）。"
    : `本题已知学科为：${preferredSubject}，请专注于该领域的专业术语识别和逻辑分析。`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        ...imageParts,
        { text: `${subjectPrompt} 请精准识别题目，分析考点，并提供图解描述。` }
      ]
    },
    config: {
      systemInstruction: `你是一位全科特级教师。
      1. 如果是数学题，侧重几何逻辑和计算步骤。
      2. 如果是物理题，侧重受力分析、运动状态和物理模型。
      3. 如果是化学题，确保化学方程式、结构式识别准确。
      4. 如果是英语题，侧重语法点和语境分析。
      5. 在 diagramDescription 中描述用于绘图重构的关键视觉信息。`,
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
    contents: `题目：${problem.originalText}\n标准答案：${problem.finalAnswer}\n学生思路：${userSteps}\n学科背景：${problem.subject}`,
    config: { systemInstruction: `你是一位专业的${problem.subject}导师。请用专业视角分析学生的思路错误。` }
  });
  return {
    userStepsAnalysis: response.text || "解析生成失败。",
    discrepancies: [],
    weakPoints: problem.keyKnowledgePoints
  };
};

export const generatePractice = async (weakPoints: string[], problem: ProblemAnalysis): Promise<PracticeQuestion[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `基于${problem.subject}学科的考点：${weakPoints.join(',')}，生成3道同类型练习题。`,
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
  
  for (const q of questions) {
    let diagram = await generateReconstructedDiagram(q.question);
    if (diagram) {
      const check = await verifyDiagramAccuracy(q.question, diagram);
      if (!check.isAccurate) {
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

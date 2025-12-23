
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ProblemAnalysis, ComparisonResult, PracticeQuestion } from "../types";

/**
 * 绘图指令优化：不仅保留标识，还需体现物理参数（如比例关系）
 */
const generateDiagram = async (description: string, type: 'magic_square' | 'geometry' | 'physics' | 'general'): Promise<string | undefined> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  let prompt = "";
  if (type === 'magic_square') {
    prompt = `绘制一个整洁的 3x3 方格矩阵。要求：1. 图片内严禁出现任何多余文字或乱码。2. 仅绘制纯净的黑色方框线条。3. 背景纯白。`;
  } else if (type === 'physics') {
    prompt = `绘制一张专业的物理实验原理图，精确匹配以下描述：${description}。
关键视觉要求：
1. 【尺寸比例】：绘制三个垂直排列的圆柱形容器（甲、乙、丙）。中间容器“乙”的底面宽度（直径）必须明显大于两侧容器“甲”和“丙”，具体比例为：乙的宽度是甲和丙的2倍（体现半径比1:2:1）。
2. 【连通结构】：在容器高度约1/3处（10cm处）有两根水平细管将甲乙、乙丙连通。
3. 【清晰标识】：在左侧容器正上方标注汉字“甲”，中间容器正上方标注汉字“乙”，右侧容器正上方标注汉字“丙”。字体需为标准黑色简体。
4. 【水位细节】：乙容器内绘有浅蓝色水面，初始高度较低（4cm，低于连通管）。甲和丙初始为空。
5. 【风格要求】：白底黑线，教科书式制图，严禁任何多余的乱码、虚假数字或艺术化装饰。
6. 确保三个容器底座在同一水平线上。`;
  } else {
    prompt = `绘制一张专业的科学示意图：${description}。要求：1. 比例准确。2. 包含必要的简体中文标识（甲, 乙, 丙）。3. 文字清晰无乱码。4. 背景纯白。`;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview', 
      contents: {
        parts: [{ text: prompt }],
      },
      config: {
        imageConfig: {
          aspectRatio: "16:9",
          imageSize: "1K"
        }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
  } catch (e) {
    console.error("Pro绘图失败，尝试回退模型", e);
    try {
       const responseFlash = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ text: prompt }] },
      });
      for (const part of responseFlash.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
      }
    } catch(e2) {
      console.error("所有绘图尝试均失败", e2);
    }
  }
  return undefined;
};

/**
 * 核心识别逻辑
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
        { text: "请精准识别题目并重构。特别注意题目中的物理量：如底面半径之比、连通管高度、注水速率等。修正所有 OCR 识别文字错误。" }
      ]
    },
    config: {
      systemInstruction: `你是一位极度严谨的物理特级教师。
1. **参数提取**：必须精准捕捉“底面半径之比为1:2:1”这一关键条件，这意味着底面积之比为1:4:1。
2. **逻辑纠错**：图片中的 OCR 可能将比例 1:2:1 误识别。请结合上下文物理逻辑（如注水上升高度关系）进行校验。
3. **输出要求**：originalText 必须包含完整的、无错别字的题目原文。problemType 设置为 'physics'。`,
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
          gridData: { 
            type: Type.ARRAY, 
            nullable: true,
            items: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING, nullable: true } 
            } 
          }
        },
        required: ["originalText", "subject", "grade", "standardSolution", "finalAnswer", "keyKnowledgePoints", "problemType"]
      }
    }
  });

  const result = JSON.parse(response.text || '{}');
  result.diagram = await generateDiagram(result.originalText, result.problemType);
  return result;
};

/**
 * 逻辑诊断逻辑：增加回退机制
 */
export const compareSteps = async (problem: ProblemAnalysis, userSteps: string): Promise<ComparisonResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `题目：${problem.originalText}\n标准答案：${problem.finalAnswer}\n学生思路：${userSteps}\n请分析学生是否正确计算了容器截面积之比（半径平方比），以及是否考虑了连通管高度限制。`;
  const systemInstruction = "你是一位物理老师。请用简体中文进行严密的逻辑分析。指出学生在处理比例关系或物理过程分段（水流前/水流后）时的错误。禁止使用 ** 加粗。";

  try {
    // 优先尝试 Pro 模型
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: prompt,
      config: { systemInstruction }
    });
    return {
      userStepsAnalysis: response.text || "未能生成分析。",
      discrepancies: [],
      weakPoints: problem.keyKnowledgePoints
    };
  } catch (err: any) {
    console.warn("Gemini 3 Pro 诊断失败，正在尝试 Flash 模型回退...", err);
    // 检查是否是由于 API Key 导致的问题
    if (err.message?.includes("Requested entity was not found") || err.message?.includes("404")) {
      throw new Error("PRO_MODEL_NOT_FOUND");
    }
    
    // 回退到 Flash 模型
    try {
      const responseFlash = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: { systemInstruction }
      });
      return {
        userStepsAnalysis: responseFlash.text || "诊断生成异常。",
        discrepancies: [],
        weakPoints: problem.keyKnowledgePoints
      };
    } catch (e2) {
      console.error("所有诊断尝试均失败", e2);
      throw e2;
    }
  }
};

export const generatePractice = async (weakPoints: string[], problem: ProblemAnalysis): Promise<PracticeQuestion[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `基于知识点：${weakPoints.join(',')}，生成3道考察“连通器原理”、“底面积比例”或“动态液面平衡”的变式题。类型必须是：${problem.problemType}。`,
    config: {
      systemInstruction: `你现在是一位负责任的名师。生成的练习题解析必须极度详尽，包括：
1. **解题突破口**：指出题目中最核心的物理模型（如：液面在达到管道高度前的独立性）。
2. **分步详析**：
   - 步骤1：列出初始参数（底面积比 S甲:S乙:S丙 = R甲²:R乙²:R丙²）。
   - 步骤2：分析液面上升的临界状态（如：液面何时开始流向其他容器）。
   - 步骤3：计算最终量化关系。
3. **陷阱警示**：提醒学生不要忽视半径与面积的平方比关系。
4. **注意**：solution 数组的每一项都应该是一个完整的逻辑段落。`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING },
            solution: { type: Type.ARRAY, items: { type: Type.STRING } },
            answer: { type: Type.STRING },
            difficulty: { type: Type.STRING },
            problemType: { type: Type.STRING },
            gridData: { type: Type.ARRAY, nullable: true, items: { type: Type.ARRAY, items: { type: Type.STRING, nullable: true } } }
          }
        }
      }
    }
  });
  const questions = JSON.parse(response.text || '[]');
  for (const q of questions) {
    q.diagram = await generateDiagram(q.question, q.problemType);
  }
  return questions;
};

export const generateExplanationAudio = async (text: string): Promise<Uint8Array> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `好的，关于这道考查连通器和面积比例的物理题，我来讲解一下：${text}` }] }],
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

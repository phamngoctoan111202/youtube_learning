import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is not defined in .env");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function run() {
  const videoId = "1X3MQFsGCd4";
  console.log(`Asking Gemini (gemini-2.0-flash) to retrieve transcripts for video: ${videoId}...`);
  
  const prompt = `Bạn là trợ lý AI cao cấp tích hợp Google Search. Hãy tìm và trích xuất phụ đề (transcript) của video YouTube có ID: "${videoId}".
Tên video: "Món Bánh Mì Việt Nam" hoặc bất kỳ phụ đề tiếng Việt hay tiếng Anh nào sẵn có cho video này.
Bạn có thể tìm kiếm dữ liệu trên web. Hãy cố gắng trả về danh sách đầy đủ phụ đề thô của video này.
Định dạng trả về là một mảng JSON các đối tượng có cấu trúc:
{
  "text": "nội dung câu nói",
  "start": 12.3, // thời gian bắt đầu nói (giây, kiểu số thực)
  "duration": 3.5 // thời lượng câu nói (giây, kiểu số thực)
}

Hãy trả về chính xác tuyệt đối mảng JSON. Nếu không tìm thấy, hãy giải thích rõ lỗi.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: {
        // Enable Google Search grounding
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              start: { type: Type.NUMBER },
              duration: { type: Type.NUMBER }
            },
            required: ["text", "start", "duration"]
          }
        }
      }
    });
    
    const text = response.text;
    console.log("Success! Gemini response text length:", text?.length);
    console.log("Gemini response (first 1000 chars):", text?.substring(0, 1000));
    
    if (response.candidates?.[0]?.groundingMetadata) {
      console.log("\nGrounding Metadata Sources:");
      const sources = response.candidates[0].groundingMetadata.groundingChunks || [];
      sources.forEach((chunk, i) => {
        console.log(`[${i+1}] ${chunk.web?.uri} - ${chunk.web?.title}`);
      });
    }
  } catch (err) {
    console.error("Gemini Error:", err.message);
  }
}

run().catch(console.error);

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Initialize Gemini SDK with single unique log key for debugging connection issues
const LOG_KEY = "[GEMINI_DEBUG]";
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn(`${LOG_KEY} WARNING: GEMINI_API_KEY is NOT set in environment variables (process.env.GEMINI_API_KEY is undefined or empty). Gemini features will be disabled or fall back to local mode.`);
} else {
  const maskedKey = apiKey.length > 10 ? `${apiKey.substring(0, 6)}...${apiKey.slice(-4)}` : "***";
  console.log(`${LOG_KEY} GEMINI_API_KEY detected (Length: ${apiKey.length}, Masked: ${maskedKey}). Initializing GoogleGenAI client.`);
}

const ai = apiKey
  ? new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    })
  : null;

// Diagnostic endpoint to test Gemini API connection with [GEMINI_DEBUG] key
app.get("/api/test-gemini", async (req, res) => {
  console.log(`${LOG_KEY} GET /api/test-gemini requested.`);

  if (!apiKey) {
    console.error(`${LOG_KEY} Test Failed: GEMINI_API_KEY is not defined in process.env.`);
    res.status(500).json({
      success: false,
      logKey: LOG_KEY,
      error: "GEMINI_API_KEY is not defined in process.env.",
    });
    return;
  }

  if (!ai) {
    console.error(`${LOG_KEY} Test Failed: GoogleGenAI instance is null.`);
    res.status(500).json({
      success: false,
      logKey: LOG_KEY,
      error: "GoogleGenAI instance is null.",
    });
    return;
  }

  const maskedKey = apiKey.length > 10 ? `${apiKey.substring(0, 6)}...${apiKey.slice(-4)}` : "***";
  console.log(`${LOG_KEY} Testing connection with model gemini-2.0-flash using key (${maskedKey})...`);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: "Hello Gemini! Respond with 'CONNECTION_OK' if you can read this.",
    });

    const reply = response.text?.trim() || "No text returned";
    console.log(`${LOG_KEY} Test SUCCESS! Response from Gemini: "${reply}"`);

    res.json({
      success: true,
      logKey: LOG_KEY,
      maskedApiKey: maskedKey,
      response: reply,
    });
  } catch (err: any) {
    console.error(`${LOG_KEY} Test FAILED! Exception caught:`, {
      message: err.message,
      status: err.status,
      code: err.code,
      stack: err.stack,
    });

    res.status(500).json({
      success: false,
      logKey: LOG_KEY,
      maskedApiKey: maskedKey,
      error: err.message || String(err),
      status: err.status,
      code: err.code,
      details: err.stack,
    });
  }
});

// Utility functions for YouTube processing
function extractVideoId(url: string): string | null {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

function cleanXmlText(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x60;/g, "`")
    .replace(/&#x3D;/g, "=")
    .replace(/\s+/g, " ")
    .trim();
}

function parseXmlTranscript(xml: string): Array<{ text: string; start: number; duration: number }> {
  const result: Array<{ text: string; start: number; duration: number }> = [];
  const textRegex = /<text([^>]*)>([\s\S]*?)<\/text>/gi;
  let textMatch;
  while ((textMatch = textRegex.exec(xml)) !== null) {
    const attrsStr = textMatch[1];
    const textContent = textMatch[2];

    const startMatch = /start="([\d.]+)"/.exec(attrsStr);
    const durMatch = /dur="([\d.]+)"/.exec(attrsStr);

    const start = startMatch ? parseFloat(startMatch[1]) : 0;
    const duration = durMatch ? parseFloat(durMatch[1]) : 2;
    const text = cleanXmlText(textContent);

    if (text && text !== "[âm nhạc]" && text !== "[Music]") {
      result.push({ text, start, duration });
    }
  }
  return result;
}

function extractCaptionTracks(html: string): any[] | null {
  const match = html.match(/"captionTracks":\s*(\[.*?\])/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    const startIndex = html.indexOf('"captionTracks":');
    if (startIndex === -1) return null;
    let bracketCount = 0;
    let foundStart = false;
    let arrString = "";
    for (let i = startIndex; i < html.length; i++) {
      if (html[i] === "[") {
        bracketCount++;
        foundStart = true;
      }
      if (foundStart) {
        arrString += html[i];
      }
      if (html[i] === "]") {
        bracketCount--;
        if (bracketCount === 0 && foundStart) {
          break;
        }
      }
    }
    try {
      return JSON.parse(arrString);
    } catch (err) {
      console.error("Failed to parse extracted caption track JSON:", err);
      return null;
    }
  }
}

// REST API Endpoints
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", geminiConfigured: !!ai });
});

// Endpoint to fetch video details and segment transcript
app.post("/api/transcript", async (req, res) => {
  try {
    const { url, html: userHtml, rawText: userRawText } = req.body;
    if (!url) {
       res.status(400).json({ error: "Vui lòng cung cấp URL video YouTube" });
       return;
    }

    let videoId = extractVideoId(url);
    if (!videoId && url.trim().length === 11) {
      videoId = url.trim();
    }

    if (!videoId) {
       res.status(400).json({ error: "URL YouTube không hợp lệ" });
       return;
    }

    // 1. Fetch Video Metadata via oEmbed (very safe, reliable, no API key required)
    let videoTitle = "Video YouTube";
    let authorName = "Kênh YouTube";
    let thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    try {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
      );
      if (oembedRes.ok) {
        const metadata = await oembedRes.json();
        videoTitle = metadata.title || videoTitle;
        authorName = metadata.author_name || authorName;
        thumbnailUrl = metadata.thumbnail_url || thumbnailUrl;
      }
    } catch (metadataError) {
      console.warn("Failed to fetch oEmbed metadata:", metadataError);
    }

    // A. Handle user-provided RAW TEXT transcript directly if specified
    if (userRawText && userRawText.trim()) {
      const isTimestampedFormat = /^\s*\(\d+:\d+(?::\d+)?\s*-\s*\d+:\d+(?::\d+)?\):\s*.+/m.test(userRawText);
      
      if (isTimestampedFormat) {
        console.log("Detected timestamped format in user raw text. Parsing directly...");
        const lines = userRawText.split('\n');
        const sentences = [];
        let id = 1;
        const regex = /^\s*\(([^)]+)\):\s*(.+)$/;

        const parseTimestampToSeconds = (ts: string): number => {
          const parts = ts.trim().split(":").map(Number);
          if (parts.length === 2) {
            return parts[0] * 60 + parts[1];
          } else if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
          }
          return 0;
        };

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const match = regex.exec(trimmed);
          if (match) {
            const timeRange = match[1];
            const rawContent = match[2].trim();
            const timeParts = timeRange.split("-");

            let sentenceText = rawContent;
            let vietnameseText = "";

            if (rawContent.includes("|")) {
              const parts = rawContent.split("|");
              sentenceText = parts[0].trim();
              vietnameseText = parts.slice(1).join("|").replace(/^Dịch:\s*/i, "").trim();
            } else if (/\(Dịch:\s*/i.test(rawContent)) {
              const vMatch = rawContent.match(/^(.*?)\s*\(Dịch:\s*(.*?)\)$/i);
              if (vMatch) {
                sentenceText = vMatch[1].trim();
                vietnameseText = vMatch[2].trim();
              }
            }

            if (timeParts.length === 2) {
              const start = parseTimestampToSeconds(timeParts[0]);
              const end = parseTimestampToSeconds(timeParts[1]);
              sentences.push({
                id: id++,
                sentence: sentenceText,
                start,
                end,
                ...(vietnameseText ? { vietnamese: vietnameseText } : {})
              });
            }
          }
        }

        if (sentences.length > 0) {
          res.json({
            videoId,
            title: videoTitle,
            author: authorName,
            thumbnailUrl,
            language: "en",
            sentences: sentences,
            geminiEnhanced: false,
            isRestored: false,
            isManualText: true
          });
          return;
        }
      }

      if (!ai) {
        res.status(400).json({ error: "Không thể tự động phân đoạn văn bản phụ đề do thiếu cấu hình Gemini API Key." });
        return;
      }
      console.log("Using user-provided raw text transcript...");
      try {
        const prompt = `Bạn là một chuyên gia ngôn ngữ học tiếng Anh và trợ lý giảng dạy xuất sắc. Dưới đây là phụ đề thô dạng văn bản được người dùng sao chép thủ công.
Hãy thực hiện việc phân đoạn câu, sửa lỗi viết hoa, dấu câu cho các đoạn phụ đề thô dưới đây.

Quy tắc quan trọng:
1. CHIA NHỎ CÂU: Mỗi phân đoạn CHỈ NÊN DÀI TỪ 3 ĐẾN 8 GIÂY (tối đa 6 - 12 từ). NẾU CÂU QUÁ DÀI hoặc là câu ghép chứa các mệnh đề nối như "where", "and", "but", "so", "because", "when", v.v. -> BẮT BUỘC TÁCH THÀNH CÁC MỆNH ĐỀ NHỎ RIÊNG BIỆT để người học dễ tập viết.
2. PHẢI PHỦ TOÀN BỘ THỜI LƯỢNG VIDEO & KHÔNG ĐƯỢC CẮT BỎ ĐOẠN LẶP LẠI:
   - NẾU LÀ BÀI HÁT HOẶC VIDEO CÓ CÁC ĐOẠN LẶP LẠI (điệp khúc, điệp từ, verse 2, chorus 2, outro...): TUYỆT ĐỐI KHÔNG ĐƯỢC cắt bỏ hay dừng sớm ở lần lặp 1 (ví dụ: video 4 phút thì KHÔNG được tự ý dừng ở 1:46).
   - BẮT BUỘC phân đoạn toàn bộ lời hát/lời thoại kéo dài liên tục từ đầu (0:00) cho tới CUỐI VIDEO.
   - Chỉ bỏ các đoạn hoàn toàn là nhạc không lời (instrumental breaks) không có tiếng hát/tiếng nói.
3. MỐC THỜI GIAN CHÍNH XÁC CHUẨN TỪNG MILI GIÂY (DECIMAL):
   - Mốc thời gian "start" và "end" (giây) BẮT BUỘC PHẢI CHUẨN XÁC ĐẾN TỪNG MILI GIÂY (dạng số thực thập phân, ví dụ: 10.45, 14.82, 19.12...), TUYỆT ĐỐI KHÔNG ĐƯỢC làm tròn thành số nguyên hoặc tròn giây .00 (như 10.00 hay 15.00) để audio phát khớp từng mili giây.
   - Nếu dữ liệu phụ đề thô ĐÃ CÓ SẴN mốc thời gian, hãy trích xuất và BẮT BUỘC SỬ DỤNG CHÍNH XÁC mốc thời gian lẻ tương ứng.
4. KHÔNG DỊCH SANG TIẾNG VIỆT, giữ nguyên tiếng Anh gốc (chỉ thêm dấu câu thích hợp và viết hoa chữ cái đầu câu).
5. KHÔNG ĐƯỢC tự ý thêm bớt hay thay đổi từ ngữ nào trong lời thoại gốc để giữ tính chính xác của bài nghe chính tả.

Ví dụ định dạng phân đoạn chuẩn:
(0:10.45 - 0:18.12): I just woke up from my dream where you and I had to say goodbye
(0:18.12 - 0:23.50): and I don't know what it all means
(0:23.50 - 0:28.05): but since I survived I realized

Dữ liệu phụ đề thô:
${userRawText}

Hãy phân tích kỹ lưỡng và trả về danh sách các câu đã phân đoạn chính xác theo cấu trúc định dạng JSON.`;

        const response = await ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              description: "Danh sách các câu đã được phân đoạn hoàn chỉnh",
              items: {
                type: Type.OBJECT,
                properties: {
                  sentence: {
                    type: Type.STRING,
                    description: "Câu thoại hoàn chỉnh, viết hoa đầu dòng và có dấu câu phù hợp.",
                  },
                  vietnamese: {
                    type: Type.STRING,
                    description: "Bản dịch nghĩa tiếng Việt chuẩn xác và tự nhiên của câu.",
                  },
                  start: {
                    type: Type.NUMBER,
                    description: "Thời gian bắt đầu câu nói (giây), ước lượng tăng dần liên tục.",
                  },
                  end: {
                    type: Type.NUMBER,
                    description: "Thời gian kết thúc câu nói (giây), bằng thời gian bắt đầu câu tiếp theo.",
                  },
                },
                required: ["sentence", "start", "end"],
              },
            },
          },
        });

        const text = response.text;
        if (!text) {
          throw new Error("Gemini returned empty text during raw text processing");
        }

        const parsed = JSON.parse(text);
        const finalSentences = parsed.map((s: any, idx: number) => ({
          id: idx + 1,
          sentence: s.sentence.trim(),
          start: Number(Number(s.start).toFixed(2)),
          end: Number(Number(s.end).toFixed(2))
        }));

        res.json({
          videoId,
          title: videoTitle,
          author: authorName,
          thumbnailUrl,
          language: "en",
          sentences: finalSentences,
          geminiEnhanced: true,
          isRestored: false,
          isManualText: true
        });
        return;
      } catch (err: any) {
        console.error("Error parsing user raw text:", err);
        res.status(500).json({ error: `Không thể xử lý phụ đề dạng văn bản của bạn: ${err.message || err}` });
        return;
      }
    }

    // B. Handle watch page retrieval (Fetch or parse user-provided HTML)
    let captionTracks = null;
    let watchSuccess = false;
    let selectedLanguage = "en";

    if (userHtml && userHtml.trim()) {
      console.log("Using user-provided YouTube watch page HTML...");
      captionTracks = extractCaptionTracks(userHtml);
      if (captionTracks && captionTracks.length > 0) {
        watchSuccess = true;
      } else {
        res.status(400).json({
          error: "Không thể tìm thấy thông tin phụ đề trong đoạn mã nguồn HTML bạn đã dán. Hãy đảm bảo bạn đã mở đúng trang xem video chính thức trên YouTube (không phải Shorts hay danh sách phát), nhấn Ctrl+U và sao chép toàn bộ mã nguồn."
        });
        return;
      }
    } else {
      try {
        const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const watchResponse = await fetch(watchUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
          },
        });

        if (watchResponse.ok) {
          const html = await watchResponse.text();
          captionTracks = extractCaptionTracks(html);
          if (captionTracks && captionTracks.length > 0) {
            watchSuccess = true;
          }
        }
      } catch (e) {
        console.warn("Failed to fetch/parse watch page:", e);
      }
    }

    if (watchSuccess && captionTracks && captionTracks.length > 0) {
      // Prioritize Vietnamese (vi) first, then English (en), then whatever language is first
      let selectedTrack = captionTracks.find((track) => track.languageCode === "vi");
      if (!selectedTrack) {
        selectedTrack = captionTracks.find((track) => track.languageCode === "en");
      }
      if (!selectedTrack) {
        selectedTrack = captionTracks[0];
      }

      selectedLanguage = selectedTrack.languageCode;

      try {
        const transcriptUrl = selectedTrack.baseUrl;
        const transcriptRes = await fetch(transcriptUrl);
        if (transcriptRes.ok) {
          const transcriptXml = await transcriptRes.text();
          const rawSegments = parseXmlTranscript(transcriptXml);

          if (rawSegments.length > 0) {
            // Proceed to standard Gemini segmentation if AI is configured, else basic mapping
            if (ai) {
              // Chunk transcription to prevent hitting token limits and make request faster
              const chunkSize = 50;
              const chunks: Array<typeof rawSegments> = [];
              for (let i = 0; i < rawSegments.length; i += chunkSize) {
                chunks.push(rawSegments.slice(i, i + chunkSize));
              }

              const segmentPromises = chunks.map(async (chunk, chunkIdx) => {
                try {
                  const prompt = `Bạn là một chuyên gia ngôn ngữ học và trợ lý nghe chép chính tả xuất sắc. Hãy thực hiện việc phân đoạn câu và sửa lỗi viết hoa, dấu câu cho các phân đoạn phụ đề thô của YouTube dưới đây.

Quy tắc quan trọng:
1. CHIA NHỎ CÂU: Mỗi phân đoạn CHỈ NÊN DÀI TỪ 3 ĐẾN 8 GIÂY (tối đa 6 - 12 từ). NẾU CÂU QUÁ DÀI hoặc là câu ghép chứa các mệnh đề nối như "where", "and", "but", "so", "because", "when", v.v. -> BẮT BUỘC TÁCH THÀNH CÁC MỆNH ĐỀ NHỎ RIÊNG BIỆT để người học dễ tập viết.
2. PHẢI PHỦ TOÀN BỘ THỜI LƯỢNG VIDEO & KHÔNG ĐƯỢC CẮT BỎ ĐOẠN LẶP LẠI:
   - Xử lý ĐẦY ĐỦ 100% tất cả các phân đoạn phụ đề được cung cấp trong JSON từ đầu cho đến phân đoạn cuối cùng.
   - TUYỆT ĐỐI KHÔNG ĐƯỢC dừng sớm ở lần lặp 1 hay cắt ngắn bài hát/video (ví dụ: video/bài hát 4 phút KHÔNG được tự ý dừng ở 1:46). BẮT BUỘC phân đoạn đầy đủ tất cả các lần lặp lại của điệp khúc, lời hát, lời thoại kéo dài tới mốc kết thúc thực tế của video.
   - Chỉ bỏ qua các quãng nghỉ hoàn toàn là nhạc không lời (instrumental) không có lời hát/lời thoại.
3. MỐC THỜI GIAN CHÍNH XÁC CHUẨN TỪNG MILI GIÂY (DECIMAL):
   - "start": Thời gian bắt đầu (giây) tính chính xác đến từng mili giây (dạng số thực thập phân như 10.45, 14.82...) của phân đoạn thô đầu tiên thuộc mệnh đề này.
   - "end": Thời gian kết thúc (giây) tính chính xác đến từng mili giây (tính bằng start + duration của phân đoạn đó, dạng số thực thập phân như 18.37...).
   - TUYỆT ĐỐI KHÔNG ĐƯỢC làm tròn thành số nguyên hoặc tròn giây .00 (như 10.00 hay 18.00).
4. KHÔNG DỊCH SANG TIẾNG VIỆT, giữ nguyên tiếng Anh gốc (chỉ thêm dấu câu thích hợp và viết hoa chữ cái đầu câu).
5. KHÔNG ĐƯỢC tự ý thêm bớt hay thay đổi từ ngữ nào trong câu nói để tránh làm mất nghĩa gốc.

Ví dụ định dạng phân đoạn chuẩn:
(0:10.45 - 0:18.12): I just woke up from my dream where you and I had to say goodbye
(0:18.12 - 0:23.50): and I don't know what it all means
(0:23.50 - 0:28.05): but since I survived I realized

Dữ liệu phụ đề thô (dưới dạng JSON):
${JSON.stringify(chunk, null, 2)}

Hãy phân tích và trả về danh sách các câu hoàn chỉnh chính xác tuyệt đối theo cấu trúc JSON.`;

                  const response = await ai.models.generateContent({
                    model: "gemini-2.0-flash",
                    contents: prompt,
                    config: {
                      responseMimeType: "application/json",
                      responseSchema: {
                        type: Type.ARRAY,
                        description: "Danh sách các câu đã được phân đoạn hoàn chỉnh",
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            sentence: {
                              type: Type.STRING,
                              description: "Câu hoàn chỉnh, được viết hoa đầu dòng và có dấu câu phù hợp.",
                            },
                            start: {
                              type: Type.NUMBER,
                              description: "Thời gian bắt đầu câu nói (giây), lấy chính xác từ start của phân đoạn phụ đề thô đầu tiên.",
                            },
                            end: {
                              type: Type.NUMBER,
                              description: "Thời gian kết thúc câu nói (giây), bằng start + duration của phân đoạn phụ đề thô cuối cùng.",
                            },
                          },
                          required: ["sentence", "start", "end"],
                        },
                      },
                    },
                  });

                  const text = response.text;
                  if (!text) return [];
                  const parsed = JSON.parse(text);
                  return Array.isArray(parsed) ? parsed : [];
                } catch (err) {
                  console.error(`Error processing chunk ${chunkIdx}:`, err);
                  // Fallback for this chunk: map individually
                  return chunk.map((c) => ({
                    sentence: c.text,
                    start: c.start,
                    end: c.start + c.duration,
                  }));
                }
              });

              const results = await Promise.all(segmentPromises);
              const mergedSentences = results.flat();

              // Sort by start time and assign simple sequential IDs
              const finalSentences = mergedSentences
                .filter((s) => s && s.sentence && typeof s.start === "number" && typeof s.end === "number")
                .sort((a, b) => a.start - b.start)
                .map((s, idx) => ({
                  id: idx + 1,
                  sentence: s.sentence.trim(),
                  start: Number(s.start.toFixed(2)),
                  end: Number(s.end.toFixed(2)),
                }));

              res.json({
                videoId,
                title: videoTitle,
                author: authorName,
                thumbnailUrl,
                language: selectedLanguage,
                sentences: finalSentences.length > 0 ? finalSentences : rawSegments.map((s, idx) => ({
                  id: idx + 1,
                  sentence: s.text,
                  start: s.start,
                  end: s.start + s.duration,
                })),
                geminiEnhanced: finalSentences.length > 0,
                isRestored: false,
              });
              return;
            } else {
              console.warn("Gemini API key is not configured. Falling back to basic segmentation.");
              const basicSentences = rawSegments.map((seg, idx) => ({
                id: idx + 1,
                sentence: seg.text,
                start: seg.start,
                end: seg.start + seg.duration,
              }));

              res.json({
                videoId,
                title: videoTitle,
                author: authorName,
                thumbnailUrl,
                language: selectedLanguage,
                sentences: basicSentences,
                geminiEnhanced: false,
                isRestored: false,
              });
              return;
            }
          }
        }
      } catch (transcriptError) {
        console.warn("Failed to retrieve or parse raw subtitles, falling back to restoration:", transcriptError);
      }
    }

    // FALLBACK: YouTube watch page was blocked or had no subtitles.
    res.status(404).json({
      error: "Không thể lấy phụ đề tự động từ YouTube. Vui lòng sử dụng tính năng dán văn bản phụ đề thủ công."
    });
    return;
  } catch (error: any) {
    console.error("General transcript error:", error);
    res.status(500).json({ error: error.message || "Đã xảy ra lỗi hệ thống khi tải phụ đề." });
  }
});

// AI Feedback evaluation endpoint
app.post("/api/evaluate", async (req, res) => {
  try {
    const { original, input } = req.body;
    if (!original) {
       res.status(400).json({ error: "Thiếu câu gốc" });
       return;
    }

    const cleanTextForComparison = (t: string) =>
      (t || "")
        .toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'–—]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    const normOriginal = (original || "").replace(/\s+/g, " ").trim();
    const normInput = (input || "").replace(/\s+/g, " ").trim();

    // Fast-track exact match (ignoring whitespace, punctuation & casing)
    if (cleanTextForComparison(normOriginal) === cleanTextForComparison(normInput)) {
      let vietnameseTranslation = req.body.vietnamese;
      if (!vietnameseTranslation && ai) {
        try {
          const trRes = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: `Translate the following English sentence to natural Vietnamese. Return ONLY the Vietnamese translation text:\n"${normOriginal}"`,
          });
          vietnameseTranslation = trRes.text?.trim() || undefined;
        } catch (err) {
          // Ignore error
        }
      }

      res.json({
        accuracy: 100,
        feedback: "Xuất sắc! Bạn chép hoàn toàn chính xác.",
        vietnameseTranslation,
        corrections: [],
      });
      return;
    }

    if (!ai) {
      console.warn(`${LOG_KEY} /api/evaluate fallback triggered: GEMINI_API_KEY is not set.`);
      // Improved fallback comparison
      const oWords = cleanTextForComparison(normOriginal).split(" ").filter(Boolean);
      const iWords = cleanTextForComparison(normInput).split(" ").filter(Boolean);

      let matched = 0;
      const iWordsCopy = [...iWords];
      for (const w of oWords) {
        const idx = iWordsCopy.indexOf(w);
        if (idx !== -1) {
          matched++;
          iWordsCopy.splice(idx, 1);
        }
      }
      const percent = oWords.length > 0 ? Math.round((matched / oWords.length) * 100) : 0;

      let feedback = "Cố gắng lên nhé!";
      if (percent >= 95) feedback = "Xuất sắc! Bạn chép hoàn toàn chính xác.";
      else if (percent >= 80) feedback = "Rất tốt! Chỉ sai một vài lỗi nhỏ.";
      else if (percent >= 50) feedback = "Tốt! Cần chú ý kỹ hơn các từ khó.";

      res.json({
        accuracy: percent,
        feedback,
        vietnameseTranslation: req.body.vietnamese || undefined,
        corrections: [],
      });
      return;
    }

    console.log(`${LOG_KEY} Requesting evaluation from Gemini API (model: gemini-2.0-flash)...`);

    const prompt = `So sánh câu đã gõ của người học với câu gốc để đánh giá mức độ chính xác khi luyện nghe chép chính tả.

LƯU Ý QUAN TRỌNG VỀ KHOẢNG TRẮNG VÀ DẤU CÂU:
- BẮT BUỘC bỏ qua mọi sự khác biệt về khoảng trắng (ví dụ: nhiều dấu cách liền nhau, xuống dòng, khoảng trắng ở đầu/cuối câu, khoảng trắng trước dấu câu). Xem "word1  word2" và "word1 word2" là hoàn toàn GIỐNG NHAU.
- Bỏ qua các khác biệt nhỏ vô hại về viết hoa hay dấu câu ở cuối câu.
- KHÔNG tạo lỗi trong "corrections" hoặc trừ điểm vì các dấu cách dư thừa hoặc thiếu dấu cách.

Câu gốc: "${normOriginal}"
Câu người học gõ: "${normInput}"

Đánh giá các yếu tố sau:
1. "accuracy": Số nguyên từ 0 đến 100 thể hiện mức độ chính xác từ vựng (percentage).
2. "feedback": Lời nhận xét khích lệ, vui tươi, giàu tính giáo dục bằng tiếng Việt.
3. "vietnameseTranslation": Bản dịch nghĩa tiếng Việt chuẩn xác, trôi chảy của câu gốc.
4. "explanation": Nếu người học có lỗi sai, hãy giải thích ngắn gọn trọng tâm bằng tiếng Việt về lý do vì sao câu bị sai (ví dụ về thì của động từ, ngữ pháp, từ loại, hoặc phân biệt từ). Ví dụ: "Just (vừa mới) nói về một hành động đã xảy ra ngay trước thời điểm nói, nên cần dùng quá khứ đơn hoặc hiện tại hoàn thành. Wake là nguyên mẫu/hiện tại không diễn tả được hành động vừa kết thúc."
5. "corrections": Danh sách các lỗi sai từ vựng cụ thể (KHÔNG bao gồm lỗi về dấu cách). Mỗi lỗi gồm:
   - "word": từ hoặc cụm từ bị viết sai trong bài gõ của người học.
   - "expected": từ hoặc cụm từ chính xác lẽ ra phải viết (theo câu gốc).
   - "type": phân loại lỗi ("missing" - thiếu từ, "spelling" - viết sai chính tả, "incorrect" - viết sai từ).
   - "reason": giải thích ngắn gọn lý do vì sao từ/cụm từ này bị sai hoặc nhầm lẫn (ngữ pháp, từ loại, thì động từ).

Hãy trả về kết quả dưới dạng cấu trúc JSON chính xác tuyệt đối.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["accuracy", "feedback", "vietnameseTranslation", "corrections"],
          properties: {
            accuracy: {
              type: Type.INTEGER,
              description: "Điểm số chính xác từ 0 đến 100.",
            },
            feedback: {
              type: Type.STRING,
              description: "Nhận xét vui tươi, thân thiện bằng tiếng Việt.",
            },
            vietnameseTranslation: {
              type: Type.STRING,
              description: "Bản dịch nghĩa tiếng Việt chuẩn xác của câu gốc.",
            },
            explanation: {
              type: Type.STRING,
              description: "Giải thích ngắn gọn trọng tâm bằng tiếng Việt về lý do sai chính của người học.",
            },
            corrections: {
              type: Type.ARRAY,
              description: "Danh sách chi tiết các lỗi sai để sửa chữa.",
              items: {
                type: Type.OBJECT,
                required: ["word", "expected", "type"],
                properties: {
                  word: {
                    type: Type.STRING,
                    description: "Từ hoặc cụm từ viết sai/thiếu của học sinh.",
                  },
                  expected: {
                    type: Type.STRING,
                    description: "Từ hoặc cụm từ đúng đáng lẽ phải viết.",
                  },
                  type: {
                    type: Type.STRING,
                    enum: ["missing", "spelling", "incorrect"],
                    description: "Kiểu lỗi.",
                  },
                  reason: {
                    type: Type.STRING,
                    description: "Giải thích ngắn gọn vì sao từ này bị sai/nhầm lẫn.",
                  },
                },
              },
            },
          },
        },
      },
    });

    const text = response.text;
    if (!text) throw new Error("Empty response from evaluation AI");
    console.log(`${LOG_KEY} Evaluation response received from Gemini successfully.`);
    res.json(JSON.parse(text));
  } catch (error: any) {
    console.error(`${LOG_KEY} Evaluation API Error:`, {
      message: error?.message,
      status: error?.status,
      code: error?.code,
      stack: error?.stack,
    });
    res.status(500).json({ error: error.message || "Không thể đánh giá kết quả." });
  }
});

// Appwrite Vocabulary Sync Endpoints
app.post("/api/vocabulary/lookup-ai", async (req, res) => {
  try {
    const { word, contextSentence } = req.body;
    if (!word || !word.trim()) {
      res.status(400).json({ error: "Vui lòng nhập từ vựng cần tra cứu." });
      return;
    }

    if (!ai) {
      console.warn(`${LOG_KEY} Vocabulary lookup failed: GEMINI_API_KEY is not set.`);
      res.status(400).json({ error: "Thiếu cấu hình Gemini API Key." });
      return;
    }

    console.log(`${LOG_KEY} Requesting vocabulary lookup for "${word.trim()}" from Gemini API...`);

    const prompt = `Bạn là một từ điển Anh - Việt chuyên nghiệp. Hãy phân tích từ vựng tiếng Anh sau và trả về thông tin chi tiết bằng tiếng Việt:
Từ vựng: "${word.trim()}"
${contextSentence ? `Câu ngữ cảnh: "${contextSentence.trim()}"` : ""}

Nhiệm vụ:
1. "vietnamese": Nghĩa tiếng Việt chính xác, phổ biến và ngắn gọn của từ (ví dụ: "sự tồn tại, sự sống sót").
2. "grammar": Từ loại chính (ví dụ: "noun", "verb", "adjective", "adverb", "phrase").
3. "englishSentence": Câu ví dụ minh họa bằng tiếng Anh (ưu tiên dùng chính câu ngữ cảnh nếu có, hoặc tạo câu ví dụ tự nhiên ngắn gọn).
4. "vietnameseSentence": Dịch nghĩa câu ví dụ sang tiếng Việt trôi chảy.

Trả về dữ liệu theo đúng cấu trúc JSON.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["vietnamese", "grammar", "englishSentence", "vietnameseSentence"],
          properties: {
            vietnamese: { type: Type.STRING },
            grammar: { type: Type.STRING },
            englishSentence: { type: Type.STRING },
            vietnameseSentence: { type: Type.STRING },
          },
        },
      },
    });

    const text = response.text;
    if (!text) throw new Error("Gemini returned empty text for lookup");
    console.log(`${LOG_KEY} Vocabulary lookup successful for "${word.trim()}".`);
    res.json(JSON.parse(text));
  } catch (error: any) {
    console.error(`${LOG_KEY} Vocabulary lookup AI Error:`, {
      message: error?.message,
      status: error?.status,
      code: error?.code,
      stack: error?.stack,
    });
    res.status(500).json({ error: error.message || "Không thể tra cứu từ vựng bằng AI." });
  }
});

app.post("/api/vocabulary/add-appwrite", async (req, res) => {
  try {
    const {
      word,
      vietnamese,
      grammar,
      category,
      englishSentence,
      vietnameseSentence
    } = req.body;

    if (!word || !word.trim()) {
      res.status(400).json({ error: "Vui lòng cung cấp từ vựng." });
      return;
    }

    const APPWRITE_ENDPOINT = "https://fra.cloud.appwrite.io/v1";
    const APPWRITE_PROJECT_ID = "68cf65390012ceaa2085";
    const APPWRITE_DATABASE_ID = "68cfb8c900053dca6f90";
    const APPWRITE_COLLECTION_ID = "vocabularies";

    // Format sentences JSON string matching Appwrite schema
    const sentencesArr = [
      {
        sentences: englishSentence || "",
        vietnamese: vietnameseSentence || "",
        grammar: grammar || ""
      }
    ];

    const documentData = {
      word: word.trim(),
      sentences: JSON.stringify(sentencesArr),
      vietnamese: (vietnamese || "").trim(),
      grammar: (grammar || "").trim(),
      createdAt: String(Date.now()),
      lastStudiedAt: String(Date.now()),
      priorityScore: "0",
      category: category === "TOEIC" ? "TOEIC" : "GENERAL",
      totalAttempts: "0",
      correctAttempts: "0",
      memoryScore: "0",
      last10Attempts: "[]"
    };

    const generateUniqueId = () => {
      const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
      let result = "";
      for (let i = 0; i < 20; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    const documentId = generateUniqueId();
    const appwriteUrl = `${APPWRITE_ENDPOINT}/databases/${APPWRITE_DATABASE_ID}/collections/${APPWRITE_COLLECTION_ID}/documents`;

    const appwriteRes = await fetch(appwriteUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Appwrite-Project": APPWRITE_PROJECT_ID
      },
      body: JSON.stringify({
        documentId: documentId,
        data: documentData
      })
    });

    const responseData = await appwriteRes.json();

    if (!appwriteRes.ok) {
      console.error("Appwrite error response:", responseData);
      throw new Error(responseData.message || "Lỗi lưu từ vựng lên Appwrite Database.");
    }

    res.json({
      success: true,
      message: `Đã đồng bộ từ "${word.trim()}" lên Appwrite Cloud thành công!`,
      documentId: responseData.$id || documentId,
      data: responseData
    });
  } catch (error: any) {
    console.error("Error adding vocabulary to Appwrite:", error);
    res.status(500).json({ error: error.message || "Không thể kết nối đến Appwrite Server." });
  }
});

// Configure Vite middleware or serve static production build
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

startServer();

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini SDK with custom user agent for tracking
const apiKey = process.env.GEMINI_API_KEY;
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
            const sentenceText = match[2];
            const timeParts = timeRange.split("-");
            if (timeParts.length === 2) {
              const start = parseTimestampToSeconds(timeParts[0]);
              const end = parseTimestampToSeconds(timeParts[1]);
              sentences.push({
                id: id++,
                sentence: sentenceText.trim(),
                start,
                end
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

Nhiệm vụ của bạn:
1. Ghép các từ/phân đoạn thô liền kề để tạo thành các câu nói hoàn chỉnh, có ý nghĩa trọn vẹn và tự nhiên nhất.
2. Thêm dấu câu thích hợp (chấm, phẩy, hỏi chấm, cảm thán) và viết hoa chữ cái đầu câu.
3. KHÔNG ĐƯỢC tự ý thêm bớt hay thay đổi từ ngữ nào trong lời thoại gốc để giữ tính chính xác của bài nghe chính tả.
4. QUAN TRỌNG: Nếu dữ liệu phụ đề thô ĐÃ CÓ SẴN các mốc thời gian (ví dụ: "0.0s - 5.5s" hoặc "0:01 - 0:04"), hãy trích xuất và BẮT BUỘC SỬ DỤNG CHÍNH XÁC các mốc thời gian đó (chuyển đổi sang định dạng số giây) cho các câu tương ứng. CHỈ KHI văn bản KHÔNG có mốc thời gian, bạn mới được phép tự ước lượng mốc thời gian tăng dần liên tục và tự nhiên.

Dữ liệu phụ đề thô:
${userRawText}

Hãy phân tích kỹ lưỡng và trả về danh sách các câu đã phân đoạn chính xác theo cấu trúc định dạng JSON.`;

        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
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
                  const prompt = `Bạn là một chuyên gia ngôn ngữ học và dịch thuật chính tả. Hãy thực hiện việc phân đoạn câu và sửa lỗi viết hoa, dấu câu cho các phân đoạn phụ đề thô của YouTube dưới đây.
Nhiệm vụ của bạn:
1. Ghép các phân đoạn thô liền kề để tạo thành các câu nói hoàn chỉnh, có ý nghĩa trọn vẹn và tự nhiên.
2. Thêm dấu câu thích hợp (chấm, phẩy, hỏi chấm, cảm thán) và viết hoa chữ cái đầu câu.
3. KHÔNG ĐƯỢC thêm bớt hay thay đổi từ ngữ nào trong câu nói để tránh làm mất nghĩa gốc. Giữ nguyên từ ngữ nói của người nói.
4. Xác định mốc thời gian:
   - "start": Là thời gian bắt đầu (giây) của phân đoạn thô đầu tiên cấu thành nên câu này.
   - "end": Là thời gian kết thúc (giây) của phân đoạn thô cuối cùng cấu thành nên câu này (tính bằng start + duration của phân đoạn đó).

Dữ liệu phụ đề thô (dưới dạng JSON):
${JSON.stringify(chunk, null, 2)}

Hãy phân tích và trả về danh sách các câu hoàn chỉnh chính xác tuyệt đối theo cấu trúc JSON.`;

                  const response = await ai.models.generateContent({
                    model: "gemini-3.5-flash",
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

    if (!ai) {
      // Basic fallback comparison
      const cleanText = (t: string) =>
        t
          .toLowerCase()
          .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "")
          .replace(/\s+/g, " ")
          .trim();
      const o = cleanText(original);
      const i = cleanText(input || "");
      const matchedWords = o.split(" ").filter((w) => i.includes(w)).length;
      const totalWords = o.split(" ").length;
      const percent = totalWords > 0 ? Math.round((matchedWords / totalWords) * 100) : 0;

      let feedback = "Cố gắng lên nhé!";
      if (percent >= 95) feedback = "Xuất sắc! Bạn chép hoàn toàn chính xác.";
      else if (percent >= 80) feedback = "Rất tốt! Chỉ sai một vài lỗi nhỏ.";
      else if (percent >= 50) feedback = "Tốt! Cần chú ý kỹ hơn các từ khó.";

       res.json({
        accuracy: percent,
        feedback,
        corrections: [],
      });
       return;
    }

    const prompt = `So sánh câu đã gõ của người học với câu gốc để đánh giá mức độ chính xác khi luyện nghe chép chính tả.
Hãy bỏ qua các khác biệt nhỏ vô hại về viết hoa hay dấu câu ở cuối câu trừ khi nó làm thay đổi hoàn toàn nghĩa của câu.

Câu gốc: "${original}"
Câu người học gõ: "${input || ""}"

Đánh giá các yếu tố sau:
1. "accuracy": Số nguyên từ 0 đến 100 thể hiện mức độ chính xác từ vựng (percentage).
2. "feedback": Lời nhận xét khích lệ, vui tươi, giàu tính giáo dục bằng tiếng Việt (ví dụ: "Xuất sắc! Không sai một từ nào!", "Tuyệt vời, bạn chỉ nhầm một chút xíu thôi!", "Tốt rồi, cố gắng nghe kỹ các âm đuôi nhé", "Sai hơi nhiều rồi nè, nghe kỹ lại và viết lại nhé!").
3. "corrections": Danh sách các lỗi sai cụ thể được tìm thấy. Mỗi lỗi gồm:
   - "word": từ hoặc cụm từ bị viết sai trong bài gõ của người học.
   - "expected": từ hoặc cụm từ chính xác lẽ ra phải viết (theo câu gốc).
   - "type": phân loại lỗi ("missing" - thiếu từ, "spelling" - viết sai chính tả, "incorrect" - viết sai từ).

Hãy trả về kết quả dưới dạng cấu trúc JSON chính xác tuyệt đối.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["accuracy", "feedback", "corrections"],
          properties: {
            accuracy: {
              type: Type.INTEGER,
              description: "Điểm số chính xác từ 0 đến 100.",
            },
            feedback: {
              type: Type.STRING,
              description: "Nhận xét vui tươi, thân thiện bằng tiếng Việt.",
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
                },
              },
            },
          },
        },
      },
    });

    const text = response.text;
    if (!text) throw new Error("Empty response from evaluation AI");
    res.json(JSON.parse(text));
  } catch (error: any) {
    console.error("Evaluation API error:", error);
    res.status(500).json({ error: error.message || "Không thể đánh giá kết quả." });
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

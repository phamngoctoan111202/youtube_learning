import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Diagnostic health endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
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

function mergeRawSegmentsLocally(rawSegments: Array<{ text: string; start: number; duration: number }>): Array<{ sentence: string; start: number; end: number }> {
  const result: Array<{ sentence: string; start: number; end: number }> = [];
  if (!rawSegments || rawSegments.length === 0) return result;

  let currentText = "";
  let currentStart = rawSegments[0].start;
  let currentEnd = rawSegments[0].start + rawSegments[0].duration;

  for (let i = 0; i < rawSegments.length; i++) {
    const seg = rawSegments[i];
    const text = (seg.text || "").trim();
    if (!text) continue;

    if (!currentText) {
      currentText = text;
      currentStart = seg.start;
      currentEnd = seg.start + seg.duration;
    } else {
      currentText += " " + text;
      currentEnd = seg.start + seg.duration;
    }

    const wordCount = currentText.split(/\s+/).length;
    const duration = currentEnd - currentStart;
    const endsWithPunctuation = /[.!?]$/.test(currentText);

    if (endsWithPunctuation || duration >= 4.5 || wordCount >= 8 || i === rawSegments.length - 1) {
      result.push({
        sentence: currentText.trim(),
        start: Number(currentStart.toFixed(2)),
        end: Number(currentEnd.toFixed(2)),
      });
      currentText = "";
    }
  }

  if (currentText.trim()) {
    result.push({
      sentence: currentText.trim(),
      start: Number(currentStart.toFixed(2)),
      end: Number(currentEnd.toFixed(2)),
    });
  }

  return result;
}

// Endpoint to fetch video details and segment transcript locally
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

    // A. Handle user-provided RAW TEXT transcript directly
    if (userRawText && userRawText.trim()) {
      console.log("Parsing user-provided raw text transcript locally...");
      
      const parseTimestampToSeconds = (ts: string): number => {
        const cleanTs = ts.trim().replace(/[\[\]()]/g, "").replace(",", ".");
        const parts = cleanTs.split(":").map(Number);
        if (parts.length === 2) {
          return parts[0] * 60 + parts[1];
        } else if (parts.length === 3) {
          return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
        return 0;
      };

      const lines = userRawText.split(/\r?\n/);
      const localSentences: Array<{ id: number; sentence: string; start: number; end: number; vietnamese?: string }> = [];
      let currentTime = 0;
      let idCounter = 1;
      let pendingStart: number | null = null;

      const timestampRangeRegex = /^\s*[\(\[]?(\d+:\d+(?:[.,]\d+)?(?::\d+(?:[.,]\d+)?)?)\s*(?:-|-->|\to)\s*(\d+:\d+(?:[.,]\d+)?(?::\d+(?:[.,]\d+)?)?)[\)\]]?:?\s*(.*)$/i;
      const singleTimestampRegex = /^\s*[\(\[]?(\d+:\d+(?:[.,]\d+)?(?::\d+(?:[.,]\d+)?)?)[\)\]]?\s*$/;

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed) continue;

        if (/^\d+$/.test(trimmed) && trimmed.length < 5) {
          continue;
        }

        const singleMatch = singleTimestampRegex.exec(trimmed);
        if (singleMatch) {
          pendingStart = parseTimestampToSeconds(singleMatch[1]);
          continue;
        }

        const rangeMatch = timestampRangeRegex.exec(trimmed);
        if (rangeMatch) {
          const startSec = parseTimestampToSeconds(rangeMatch[1]);
          const endSec = parseTimestampToSeconds(rangeMatch[2]);
          const rawContent = rangeMatch[3].trim();

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

          if (sentenceText) {
            localSentences.push({
              id: idCounter++,
              sentence: sentenceText,
              start: Number(startSec.toFixed(2)),
              end: Number(endSec.toFixed(2)),
              ...(vietnameseText ? { vietnamese: vietnameseText } : {}),
            });
            currentTime = endSec;
            pendingStart = null;
          }
          continue;
        }

        let sentenceText = trimmed;
        let vietnameseText = "";

        if (trimmed.includes("|")) {
          const parts = trimmed.split("|");
          sentenceText = parts[0].trim();
          vietnameseText = parts.slice(1).join("|").replace(/^Dịch:\s*/i, "").trim();
        } else if (/\(Dịch:\s*/i.test(trimmed)) {
          const vMatch = trimmed.match(/^(.*?)\s*\(Dịch:\s*(.*?)\)$/i);
          if (vMatch) {
            sentenceText = vMatch[1].trim();
            vietnameseText = vMatch[2].trim();
          }
        }

        if (sentenceText) {
          const wordCount = sentenceText.split(/\s+/).length;
          const estimatedDuration = Math.max(3, Math.min(8, Math.round(wordCount * 0.4)));
          const startSec = pendingStart !== null ? pendingStart : currentTime;
          const endSec = startSec + estimatedDuration;

          localSentences.push({
            id: idCounter++,
            sentence: sentenceText,
            start: Number(startSec.toFixed(2)),
            end: Number(endSec.toFixed(2)),
            ...(vietnameseText ? { vietnamese: vietnameseText } : {}),
          });
          currentTime = endSec;
          pendingStart = null;
        }
      }

      if (localSentences.length > 0) {
        console.log(`Parsed ${localSentences.length} sentences locally.`);
        res.json({
          videoId,
          title: videoTitle,
          author: authorName,
          thumbnailUrl,
          language: "en",
          sentences: localSentences,
          geminiEnhanced: false,
          isRestored: false,
          isManualText: true
        });
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
          error: "Không thể tìm thấy thông tin phụ đề trong đoạn mã nguồn HTML bạn đã dán. Hãy đảm bảo bạn đã mở đúng trang xem video chính thức trên YouTube, nhấn Ctrl+U và sao chép toàn bộ mã nguồn."
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
            const basicSentences = mergeRawSegmentsLocally(rawSegments).map((seg, idx) => ({
              id: idx + 1,
              sentence: seg.sentence,
              start: seg.start,
              end: seg.end,
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
      } catch (transcriptError) {
        console.warn("Failed to retrieve or parse raw subtitles:", transcriptError);
      }
    }

    res.status(404).json({
      error: "Không thể lấy phụ đề tự động từ YouTube. Vui lòng sử dụng tính năng dán văn bản phụ đề thủ công."
    });
    return;
  } catch (error: any) {
    console.error("General transcript error:", error);
    res.status(500).json({ error: error.message || "Đã xảy ra lỗi hệ thống khi tải phụ đề." });
  }
});

// Fast Feedback evaluation endpoint (100% Local String Comparison)
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
    const cleanOrig = cleanTextForComparison(normOriginal);
    const cleanUser = cleanTextForComparison(normInput);

    let vietnameseTranslation = req.body.vietnamese;

    // Fast-track exact match (ignoring whitespace, punctuation & casing)
    if (cleanOrig === cleanUser) {
      res.json({
        accuracy: 100,
        feedback: "Xuất sắc! Bạn chép hoàn toàn chính xác.",
        vietnameseTranslation,
        corrections: [],
      });
      return;
    }

    const oWords = cleanOrig.split(" ").filter(Boolean);
    const iWords = cleanUser.split(" ").filter(Boolean);

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
      vietnameseTranslation,
      corrections: [],
    });
  } catch (error: any) {
    res.status(500).json({ error: "Không thể đánh giá kết quả." });
  }
});

// Appwrite Vocabulary Sync Endpoint
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

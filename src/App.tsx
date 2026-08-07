import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  Youtube,
  ArrowLeft,
  ArrowRight,
  Shuffle,
  Volume2,
  Check,
  Sparkles,
  Trophy,
  History,
  BookOpen,
  Headphones,
  Info,
  ChevronRight,
  HelpCircle,
  Clock,
  ExternalLink,
  RotateCcw,
  Clipboard,
  FileText,
  Code,
  AlertTriangle,
  Trash2,
  BookmarkPlus,
  Layers,
  Scissors,
  Edit3,
  Square,
  CheckSquare,
  Languages
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Header from "./components/Header";
import YoutubePlayer from "./components/YoutubePlayer";
import FeedbackCard from "./components/FeedbackCard";
import AddVocabularyModal from "./components/AddVocabularyModal";
import EditSentenceModal from "./components/EditSentenceModal";
import { RECOMMENDED_VIDEOS } from "./data";
import { Sentence, VideoDetails, EvaluationResult } from "./types";

export default function App() {
  // Input URL states
  const [urlInput, setUrlInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"auto" | "html" | "text">("auto");
  const [pastedHtml, setPastedHtml] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [isCopied, setIsCopied] = useState(false);

  // App active states
  const [videoDetails, setVideoDetails] = useState<VideoDetails | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0); // 0-based index of sentences

  // Settings & Toggles: Show Vietnamese translation before answer & Random Mode
  const [showTranslationBefore, setShowTranslationBefore] = useState<boolean>(() => {
    return localStorage.getItem("show_translation_before") === "true";
  });
  const [isRandomMode, setIsRandomMode] = useState<boolean>(() => {
    return localStorage.getItem("is_random_mode") === "true";
  });

  const toggleShowTranslationBefore = () => {
    setShowTranslationBefore((prev) => {
      const val = !prev;
      localStorage.setItem("show_translation_before", String(val));
      return val;
    });
  };

  const toggleRandomMode = () => {
    setIsRandomMode((prev) => {
      const val = !prev;
      localStorage.setItem("is_random_mode", String(val));
      return val;
    });
  };

  // User dictation states
  const [userInput, setUserInput] = useState("");
  const [padding, setPadding] = useState(0); // Default 0s padding
  const [playTrigger, setPlayTrigger] = useState(0);
  
  // Evaluation states
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationResult, setEvaluationResult] = useState<EvaluationResult | null>(null);

  // Progress/History tracking (saved to localStorage)
  const [progress, setProgress] = useState<Record<number, number>>({}); // sentence id -> max accuracy scored
  const [history, setHistory] = useState<Array<{ videoId: string; title: string; date: string; sentences?: Sentence[]; videoDetails?: VideoDetails }>>([]);

  // Appwrite Add Vocabulary Modal states
  const [isVocabModalOpen, setIsVocabModalOpen] = useState(false);
  const [vocabDefaultWord, setVocabDefaultWord] = useState("");
  const [vocabContextSentence, setVocabContextSentence] = useState("");

  // Sentence selection, merge & edit modal states
  const [selectedSentenceIds, setSelectedSentenceIds] = useState<number[]>([]);
  const [editingSentence, setEditingSentence] = useState<Sentence | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Textarea refs to retain focus
  const desktopTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mobileTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleOpenAddVocab = (word: string = "", contextSentence: string = "") => {
    setVocabDefaultWord(word);
    setVocabContextSentence(contextSentence || (sentences[currentIndex]?.sentence || ""));
    setIsVocabModalOpen(true);
  };

  const handleToggleSelectSentence = (sentenceId: number, e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation();
    setSelectedSentenceIds((prev) =>
      prev.includes(sentenceId)
        ? prev.filter((id) => id !== sentenceId)
        : [...prev, sentenceId].sort((a, b) => a - b)
    );
  };

  const saveSentencesForVideo = (videoId: string | undefined, updatedSentences: Sentence[]) => {
    if (!videoId || updatedSentences.length === 0) return;
    try {
      localStorage.setItem(`sentences_${videoId}`, JSON.stringify(updatedSentences));
      setHistory((prevHistory) => {
        const updatedHistory = prevHistory.map((item) => {
          if (item.videoId === videoId) {
            return { ...item, sentences: updatedSentences };
          }
          return item;
        });
        try {
          localStorage.setItem("youtube_dictation_history", JSON.stringify(updatedHistory));
        } catch (e) {
          console.warn("Storage warning updating history", e);
        }
        return updatedHistory;
      });
    } catch (err) {
      console.error("Failed to save sentences to localStorage", err);
    }
  };

  const handleMergeSentences = () => {
    if (selectedSentenceIds.length < 2) return;
    const sortedIds = [...selectedSentenceIds].sort((a, b) => a - b);
    const selectedSentences = sentences.filter((s) => sortedIds.includes(s.id));
    if (selectedSentences.length < 2) return;

    const primaryId = selectedSentences[0].id;
    const mergedText = selectedSentences.map((s) => s.sentence).join(" ");
    const minStart = Math.min(...selectedSentences.map((s) => s.start));
    const maxEnd = Math.max(...selectedSentences.map((s) => s.end));

    const newMergedSentence: Sentence = {
      id: primaryId,
      sentence: mergedText,
      start: minStart,
      end: maxEnd,
      isMerged: true,
      mergedFrom: selectedSentences,
    };

    const idsToRemove = new Set(selectedSentences.map((s) => s.id));
    const updatedSentences: Sentence[] = [];
    for (let i = 0; i < sentences.length; i++) {
      if (sentences[i].id === primaryId) {
        updatedSentences.push(newMergedSentence);
      } else if (!idsToRemove.has(sentences[i].id)) {
        updatedSentences.push(sentences[i]);
      }
    }

    setSentences(updatedSentences);
    setSelectedSentenceIds([]);
    saveSentencesForVideo(videoDetails?.videoId, updatedSentences);

    const newIndex = updatedSentences.findIndex((s) => s.id === primaryId);
    if (newIndex !== -1) {
      setCurrentIndex(newIndex);
      setUserInput("");
      setEvaluationResult(null);
    }
  };

  const handleUnmergeSentence = (sentenceToUnmerge: Sentence, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!sentenceToUnmerge.isMerged || !sentenceToUnmerge.mergedFrom) return;

    const targetIdx = sentences.findIndex((s) => s.id === sentenceToUnmerge.id);
    if (targetIdx === -1) return;

    const updatedSentences = [
      ...sentences.slice(0, targetIdx),
      ...sentenceToUnmerge.mergedFrom,
      ...sentences.slice(targetIdx + 1),
    ];

    setSentences(updatedSentences);
    saveSentencesForVideo(videoDetails?.videoId, updatedSentences);
    if (currentIndex >= updatedSentences.length) {
      setCurrentIndex(Math.max(0, updatedSentences.length - 1));
    }
  };

  const handleUpdateSentence = (updated: Sentence) => {
    const updatedSentences = sentences.map((s) => (s.id === updated.id ? updated : s));
    setSentences(updatedSentences);
    saveSentencesForVideo(videoDetails?.videoId, updatedSentences);
    if (sentences[currentIndex]?.id === updated.id) {
      setUserInput("");
      setEvaluationResult(null);
    }
  };

  const handleOpenEditSentence = (s: Sentence, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSentence(s);
    setIsEditModalOpen(true);
  };

  // Auto-change loading messages for realistic feel
  const loadingMessages = [
    "Đang phân tích địa chỉ video...",
    "Đang kết nối YouTube tải siêu dữ liệu...",
    "Đang trích xuất dữ liệu phụ đề thô...",
    "Đang khởi chạy thuật toán AI Gemini phân tích ngữ nghĩa...",
    "AI đang khôi phục viết hoa, dấu câu và ghép câu tự nhiên...",
    "Đang đồng bộ hóa mốc thời gian phát audio cho từng câu..."
  ];

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      interval = setInterval(() => {
        setLoadingStep((prev) => (prev < loadingMessages.length - 1 ? prev + 1 : prev));
      }, 3500);
    } else {
      setLoadingStep(0);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  // Restore active session & custom merged sentences on page load / refresh
  useEffect(() => {
    const savedDetailsStr = localStorage.getItem("active_video_details");
    const savedIndexStr = localStorage.getItem("active_video_current_index");
    if (savedDetailsStr) {
      try {
        const parsedDetails: VideoDetails = JSON.parse(savedDetailsStr);
        const savedSentencesStr = localStorage.getItem(`sentences_${parsedDetails.videoId}`);
        if (savedSentencesStr) {
          const parsedSentences: Sentence[] = JSON.parse(savedSentencesStr);
          if (Array.isArray(parsedSentences) && parsedSentences.length > 0) {
            setVideoDetails(parsedDetails);
            setSentences(parsedSentences);
            const idx = savedIndexStr ? parseInt(savedIndexStr, 10) : 0;
            setCurrentIndex(isNaN(idx) ? 0 : Math.min(idx, Math.max(0, parsedSentences.length - 1)));
          }
        }
      } catch (err) {
        console.error("Failed to restore active video session on refresh", err);
      }
    }
  }, []);

  // Auto-persist active video session & merged sentences to local storage
  useEffect(() => {
    if (videoDetails && sentences.length > 0) {
      try {
        localStorage.setItem("active_video_details", JSON.stringify(videoDetails));
        localStorage.setItem("active_video_current_index", String(currentIndex));
        localStorage.setItem(`sentences_${videoDetails.videoId}`, JSON.stringify(sentences));
      } catch (e) {
        console.warn("Storage quota warning on active video sync", e);
      }
    }
  }, [videoDetails, sentences, currentIndex]);

  // Load progress and history from LocalStorage
  useEffect(() => {
    if (videoDetails) {
      const savedProgress = localStorage.getItem(`progress_${videoDetails.videoId}`);
      if (savedProgress) {
        setProgress(JSON.parse(savedProgress));
      } else {
        setProgress({});
      }
    }
  }, [videoDetails]);

  useEffect(() => {
    const savedHistory = localStorage.getItem("youtube_dictation_history");
    if (savedHistory) {
      setHistory(JSON.parse(savedHistory));
    }
  }, []);

  // Handle Loading Video from URL
  const handleLoadVideo = async (targetUrl: string, html?: string, rawText?: string) => {
    if (!targetUrl.trim()) return;
    setIsLoading(true);
    setError(null);
    setLoadingStep(0);
    setVideoDetails(null);
    setSentences([]);
    setSelectedSentenceIds([]);
    setEvaluationResult(null);
    setUserInput("");

    try {
      const res = await fetch("/api/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl, html, rawText }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Không thể tải phụ đề của video này.");
      }

      setVideoDetails({
        videoId: data.videoId,
        title: data.title,
        author: data.author,
        thumbnailUrl: data.thumbnailUrl,
        language: data.language,
        isRestored: data.isRestored,
      });

      // Check if user has saved custom merged/edited sentences for this video
      const savedSentencesStr = localStorage.getItem(`sentences_${data.videoId}`);
      let sentencesToUse = data.sentences;
      if (savedSentencesStr) {
        try {
          const parsed = JSON.parse(savedSentencesStr);
          if (Array.isArray(parsed) && parsed.length > 0) {
            sentencesToUse = parsed;
          }
        } catch (e) {
          console.error("Failed to parse saved custom sentences", e);
        }
      }

      setSentences(sentencesToUse);
      setCurrentIndex(0);

      // Save to History
      const newHistoryItem = {
        videoId: data.videoId,
        title: data.title,
        date: new Date().toLocaleDateString("vi-VN"),
        sentences: data.sentences,
        videoDetails: {
          videoId: data.videoId,
          title: data.title,
          author: data.author,
          thumbnailUrl: data.thumbnailUrl,
          language: data.language,
          isRestored: data.isRestored,
        }
      };
      const updatedHistory = [
        newHistoryItem,
        ...history.filter((h) => h.videoId !== data.videoId),
      ].slice(0, 10); // Keep last 10 entries

      setHistory(updatedHistory);
      try {
        localStorage.setItem("youtube_dictation_history", JSON.stringify(updatedHistory));
      } catch (storageError) {
        console.warn("Storage quota exceeded, trying to save with less data", storageError);
        try {
          const strippedHistory = updatedHistory.map((h, idx) => 
            idx === 0 ? h : { ...h, sentences: [] }
          );
          localStorage.setItem("youtube_dictation_history", JSON.stringify(strippedHistory));
        } catch (e) {
          console.error("Could not save history even after stripping data");
        }
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Đã xảy ra lỗi không xác định. Vui lòng thử lại.");
    } finally {
      setIsLoading(false);
    }
  };

  // Delete a single video entry from history
  const handleDeleteHistoryItem = (videoIdToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedHistory = history.filter((h) => h.videoId !== videoIdToDelete);
    setHistory(updatedHistory);
    try {
      localStorage.setItem("youtube_dictation_history", JSON.stringify(updatedHistory));
    } catch (err) {
      console.error("Failed to save history after deletion", err);
    }
  };

  // Play current segment
  const triggerPlay = () => {
    setPlayTrigger((prev) => prev + 1);
  };

  // Submit Dictation to check
  const handleCheck = async () => {
    if (!sentences[currentIndex]) return;
    setIsEvaluating(true);
    setEvaluationResult(null);

    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          original: sentences[currentIndex].sentence,
          input: userInput,
          vietnamese: sentences[currentIndex].vietnamese,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể phân tích kết quả.");
      }

      setEvaluationResult(data);

      // Save progress
      const currentSentenceId = sentences[currentIndex].id;
      const prevBest = progress[currentSentenceId] || 0;
      if (data.accuracy > prevBest) {
        const newProgress = { ...progress, [currentSentenceId]: data.accuracy };
        setProgress(newProgress);
        if (videoDetails) {
          localStorage.setItem(`progress_${videoDetails.videoId}`, JSON.stringify(newProgress));
        }
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Lỗi kiểm tra bài gõ.");
    } finally {
      setIsEvaluating(false);
      setTimeout(() => {
        if (isMobile) {
          mobileTextareaRef.current?.focus();
        } else {
          desktopTextareaRef.current?.focus();
        }
      }, 50);
    }
  };

  // Input change & keydown handlers for Enter navigation
  const handleInputChange = (val: string) => {
    setUserInput(val);
    if (evaluationResult !== null) {
      setEvaluationResult(null);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (evaluationResult !== null) {
        if (evaluationResult.accuracy >= 100) {
          handleNext();
        }
      } else if (!isEvaluating && userInput.trim()) {
        handleCheck();
      }
    }
  };

  // Global window Enter listener to handle next sentence when evaluation result is displayed
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        const activeElement = document.activeElement;
        const activeId = activeElement?.id;

        // Ignore if user is inside specific modals or URL inputs
        if (
          activeId === "youtube-url-input" ||
          activeId === "pasted-text-input" ||
          isVocabModalOpen ||
          isEditModalOpen
        ) {
          return;
        }

        if (evaluationResult !== null && !isEvaluating) {
          if (evaluationResult.accuracy >= 100) {
            e.preventDefault();
            handleNext();
          }
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [evaluationResult, isEvaluating, isVocabModalOpen, isEditModalOpen, currentIndex, sentences.length, isRandomMode]);

  // Navigation handlers
  const handleNext = () => {
    if (sentences.length === 0) return;

    if (isRandomMode) {
      if (sentences.length > 1) {
        let randIdx = currentIndex;
        while (randIdx === currentIndex) {
          randIdx = Math.floor(Math.random() * sentences.length);
        }
        handleSelectSentence(randIdx);
        return;
      }
    }

    if (currentIndex < sentences.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setUserInput("");
      setEvaluationResult(null);
      setTimeout(() => {
        setPlayTrigger((prev) => prev + 1);
        if (isMobile) {
          mobileTextareaRef.current?.focus();
        } else {
          desktopTextareaRef.current?.focus();
        }
      }, 50);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
      setUserInput("");
      setEvaluationResult(null);
      setTimeout(() => {
        setPlayTrigger((prev) => prev + 1);
      }, 50);
    }
  };

  const handleSelectSentence = (idx: number) => {
    if (idx >= 0 && idx < sentences.length) {
      setCurrentIndex(idx);
      setUserInput("");
      setEvaluationResult(null);
      setTimeout(() => {
        setPlayTrigger((prev) => prev + 1);
      }, 50);
    }
  };

  const handleRandom = () => {
    if (sentences.length <= 1) return;
    let randIdx = currentIndex;
    while (randIdx === currentIndex) {
      randIdx = Math.floor(Math.random() * sentences.length);
    }
    handleSelectSentence(randIdx);
  };

  const handleResetProgress = () => {
    if (window.confirm("Bạn có chắc chắn muốn xóa tất cả tiến trình học của video này?")) {
      setProgress({});
      if (videoDetails) {
        localStorage.removeItem(`progress_${videoDetails.videoId}`);
      }
    }
  };

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Calculate stats
  const completedCount = Object.keys(progress).filter((key) => (progress[Number(key)] || 0) >= 90).length;
  const progressValues = Object.values(progress) as number[];
  const averageAccuracy = progressValues.length > 0
    ? Math.round(
        progressValues.reduce((a, b) => a + b, 0) / progressValues.length
      )
    : 0;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 flex flex-col font-sans" id="app-root-container">
      <Header onGoHome={() => {
        setVideoDetails(null);
        setSentences([]);
        setEvaluationResult(null);
        setUserInput("");
      }} />

      <main className="flex-1 py-3 px-2 sm:px-4 md:px-6 max-w-[1700px] w-full mx-auto flex flex-col gap-5">
        <AnimatePresence mode="wait">
          {!videoDetails ? (
            /* ================= LOADING & LANDING CONFIG SCREEN ================= */
            <motion.div
              key="landing"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="max-w-3xl mx-auto w-full flex flex-col gap-4 sm:gap-8 py-2 sm:py-4 pb-28"
              id="landing-screen"
            >
              <div className="text-center flex flex-col items-center">
                <div className="hidden sm:inline-flex p-3 bg-rose-500/10 border border-rose-500/20 text-rose-600 rounded-2xl mb-4">
                  <Youtube size={36} />
                </div>
                <h2 className="text-xl sm:text-3xl font-extrabold text-slate-900 tracking-tight font-display">
                  Luyện nghe chính tả YouTube
                </h2>
                <p className="mt-1 sm:mt-3 text-slate-500 max-w-lg leading-relaxed text-xs sm:text-sm font-medium hidden sm:block">
                  Chép chính tả là phương pháp đột phá để nâng cao phản xạ nghe hiểu ngôn ngữ. Dán một URL video YouTube có phụ đề và bắt đầu rèn luyện ngay!
                </p>
              </div>

              {/* Submission panel */}
              <div className="bg-white border-2 border-slate-200 rounded-2xl sm:rounded-3xl shadow-sm relative overflow-hidden" id="submission-panel">
                <div className="absolute top-0 right-0 w-48 h-48 bg-blue-500/5 rounded-full blur-3xl pointer-events-none"></div>

                <div className="p-4 sm:p-6 flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="youtube-url-input" className="text-xs font-bold text-slate-500 uppercase tracking-wider font-display">
                      Địa chỉ URL của video YouTube:
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                        <Youtube size={18} />
                      </div>
                      <input
                        id="youtube-url-input"
                        type="text"
                        placeholder="Ví dụ: https://www.youtube.com/watch?v=1X3MQFsGCd4"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        disabled={isLoading}
                        className="w-full pl-10 pr-4 py-2.5 sm:py-3.5 bg-slate-50 border-2 border-slate-200 focus:border-blue-500 focus:bg-white rounded-xl text-slate-800 placeholder-slate-400 outline-none transition-all text-xs sm:text-sm font-mono font-medium"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <label htmlFor="pasted-text-input" className="text-xs font-bold text-slate-500 uppercase tracking-wider font-display">
                          Dán văn bản phụ đề thô (Không bắt buộc):
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const prompt = `Hãy trích xuất toàn bộ phụ đề (tiếng Anh hoặc ngôn ngữ gốc) của video YouTube trong link này (hoặc từ video bạn vừa xem) và chia thành các phân đoạn ngắn thích hợp để luyện nghe chép chính tả (dictation).

Quy tắc quan trọng:
1. CHIA NHỎ CÂU: Mỗi phân đoạn CHỈ NÊN DÀI TỪ 3 ĐẾN 8 GIÂY (tối đa 6 - 12 từ). NẾU CÂU QUÁ DÀI hoặc là câu ghép chứa các mệnh đề nối như "where", "and", "but", "so", "because", "when", v.v. -> BẮT BUỘC TÁCH THÀNH CÁC MỆNH ĐỀ NHỎ RIÊNG BIỆT để người học dễ tập viết.
2. PHẢI PHỦ TOÀN BỘ THỜI LƯỢNG VIDEO & KHÔNG ĐƯỢC CẮT BỎ ĐOẠN LẶP LẠI:
   - Xử lý ĐẦY ĐỦ 100% tất cả các lời hát/lời thoại từ đầu (0:00) cho tới CUỐI VIDEO.
   - TUYỆT ĐỐI KHÔNG ĐƯỢC dừng sớm ở lần lặp 1 hay cắt ngắn bài hát/video (ví dụ: video/bài hát 4 phút KHÔNG được tự ý dừng ở 1:46). BẮT BUỘC phân đoạn đầy đủ tất cả các lần lặp lại của điệp khúc, lời hát, lời thoại kéo dài tới mốc kết thúc thực tế của video.
   - Chỉ bỏ qua các quãng nghỉ hoàn toàn là nhạc không lời (instrumental breaks) không có lời hát/lời thoại.
3. MỐC THỜI GIAN CHÍNH XÁC CHUẨN TỪNG MILI GIÂY (KHÔNG ĐƯỢC ĐỂ LÀ .00):
   - Mốc thời gian BẮT BUỘC có số thực thập phân lẻ đến từng mili giây (ví dụ: 0:10.45 - 0:18.12).
   - TUYỆT ĐỐI KHÔNG ĐƯỢC làm tròn thành số nguyên hoặc tròn giây .00 (như 0:10.00 hay 0:18.00) để đảm bảo audio phát khớp từng mili giây.
4. DỊCH SANG TIẾNG VIỆT: Kèm theo bản dịch nghĩa tiếng Việt chuẩn xác cho từng phân đoạn (nối sau dấu gạch đứng | hoặc ghi trong ngoặc tròn).

Ví dụ định dạng đầu ra chuẩn:
(0:10.45 - 0:18.12): I just woke up from my dream where you and I had to say goodbye | Dịch: Tôi vừa tỉnh dậy sau giấc mơ nơi bạn và tôi phải nói lời tạm biệt
(0:18.12 - 0:23.50): and I don't know what it all means | Dịch: và tôi không biết tất cả điều này có nghĩa là gì
(0:23.50 - 0:28.05): but since I survived I realized | Dịch: nhưng từ khi tôi sống sót tôi mới nhận ra`;
                            navigator.clipboard.writeText(prompt);
                            setIsCopied(true);
                            setTimeout(() => setIsCopied(false), 2000);
                          }}
                          className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border transition-colors ${
                            isCopied 
                              ? "bg-emerald-50 text-emerald-600 border-emerald-200" 
                              : "bg-amber-50 text-amber-600 hover:text-amber-700 border-amber-200"
                          }`}
                        >
                          {isCopied ? <Check size={12} /> : <Clipboard size={12} />}
                          <span>{isCopied ? "Đã sao chép" : "Copy mẫu Prompt cho Gemini"}</span>
                        </button>
                      </div>
                      <textarea
                        id="pasted-text-input"
                        rows={4}
                        placeholder="Dán văn bản phụ đề thô ở đây.&#10;&#10;Hỗ trợ nhận dạng tự động:&#10;(0:10.45 - 0:18.12): I just woke up from my dream..."
                        value={pastedText}
                        onChange={(e) => setPastedText(e.target.value)}
                        disabled={isLoading}
                        className="w-full p-2.5 sm:p-3.5 bg-slate-50 border-2 border-slate-200 focus:border-blue-500 focus:bg-white rounded-xl text-slate-800 placeholder-slate-400 outline-none transition-all text-xs sm:text-sm font-medium leading-relaxed resize-none"
                      />
                    </div>

                    <button
                      id="load-video-button-text"
                      onClick={() => handleLoadVideo(urlInput, undefined, pastedText)}
                      disabled={isLoading || !urlInput.trim()}
                      className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-sm transition-all shadow-md shadow-blue-600/10 active:scale-95 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none disabled:active:scale-100 flex items-center justify-center gap-2"
                    >
                      <Search size={16} />
                      <span>Xử lý & Tải video</span>
                    </button>
                  </div>

                  {error && (
                    <div className="mt-2 bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-600 flex flex-col gap-2.5 font-medium">
                      <div className="flex items-start gap-2.5">
                        <Info size={16} className="shrink-0 mt-0.5 text-rose-500" />
                        <div>
                          <p className="font-bold">Lỗi</p>
                          <p className="text-xs text-rose-500/90 mt-1">{error}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Loader overlay */}
              {isLoading && (
                <div className="bg-white border-2 border-slate-200 rounded-3xl p-8 text-center shadow-md flex flex-col items-center justify-center min-h-[250px]" id="loading-state-box">
                  <div className="relative flex items-center justify-center w-16 h-16 mb-4">
                    <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-t-blue-500 rounded-full animate-spin"></div>
                  </div>
                  <h3 className="text-slate-900 font-bold font-display text-lg">Đang thiết lập lớp học của bạn...</h3>
                  
                  {/* Dynamic stepping feedback */}
                  <div className="h-6 overflow-hidden mt-2 max-w-sm w-full">
                    <AnimatePresence mode="wait">
                      <motion.p
                        key={loadingStep}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="text-blue-600 text-sm font-bold font-mono"
                      >
                        {loadingMessages[loadingStep]}
                      </motion.p>
                    </AnimatePresence>
                  </div>
                  <p className="text-slate-400 text-xs mt-3 font-medium">Quá trình này chỉ diễn ra một lần duy nhất nhờ lưu trữ đám mây.</p>
                </div>
              )}

              {/* Recommended Videos list */}
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-4">
                  <BookOpen className="text-blue-500" size={18} />
                  <h3 className="text-lg font-bold text-slate-800 font-display">Gợi ý video thực hành chất lượng cao</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {RECOMMENDED_VIDEOS.map((video, idx) => (
                    <button
                      key={idx}
                      id={`recommend-video-item-${idx}`}
                      onClick={() => {
                        setUrlInput(video.url);
                        handleLoadVideo(video.url);
                      }}
                      className="bg-white hover:bg-slate-50 border-2 border-slate-200/80 p-5 rounded-2xl text-left transition-all hover:border-slate-300 hover:scale-[1.01] flex flex-col justify-between shadow-sm group"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-bold font-mono tracking-wider text-slate-400 uppercase">
                            {video.category}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                            video.language === "vi" 
                              ? "bg-red-50 text-red-600 border-red-200" 
                              : "bg-blue-50 text-blue-600 border-blue-200"
                          }`}>
                            {video.language === "vi" ? "TIẾNG VIỆT" : "TIẾNG ANH"}
                          </span>
                        </div>
                        <h4 className="text-slate-800 font-bold text-sm leading-snug group-hover:text-blue-600 transition-colors font-display">
                          {video.title}
                        </h4>
                      </div>
                      <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between w-full text-xs text-slate-500 font-medium">
                        <span>Tác giả: {video.author}</span>
                        <ChevronRight size={14} className="text-slate-400 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Recent History */}
              {history.length > 0 && (
                <div className="mt-4 border-t-2 border-slate-200/60 pt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <History className="text-slate-500" size={18} />
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider font-display">Lịch sử luyện tập gần đây</h3>
                  </div>
                  <div className="bg-white border-2 border-slate-200 rounded-2xl divide-y divide-slate-100 shadow-sm overflow-hidden">
                    {history.map((hist, idx) => (
                      <div
                        key={hist.videoId || idx}
                        className="flex items-center justify-between p-3.5 hover:bg-slate-50 transition-colors group"
                      >
                        <button
                          id={`history-item-${idx}`}
                          onClick={() => {
                            if (hist.sentences && hist.sentences.length > 0 && hist.videoDetails) {
                              setUrlInput(`https://www.youtube.com/watch?v=${hist.videoId}`);
                              setVideoDetails(hist.videoDetails);
                              setSentences(hist.sentences);
                              setCurrentIndex(0);
                              setError(null);
                              setIsLoading(false);
                              setUserInput("");
                              setEvaluationResult(null);
                            } else {
                              setUrlInput(`https://www.youtube.com/watch?v=${hist.videoId}`);
                              handleLoadVideo(`https://www.youtube.com/watch?v=${hist.videoId}`);
                            }
                          }}
                          className="flex-1 flex items-center justify-between text-left text-xs min-w-0 mr-3"
                        >
                          <div className="flex items-center gap-2.5 truncate max-w-md sm:max-w-xl">
                            <Youtube size={14} className="text-rose-500 shrink-0" />
                            <span className="text-slate-700 group-hover:text-blue-600 truncate font-semibold">{hist.title}</span>
                          </div>
                          <div className="text-slate-400 text-[10px] font-mono shrink-0 font-bold ml-2">
                            {hist.date}
                          </div>
                        </button>

                        <button
                          id={`delete-history-item-${idx}`}
                          onClick={(e) => handleDeleteHistoryItem(hist.videoId, e)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors shrink-0"
                          title="Xóa video này khỏi lịch sử nghe"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          ) : isMobile ? (
            /* ================= MOBILE ACTIVE DICTATION INTERFACE ================= */
            <motion.div
              key="dictation-interface-mobile"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-2 max-w-lg mx-auto w-full pb-20"
              id="active-dictation-screen-mobile"
            >
              {/* Sticky YouTube Player at the top */}
              <div className="sticky top-0 z-40 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm" id="mobile-player-container">
                {videoDetails && sentences[currentIndex] && (
                  <div className="p-0.5 bg-slate-900">
                    <YoutubePlayer
                      videoId={videoDetails.videoId}
                      start={sentences[currentIndex].start}
                      end={sentences[currentIndex].end}
                      padding={padding}
                      playTrigger={playTrigger}
                      currentSentenceText={sentences[currentIndex]?.sentence}
                    />
                  </div>
                )}
              </div>

              {/* Compact Video Info & Progress Bar */}
              <div className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-xs flex items-center justify-between text-xs gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <h3 className="text-slate-800 text-[11px] font-bold truncate flex-1" title={videoDetails.title}>
                    {videoDetails.title}
                  </h3>
                  <span className="text-[10px] font-mono font-bold text-blue-600 shrink-0 bg-blue-50 px-1.5 py-0.5 rounded">
                    {completedCount}/{sentences.length} ({averageAccuracy}%)
                  </span>
                </div>
                <button
                  id="change-video-button-mobile"
                  onClick={() => {
                    setVideoDetails(null);
                    setSentences([]);
                    setEvaluationResult(null);
                    setUserInput("");
                  }}
                  className="text-[10px] font-bold text-blue-600 hover:text-blue-500 flex items-center gap-0.5 shrink-0 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded cursor-pointer"
                >
                  <ArrowLeft size={10} />
                  <span>Đổi Video</span>
                </button>
              </div>

              {/* Playground & Dictation Card */}
              <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex flex-col gap-2.5">
                {/* Header line: Sentence number + Controls + Padding */}
                <div className="flex items-center justify-between gap-1 pb-1.5 border-b border-slate-100 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="w-6 h-6 rounded bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center font-mono font-extrabold text-xs">
                      {sentences[currentIndex]?.id}
                    </span>
                    <span className="text-slate-800 font-bold text-xs font-display">
                      Câu {sentences[currentIndex]?.id}/{sentences.length}
                    </span>
                    <span className="text-slate-400 text-[9px] font-mono">
                      ({sentences[currentIndex]?.start.toFixed(1)}s-{sentences[currentIndex]?.end.toFixed(1)}s)
                    </span>
                  </div>

                  <div className="flex items-center gap-1 flex-wrap justify-end">
                    {/* Padding selector */}
                    <div className="flex gap-0.5 items-center mr-1">
                      <span className="text-[9px] text-slate-400 font-mono">Đệm:</span>
                      {[0, 1, 2].map((s) => (
                        <button
                          key={s}
                          id={`padding-select-btn-mobile-${s}`}
                          onClick={() => setPadding(s)}
                          className={`px-1 py-0.5 rounded text-[9px] font-mono font-bold transition-colors cursor-pointer ${
                            padding === s
                              ? "bg-blue-600 text-white"
                              : "text-slate-500 bg-slate-50 border border-slate-200"
                          }`}
                        >
                          +{s}s
                        </button>
                      ))}
                    </div>

                    {/* Show Translation Toggle Mobile */}
                    <button
                      id="toggle-show-translation-button-mobile"
                      onClick={toggleShowTranslationBefore}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer border ${
                        showTranslationBefore
                          ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                          : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
                      }`}
                      title={showTranslationBefore ? "Hiện bản dịch trước: BẬT" : "Hiện bản dịch trước: TẮT"}
                    >
                      <Languages size={11} />
                      <span>Dịch TV {showTranslationBefore ? "ON" : "OFF"}</span>
                    </button>

                    {/* Random Mode Toggle Mobile */}
                    <button
                      id="toggle-random-mode-button-mobile"
                      onClick={toggleRandomMode}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer border ${
                        isRandomMode
                          ? "bg-purple-600 text-white border-purple-600 shadow-xs"
                          : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
                      }`}
                      title={isRandomMode ? "Chế độ ngẫu nhiên: BẬT" : "Chế độ ngẫu nhiên: TẮT"}
                    >
                      <Shuffle size={11} />
                      <span>Ngẫu nhiên {isRandomMode ? "ON" : "OFF"}</span>
                    </button>

                    {/* Add Vocabulary Button */}
                    <button
                      id="add-vocab-appwrite-button-mobile"
                      onClick={() => handleOpenAddVocab("", sentences[currentIndex]?.sentence || "")}
                      className="flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200/80 rounded-lg text-[10px] font-bold cursor-pointer"
                    >
                      <BookmarkPlus size={11} className="text-indigo-600" />
                      <span>Từ vựng</span>
                    </button>
                  </div>
                </div>

                {/* Optional Preview Translation Before Answering */}
                {showTranslationBefore && sentences[currentIndex]?.vietnamese && (
                  <div className="bg-indigo-50/95 border border-indigo-200/90 rounded-lg p-2.5 text-xs text-indigo-950 shadow-xs flex items-start gap-2">
                    <Languages size={15} className="text-indigo-600 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <span className="font-bold text-indigo-900 text-[10px] uppercase font-mono tracking-wider block">
                        Bản dịch Tiếng Việt (Xem trước):
                      </span>
                      <p className="font-semibold text-indigo-950 text-xs mt-0.5 leading-snug">
                        "{sentences[currentIndex].vietnamese}"
                      </p>
                    </div>
                  </div>
                )}

                {/* Text Editor */}
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <label htmlFor="dictation-textarea-mobile" className="text-slate-600 font-bold">
                      Gõ câu bạn nghe được <span className="text-blue-600 font-mono">(Enter để nộp)</span>:
                    </label>
                    <span className="text-slate-400 font-mono">{userInput.length} ký tự</span>
                  </div>

                  <textarea
                    ref={mobileTextareaRef}
                    id="dictation-textarea-mobile"
                    placeholder="Nhập câu bạn nghe được... (Enter để nộp/chuyển câu)"
                    value={userInput}
                    onChange={(e) => handleInputChange(e.target.value)}
                    onFocus={() => {
                      setTimeout(() => {
                        const el = document.getElementById("dictation-textarea-mobile");
                        if (el) {
                          el.scrollIntoView({ behavior: "smooth", block: "center" });
                        }
                      }, 250);
                    }}
                    onKeyDown={handleInputKeyDown}
                    readOnly={isEvaluating}
                    rows={2}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 focus:border-blue-500 focus:bg-white rounded-lg text-slate-800 placeholder-slate-400 outline-none transition-all resize-none text-xs leading-relaxed"
                  />
                </div>

                {/* Action controls */}
                <div className="flex justify-between items-center gap-2 pt-0.5">
                  <div className="flex items-center gap-1">
                    <button
                      id="prev-sentence-button-mobile"
                      disabled={currentIndex === 0}
                      onClick={handlePrev}
                      className="p-2 bg-white border border-slate-200 disabled:bg-slate-50 disabled:text-slate-300 text-slate-600 rounded-lg transition-all flex items-center justify-center cursor-pointer"
                    >
                      <ArrowLeft size={13} />
                    </button>

                    <button
                      id="play-audio-helper-button-mobile"
                      onClick={triggerPlay}
                      className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all shadow-xs uppercase cursor-pointer"
                    >
                      <Volume2 size={12} />
                      <span>Phát</span>
                    </button>

                    <button
                      id="next-sentence-button-mobile"
                      disabled={currentIndex === sentences.length - 1}
                      onClick={handleNext}
                      className="p-2 bg-white border border-slate-200 disabled:bg-slate-50 disabled:text-slate-300 text-slate-600 rounded-lg transition-all flex items-center justify-center cursor-pointer"
                    >
                      <ArrowRight size={13} />
                    </button>
                  </div>

                  <button
                    id="submit-check-button-mobile"
                    disabled={isEvaluating || !userInput.trim()}
                    onClick={handleCheck}
                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-xs transition-all shadow-xs flex items-center justify-center gap-1 uppercase cursor-pointer"
                  >
                    <Check size={12} />
                    <span>Kiểm Tra</span>
                  </button>
                </div>
              </div>

              {/* Feedback results */}
              <AnimatePresence mode="wait">
                {(evaluationResult || isEvaluating) && (
                  <FeedbackCard
                    result={evaluationResult}
                    isEvaluating={isEvaluating}
                    currentSentenceTranslation={sentences[currentIndex]?.vietnamese}
                    onRetry={() => {
                      setEvaluationResult(null);
                      setUserInput("");
                      triggerPlay();
                    }}
                  />
                )}
              </AnimatePresence>

              {/* Info Note on Gemini accuracy */}
              <div className="bg-slate-100/60 border border-slate-200/80 rounded-xl p-3 flex gap-2.5 text-[10px] text-slate-500 shadow-xs">
                <Sparkles size={14} className="text-blue-500 shrink-0 mt-0.5" />
                <p className="leading-normal font-medium">
                  Hệ thống phân tích sâu sắc từ loại và lỗi chính tả bằng AI Gemini 2.0 Flash.
                </p>
              </div>

              {/* Sentence list scroll area */}
              <div className="bg-white border-2 border-slate-200 rounded-2xl overflow-hidden shadow-sm flex flex-col" id="mobile-sentence-list-card">
                <div className="max-h-[280px] overflow-y-auto p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between px-1 pb-1.5 border-b border-slate-100 flex-wrap gap-1">
                    <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold font-mono">Danh sách câu ({sentences.length})</span>
                    {selectedSentenceIds.length >= 2 && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={handleMergeSentences}
                          className="flex items-center gap-1 px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-bold shadow-xs cursor-pointer"
                        >
                          <Layers size={10} />
                          <span>Gộp {selectedSentenceIds.length} câu</span>
                        </button>
                        <button
                          onClick={() => setSelectedSentenceIds([])}
                          className="px-1 text-[9px] text-slate-400 hover:text-slate-600"
                        >
                          Hủy
                        </button>
                      </div>
                    )}
                  </div>

                  {sentences.map((sentence, idx) => {
                    const score = progress[sentence.id];
                    const isCurrent = idx === currentIndex;
                    const isSelected = selectedSentenceIds.includes(sentence.id);
                    
                    return (
                      <div
                        key={sentence.id}
                        id={`sentence-list-btn-mobile-${idx}`}
                        className={`w-full p-2.5 rounded-xl text-left transition-all border-2 flex items-start gap-2 ${
                          isCurrent
                            ? "bg-blue-50 border-blue-500/60 text-slate-900 shadow-xs"
                            : isSelected
                            ? "bg-indigo-50 border-indigo-300 text-slate-900"
                            : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                        }`}
                      >
                        {/* Checkbox */}
                        <button
                          type="button"
                          onClick={(e) => handleToggleSelectSentence(sentence.id, e)}
                          className="mt-0.5 text-slate-400 hover:text-indigo-600 shrink-0 cursor-pointer"
                          title="Tích chọn để gộp câu"
                        >
                          {isSelected ? (
                            <CheckSquare size={14} className="text-indigo-600" />
                          ) : (
                            <Square size={14} className="text-slate-300" />
                          )}
                        </button>

                        <div
                          onClick={() => handleSelectSentence(idx)}
                          className="flex-1 min-w-0 cursor-pointer"
                        >
                          <div className="flex items-center gap-1 flex-wrap">
                            {sentence.isMerged ? (
                              <span className="px-1 py-0.2 bg-indigo-100 text-indigo-700 border border-indigo-200 rounded text-[8px] font-bold font-mono">
                                [Đã gộp]
                              </span>
                            ) : (
                              <div className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 text-[9px] font-mono font-extrabold ${
                                isCurrent
                                  ? "bg-blue-600 text-white"
                                  : "bg-slate-100 text-slate-400 border border-slate-200/50"
                              }`}>
                                {sentence.id}
                              </div>
                            )}

                            <p className={`text-[11px] leading-normal truncate flex-1 ${
                              isCurrent ? "font-bold text-slate-900" : "text-slate-500"
                            }`}>
                              {sentence.sentence}
                            </p>
                          </div>

                          <div className="flex items-center justify-between mt-1 text-[8px] font-mono text-slate-400 font-semibold gap-1">
                            <span className="flex items-center gap-0.5">
                              <Clock size={8} />
                              {sentence.start.toFixed(1)}s-{sentence.end.toFixed(1)}s
                            </span>
                            
                            <div className="flex items-center gap-1">
                              {score !== undefined && (
                                <span className={`font-bold px-1.5 py-0.2 rounded border ${
                                  score >= 90 ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-blue-50 text-blue-600 border-blue-100"
                                }`}>
                                  {score}%
                                </span>
                              )}

                              {sentence.isMerged && (
                                <button
                                  type="button"
                                  onClick={(e) => handleUnmergeSentence(sentence, e)}
                                  className="flex items-center gap-0.5 px-1 py-0.2 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[8px] font-bold"
                                  title="Tách lại câu gốc"
                                >
                                  <Scissors size={8} />
                                  <span>Tách</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={(e) => handleOpenEditSentence(sentence, e)}
                                className="p-0.5 text-slate-400 hover:text-blue-600 rounded"
                                title="Chỉnh sửa câu"
                              >
                                <Edit3 size={10} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          ) : (
            /* ================= ACTIVE DICTATION INTERFACE ================= */
            <motion.div
              key="dictation-interface"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start"
              id="active-dictation-screen"
            >
              {/* LEFT COLUMN: Dictation Workspace & Editor (6 columns) */}
              <div className="lg:col-span-6 flex flex-col gap-5" id="dictation-workspace">
                
                {/* 1. Playground & Dictation Card */}
                <div className="bg-white border-2 border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col gap-5 relative">
                  
                  {/* Cushion settings & randomizer heading */}
                  <div className="flex justify-between items-center flex-wrap gap-2 pb-3.5 border-b-2 border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center font-mono font-extrabold text-sm shadow-sm">
                        {sentences[currentIndex]?.id}
                      </span>
                      <div>
                        <h4 className="text-slate-800 font-bold font-display text-sm">
                          Câu {sentences[currentIndex]?.id} / {sentences.length}
                        </h4>
                        <p className="text-slate-400 text-[10px] font-mono font-medium">
                          Khoảng thời gian gốc: {sentences[currentIndex]?.start.toFixed(1)}s đến {sentences[currentIndex]?.end.toFixed(1)}s
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Cushion / Padding configuration */}
                      <div className="flex items-center gap-2 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-xl">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Độ đệm:</span>
                        <div className="flex gap-1">
                          {[0, 1, 2].map((s) => (
                            <button
                              key={s}
                              id={`padding-select-btn-${s}`}
                              onClick={() => setPadding(s)}
                              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-colors ${
                                padding === s
                                  ? "bg-blue-600 text-white"
                                  : "text-slate-500 hover:text-slate-800 hover:bg-white"
                              }`}
                              title={`Đệm thêm ${s} giây trước và sau đoạn nghe`}
                            >
                              +{s}s
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Show Vietnamese Translation Toggle */}
                      <button
                        id="toggle-show-translation-button"
                        onClick={toggleShowTranslationBefore}
                        className={`flex items-center gap-1.5 px-3 py-2 border rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-95 ${
                          showTranslationBefore
                            ? "bg-emerald-600 text-white border-emerald-600 shadow-emerald-600/20"
                            : "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200"
                        }`}
                        title="Xem trước bản dịch tiếng Việt của câu hiện tại trước khi trả lời"
                      >
                        <Languages size={14} />
                        <span>Hiện dịch Tiếng Việt: {showTranslationBefore ? "BẬT" : "TẮT"}</span>
                      </button>

                      {/* Random Mode Toggle Switch */}
                      <button
                        id="toggle-random-mode-button"
                        onClick={toggleRandomMode}
                        className={`flex items-center gap-1.5 px-3 py-2 border rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-95 ${
                          isRandomMode
                            ? "bg-purple-600 text-white border-purple-600 shadow-purple-600/20"
                            : "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200"
                        }`}
                        title="Khi BẬT, tự động nhảy sang câu ngẫu nhiên sau khi hoàn thành 100% hoặc bấm Chuyển câu"
                      >
                        <Shuffle size={13} />
                        <span>Chế độ ngẫu nhiên: {isRandomMode ? "BẬT" : "TẮT"}</span>
                      </button>

                      {/* Add Vocabulary to Appwrite Button */}
                      <button
                        id="add-vocab-appwrite-button"
                        onClick={() => handleOpenAddVocab("", sentences[currentIndex]?.sentence || "")}
                        className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95"
                        title="Lưu từ vựng mới trong câu này vào Appwrite Cloud (Database của Learning-English-App)"
                      >
                        <BookmarkPlus size={14} className="text-indigo-600" />
                        <span>+ Thêm từ vựng (Appwrite)</span>
                      </button>
                    </div>
                  </div>

                  {/* Dictation prompt instructions */}
                  <div className="bg-blue-50/60 border border-blue-100 rounded-2xl p-4 text-xs text-blue-800 flex items-start gap-2.5 shadow-sm">
                    <Info size={14} className="shrink-0 mt-0.5 text-blue-500" />
                    <div>
                      <p className="font-bold font-display">Hướng dẫn luyện tập:</p>
                      <p className="mt-0.5 text-slate-600 leading-normal font-medium">
                        1. Bấm nút <strong className="text-blue-600 font-bold">"Phát Audio"</strong> bên dưới để nghe kỹ câu gốc. Bạn cũng có thể theo dõi video trực tiếp ở khung bên phải!
                      </p>
                      <p className="mt-0.5 text-slate-600 leading-normal font-medium">
                        2. Nhập chính xác những gì nghe được vào khung soạn thảo bên dưới, sau đó bấm <strong className="text-blue-600 font-bold">"Kiểm tra"</strong> để so khớp bằng Trí Tuệ Nhân Tạo.
                      </p>
                    </div>
                  </div>

                  {videoDetails?.isRestored && (
                    <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-4 text-xs text-indigo-900 flex items-start gap-2.5 shadow-sm">
                      <Sparkles size={14} className="shrink-0 mt-0.5 text-indigo-500 animate-pulse" />
                      <div>
                        <p className="font-bold font-display">Chế độ AI Khôi Phục (Do YouTube Chặn):</p>
                        <p className="mt-0.5 text-indigo-950/80 leading-normal font-medium">
                          Do YouTube hạn chế quyền truy xuất phụ đề trực tiếp từ máy chủ đám mây, <strong>Trí Tuệ Nhân Tạo Gemini</strong> đã chủ động tái tạo bài nghe chính tả hoàn chỉnh liên quan mật thiết đến chủ đề hoặc nội dung gốc của bài nói này.
                        </p>
                        <p className="mt-1 text-indigo-950/80 leading-normal font-medium">
                          Khung hình video ở bên phải được giữ nguyên để bạn theo dõi trực quan và tự điều chỉnh rhythm luyện tập nhé!
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Preview Translation Before Answering */}
                  {showTranslationBefore && sentences[currentIndex]?.vietnamese && (
                    <div className="bg-indigo-50/95 border-2 border-indigo-200/90 rounded-2xl p-4 text-xs text-indigo-950 shadow-sm flex items-start gap-3">
                      <Languages size={18} className="text-indigo-600 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <span className="font-bold text-indigo-900 text-xs uppercase font-mono tracking-wider block mb-0.5">
                          Bản dịch Tiếng Việt (Chế độ hiện trước):
                        </span>
                        <p className="font-semibold text-indigo-950 text-base leading-relaxed">
                          "{sentences[currentIndex].vietnamese}"
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Text Editor Section */}
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center text-xs">
                      <label htmlFor="dictation-textarea" className="text-slate-700 font-bold font-display">
                        Khung soạn thảo chép chính tả <span className="text-[11px] text-blue-600 font-medium font-mono ml-1">(Nhấn Enter để nộp nhanh)</span>:
                      </label>
                      <span className="text-slate-400 font-mono font-semibold">{userInput.length} ký tự</span>
                    </div>

                    <textarea
                      ref={desktopTextareaRef}
                      id="dictation-textarea"
                      placeholder="Hãy gõ lại câu bạn nghe được tại đây... (Nhấn Enter để kiểm tra đáp án, Enter phát nữa để sang câu kế tiếp, Shift + Enter để xuống dòng)"
                      value={userInput}
                      onChange={(e) => handleInputChange(e.target.value)}
                      onKeyDown={handleInputKeyDown}
                      readOnly={isEvaluating}
                      rows={5}
                      className="w-full p-5 bg-slate-50 border-2 border-dashed border-slate-200 focus:border-blue-500 focus:bg-white focus:ring-0 rounded-2xl text-slate-800 placeholder-slate-400 outline-none transition-all resize-none leading-relaxed text-base shadow-inner"
                    />
                  </div>

                  {/* Action row */}
                  <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-2">
                    {/* Previous / Next sentence navigation */}
                    <div className="flex items-center gap-2 w-full sm:w-auto justify-center sm:justify-start">
                      <button
                        id="prev-sentence-button"
                        disabled={currentIndex === 0}
                        onClick={handlePrev}
                        className="p-3 bg-white border-2 border-slate-200 hover:bg-slate-50 disabled:bg-slate-50 disabled:border-slate-100 text-slate-600 disabled:text-slate-300 rounded-xl transition-all hover:scale-105 active:scale-95 disabled:scale-100 flex items-center justify-center shadow-sm"
                        title="Câu trước"
                      >
                        <ArrowLeft size={16} />
                      </button>

                      <button
                        id="play-audio-helper-button"
                        onClick={triggerPlay}
                        className="flex items-center gap-1.5 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all hover:scale-105 active:scale-95 shadow-md shadow-blue-500/10 uppercase"
                      >
                        <Volume2 size={14} />
                        <span>Phát Audio</span>
                      </button>

                      <button
                        id="next-sentence-button"
                        disabled={currentIndex === sentences.length - 1}
                        onClick={handleNext}
                        className="p-3 bg-white border-2 border-slate-200 hover:bg-slate-50 disabled:bg-slate-50 disabled:border-slate-100 text-slate-600 disabled:text-slate-300 rounded-xl transition-all hover:scale-105 active:scale-95 disabled:scale-100 flex items-center justify-center shadow-sm"
                        title="Câu sau"
                      >
                        <ArrowRight size={16} />
                      </button>
                    </div>

                    {/* Check / Evaluation CTA */}
                    <button
                      id="submit-check-button"
                      disabled={isEvaluating || !userInput.trim()}
                      onClick={handleCheck}
                      className="w-full sm:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-all hover:scale-105 active:scale-95 disabled:bg-slate-100 disabled:text-slate-400 disabled:scale-100 disabled:shadow-none shadow-lg shadow-blue-600/15 flex items-center justify-center gap-2 uppercase"
                    >
                      <Check size={14} />
                      <span>Kiểm Tra Đáp Án</span>
                    </button>
                  </div>
                </div>

                {/* 2. Feedback results */}
                <AnimatePresence mode="wait">
                  {(evaluationResult || isEvaluating) && (
                    <FeedbackCard
                      result={evaluationResult}
                      isEvaluating={isEvaluating}
                      currentSentenceTranslation={sentences[currentIndex]?.vietnamese}
                      onRetry={() => {
                        setEvaluationResult(null);
                        setUserInput("");
                        triggerPlay();
                      }}
                    />
                  )}
                </AnimatePresence>

                {/* Info Note on Gemini accuracy */}
                <div className="bg-slate-100/60 border border-slate-200/80 rounded-2xl p-4 flex gap-3 text-xs text-slate-500 shadow-sm">
                  <Sparkles size={16} className="text-blue-500 shrink-0 mt-0.5" />
                  <p className="leading-normal font-medium">
                    Trình kiểm tra sử dụng công nghệ chấm điểm của <strong>Gemini 2.0 Flash</strong>. Hệ thống phân tích sâu sắc cấu trúc ngữ pháp, từ loại, phân tách các lỗi chính tả vô hại so với lỗi ngữ nghĩa, đem lại lời khuyên thực chất có giá trị sư phạm cao nhất.
                  </p>
                </div>

              </div>

              {/* RIGHT COLUMN: Video Player & Sentence Navigation (6 columns, sticky on desktop) */}
              <div className="lg:col-span-6 flex flex-col gap-5 lg:sticky lg:top-4 h-fit" id="sidebar-panel-right">
                
                {/* Video Header Detail & Stats Card */}
                <div className="bg-white border-2 border-slate-200 rounded-3xl overflow-hidden shadow-sm flex flex-col" id="video-card-right">
                  <div className="p-4 bg-slate-50 border-b-2 border-slate-100 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <img
                        src={videoDetails.thumbnailUrl}
                        alt={videoDetails.title}
                        className="w-14 h-10 object-cover rounded-lg border border-slate-200 shrink-0"
                      />
                      <div className="min-w-0">
                        <h3 className="text-slate-800 text-xs font-bold font-display leading-tight truncate" title={videoDetails.title}>
                          {videoDetails.title}
                        </h3>
                        <p className="text-slate-500 text-[10px] font-medium mt-0.5 truncate">
                          Kênh: {videoDetails.author}
                        </p>
                      </div>
                    </div>
                    <button
                      id="change-video-button"
                      onClick={() => {
                        setVideoDetails(null);
                        setSentences([]);
                        setEvaluationResult(null);
                        setUserInput("");
                      }}
                      className="text-[10px] font-bold text-blue-600 hover:text-blue-500 flex items-center gap-1 hover:underline shrink-0 bg-white border border-slate-200 px-2 py-1 rounded-lg shadow-xs"
                    >
                      <ArrowLeft size={10} />
                      <span>Đổi Video</span>
                    </button>
                  </div>

                  {/* Micro Stats Card */}
                  <div className="p-3 bg-slate-50/50 border-b-2 border-slate-100 flex items-center justify-around text-center text-xs">
                    <div>
                      <span className="text-slate-400 block text-[9px] font-bold uppercase tracking-wider font-mono">Đã đạt ≥90%</span>
                      <strong className="text-blue-600 font-mono text-sm font-bold">
                        {completedCount} / {sentences.length}
                      </strong>
                    </div>
                    <div className="w-px h-6 bg-slate-200"></div>
                    <div>
                      <span className="text-slate-400 block text-[9px] font-bold uppercase tracking-wider font-mono">Điểm trung bình</span>
                      <strong className="text-emerald-600 font-mono text-sm font-bold">
                        {averageAccuracy}%
                      </strong>
                    </div>
                    <div className="w-px h-6 bg-slate-200"></div>
                    <button
                      id="reset-progress-button"
                      onClick={handleResetProgress}
                      className="p-1 rounded text-slate-400 hover:text-slate-600 transition-colors"
                      title="Xóa tiến trình video này"
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>

                  {/* YouTube Player (Positioned directly on the Right side) */}
                  {videoDetails && sentences[currentIndex] && (
                    <div className="p-1 bg-slate-900 border-b-2 border-slate-100">
                      <YoutubePlayer
                        videoId={videoDetails.videoId}
                        start={sentences[currentIndex].start}
                        end={sentences[currentIndex].end}
                        padding={padding}
                        playTrigger={playTrigger}
                        currentSentenceText={sentences[currentIndex]?.sentence}
                      />
                    </div>
                  )}

                  {/* Sentence list scroll area */}
                  <div className="max-h-[380px] overflow-y-auto p-3 flex flex-col gap-2" id="sentence-scroll-list">
                    <div className="flex items-center justify-between px-2 pb-1.5 border-b border-slate-100 flex-wrap gap-2">
                      <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold font-mono">
                        Danh sách câu ({sentences.length})
                      </span>
                      {selectedSentenceIds.length >= 2 && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={handleMergeSentences}
                            className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-bold shadow-xs cursor-pointer transition-all animate-pulse"
                            title="Gộp các câu đã chọn thành 1 câu dài"
                          >
                            <Layers size={11} />
                            <span>Gộp {selectedSentenceIds.length} câu</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedSentenceIds([])}
                            className="px-1.5 py-1 text-[10px] text-slate-400 hover:text-slate-600 cursor-pointer font-medium"
                          >
                            Hủy
                          </button>
                        </div>
                      )}
                    </div>

                    {sentences.map((sentence, idx) => {
                      const score = progress[sentence.id];
                      const isCurrent = idx === currentIndex;
                      const isSelected = selectedSentenceIds.includes(sentence.id);
                      
                      return (
                        <div
                          key={sentence.id}
                          id={`sentence-list-btn-${idx}`}
                          className={`w-full p-3 rounded-2xl transition-all border-2 flex items-start gap-2.5 relative ${
                            isCurrent
                              ? "bg-blue-50/90 border-blue-500/70 text-slate-900 shadow-sm"
                              : isSelected
                              ? "bg-indigo-50/60 border-indigo-300 text-slate-900"
                              : "bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                          }`}
                        >
                          {/* Checkbox for selection */}
                          <button
                            type="button"
                            onClick={(e) => handleToggleSelectSentence(sentence.id, e)}
                            className="mt-0.5 text-slate-400 hover:text-indigo-600 transition-colors shrink-0 cursor-pointer"
                            title="Tích chọn để gộp câu"
                          >
                            {isSelected ? (
                              <CheckSquare size={16} className="text-indigo-600 fill-indigo-100" />
                            ) : (
                              <Square size={16} className="text-slate-300 hover:text-slate-400" />
                            )}
                          </button>

                          {/* Sentence body */}
                          <div
                            onClick={() => handleSelectSentence(idx)}
                            className="flex-1 min-w-0 cursor-pointer"
                          >
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {sentence.isMerged ? (
                                <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 border border-indigo-200 rounded text-[9px] font-bold font-mono">
                                  [Đã gộp #{sentence.id}]
                                </span>
                              ) : (
                                <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 text-[10px] font-mono font-extrabold ${
                                  isCurrent ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400 border border-slate-200/50"
                                }`}>
                                  {sentence.id}
                                </div>
                              )}

                              <p className={`text-xs leading-normal truncate flex-1 ${
                                isCurrent ? "font-bold text-slate-900" : "text-slate-500"
                              }`}>
                                {sentence.sentence}
                              </p>
                            </div>

                            <div className="flex items-center justify-between mt-1.5 text-[9px] font-mono text-slate-400 font-semibold gap-1">
                              <span className="flex items-center gap-1">
                                <Clock size={10} />
                                {sentence.start.toFixed(1)}s - {sentence.end.toFixed(1)}s ({(sentence.end - sentence.start).toFixed(1)}s)
                              </span>
                              
                              <div className="flex items-center gap-1.5">
                                {score !== undefined && (
                                  <span className={`font-bold px-1.5 py-0.2 rounded border ${
                                    score >= 90 ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-blue-50 text-blue-600 border-blue-100"
                                  }`}>
                                    Điểm: {score}%
                                  </span>
                                )}

                                {sentence.isMerged && (
                                  <button
                                    type="button"
                                    onClick={(e) => handleUnmergeSentence(sentence, e)}
                                    className="flex items-center gap-1 px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded text-[9px] font-bold transition-colors cursor-pointer"
                                    title="Tách lại thành các câu đơn gốc"
                                  >
                                    <Scissors size={10} />
                                    <span>Tách câu</span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={(e) => handleOpenEditSentence(sentence, e)}
                                  className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer"
                                  title="Chỉnh sửa nội dung và mốc thời gian"
                                >
                                  <Edit3 size={12} />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Humble Footer */}
      <footer className="py-6 border-t border-slate-200 bg-white text-center text-xs text-slate-500 mt-auto shadow-inner">
        <p>© 2026 YouTube Dictation Practice • Công cụ giáo dục số cao cấp</p>
      </footer>

      {/* Add Vocabulary Modal (Appwrite Cloud Sync) */}
      <AddVocabularyModal
        isOpen={isVocabModalOpen}
        onClose={() => setIsVocabModalOpen(false)}
        defaultWord={vocabDefaultWord}
        contextSentence={vocabContextSentence}
      />

      {/* Edit Sentence & Timestamps Modal */}
      <EditSentenceModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingSentence(null);
        }}
        sentence={editingSentence}
        onSave={handleUpdateSentence}
        onTestPlay={() => {
          setPlayTrigger((prev) => prev + 1);
        }}
      />
    </div>
  );
}

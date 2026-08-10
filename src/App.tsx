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
  Languages,
  Plus,
  PlusCircle,
  Flame,
  Cloud,
  CloudUpload,
  CloudDownload
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Header from "./components/Header";
import YoutubePlayer from "./components/YoutubePlayer";
import FeedbackCard from "./components/FeedbackCard";
import AddVocabularyModal from "./components/AddVocabularyModal";
import EditSentenceModal from "./components/EditSentenceModal";
import { RECOMMENDED_VIDEOS } from "./data";
import { Sentence, VideoDetails, EvaluationResult } from "./types";
import {
  saveVideoToFirestore,
  deleteVideoFromFirestore,
  getAllVideosFromFirestore,
  getVideoFromFirestore,
} from "./lib/firebase";

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
  const [completionCount, setCompletionCount] = useState<number>(0);
  const [isCurrentRunCompleted, setIsCurrentRunCompleted] = useState<boolean>(false);

  // Appwrite Add Vocabulary Modal states
  const [isVocabModalOpen, setIsVocabModalOpen] = useState(false);
  const [vocabDefaultWord, setVocabDefaultWord] = useState("");
  const [vocabContextSentence, setVocabContextSentence] = useState("");

  // Prompt Generator time range states
  const [promptStartMin, setPromptStartMin] = useState("0");
  const [promptEndMin, setPromptEndMin] = useState("5");

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
      // Save/Sync to Firebase Firestore Cloud DB
      saveVideoToFirestore(videoId, videoDetails, updatedSentences);
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

  const [isInsertMode, setIsInsertMode] = useState(false);

  const handleUpdateSentence = (updatedOrNew: Sentence) => {
    if (isInsertMode) {
      const refSentenceId = editingSentence?.id;
      let insertIdx = sentences.length;
      if (refSentenceId !== undefined) {
        const found = sentences.findIndex((s) => s.id === refSentenceId);
        if (found !== -1) {
          insertIdx = found + 1;
        }
      }

      const maxId = sentences.reduce((max, s) => Math.max(max, s.id), 0);
      const newSentence: Sentence = {
        id: maxId + 1,
        sentence: updatedOrNew.sentence,
        vietnamese: updatedOrNew.vietnamese,
        start: updatedOrNew.start,
        end: updatedOrNew.end,
      };

      const updatedSentences = [
        ...sentences.slice(0, insertIdx),
        newSentence,
        ...sentences.slice(insertIdx),
      ];

      setSentences(updatedSentences);
      saveSentencesForVideo(videoDetails?.videoId, updatedSentences);
      setCurrentIndex(insertIdx);
      setUserInput("");
      setEvaluationResult(null);
    } else {
      const updatedSentences = sentences.map((s) => (s.id === updatedOrNew.id ? updatedOrNew : s));
      setSentences(updatedSentences);
      saveSentencesForVideo(videoDetails?.videoId, updatedSentences);
      if (sentences[currentIndex]?.id === updatedOrNew.id) {
        setUserInput("");
        setEvaluationResult(null);
      }
    }
  };

  const handleOpenEditSentence = (s: Sentence, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingSentence(s);
    setIsInsertMode(false);
    setIsEditModalOpen(true);
  };

  const handleOpenAddSentence = (targetSentence?: Sentence, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const refSentence = targetSentence || sentences[currentIndex] || {
      id: 1,
      sentence: "",
      start: 0,
      end: 4,
    };
    setEditingSentence(refSentence);
    setIsInsertMode(true);
    setIsEditModalOpen(true);
  };

  const handleDeleteSentence = (sentenceId: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (sentences.length <= 1) {
      alert("Không thể xóa câu duy nhất còn lại.");
      return;
    }
    if (!confirm("Bạn có chắc chắn muốn xóa câu này không?")) return;

    const targetIdx = sentences.findIndex((s) => s.id === sentenceId);
    if (targetIdx === -1) return;

    const updatedSentences = sentences.filter((s) => s.id !== sentenceId);
    setSentences(updatedSentences);
    saveSentencesForVideo(videoDetails?.videoId, updatedSentences);

    if (currentIndex >= updatedSentences.length) {
      setCurrentIndex(Math.max(0, updatedSentences.length - 1));
    }
    setUserInput("");
    setEvaluationResult(null);
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
      const savedCompletions = localStorage.getItem(`completion_count_${videoDetails.videoId}`);
      const loadedCount = savedCompletions ? parseInt(savedCompletions, 10) : 0;
      setCompletionCount(isNaN(loadedCount) ? 0 : loadedCount);

      if (savedProgress) {
        try {
          const parsed = JSON.parse(savedProgress);
          setProgress(parsed);
        } catch (e) {
          setProgress({});
        }
      } else {
        setProgress({});
      }
    } else {
      setCompletionCount(0);
      setIsCurrentRunCompleted(false);
    }
  }, [videoDetails]);

  // Auto-detect when all sentences are completed for the current run
  useEffect(() => {
    if (!videoDetails || sentences.length === 0) return;

    const completedSentencesCount = sentences.filter(
      (s) => (progress[s.id] || 0) >= 90
    ).length;

    const isAllDone = completedSentencesCount === sentences.length;

    if (isAllDone) {
      if (!isCurrentRunCompleted) {
        setIsCurrentRunCompleted(true);
        setCompletionCount((prev) => {
          const nextCount = prev + 1;
          localStorage.setItem(`completion_count_${videoDetails.videoId}`, String(nextCount));
          saveVideoToFirestore(videoDetails.videoId, videoDetails, sentences, nextCount);
          return nextCount;
        });
      }
    } else {
      if (isCurrentRunCompleted) {
        setIsCurrentRunCompleted(false);
      }
    }
  }, [progress, sentences, videoDetails, isCurrentRunCompleted]);

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

      const resText = await res.text();
      let data: any;
      try {
        data = JSON.parse(resText);
      } catch (e) {
        console.error("Non-JSON response from /api/transcript:", resText);
        throw new Error("Máy chủ phản hồi định dạng không hợp lệ. Vui lòng thử lại sau giây lát.");
      }

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

        // Sync video and sub segments to Firebase Firestore Cloud DB
        saveVideoToFirestore(
          data.videoId,
          data.videoDetails || {
            videoId: data.videoId,
            title: data.title,
            author: data.author,
            thumbnailUrl: data.thumbnailUrl,
          },
          sentencesToUse
        );
      } catch (err: any) {
      console.error(err);
      setError(err.message || "Đã xảy ra lỗi không xác định. Vui lòng thử lại.");
    } finally {
      setIsLoading(false);
    }
  };

  // Delete a single video entry completely from history and localStorage
  const handleDeleteHistoryItem = (videoIdToDelete: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const updatedHistory = history.filter((h) => h.videoId !== videoIdToDelete);
    setHistory(updatedHistory);
    try {
      localStorage.setItem("youtube_dictation_history", JSON.stringify(updatedHistory));
      localStorage.removeItem(`sentences_${videoIdToDelete}`);
      localStorage.removeItem(`progress_${videoIdToDelete}`);

      // Delete from Firebase Firestore Cloud DB
      deleteVideoFromFirestore(videoIdToDelete).catch(() => {});
    } catch (err) {
      console.error("Failed to save history after deletion", err);
    }

    if (videoDetails?.videoId === videoIdToDelete) {
      setVideoDetails(null);
      setSentences([]);
      setEvaluationResult(null);
      setUserInput("");
      setProgress({});
    }
  };

  // Clear all listening history completely
  const handleClearAllHistory = () => {
    if (!confirm("Bạn có chắc chắn muốn xóa toàn bộ lịch sử luyện tập không?")) return;
    
    history.forEach((h) => {
      if (h.videoId) {
        try {
          localStorage.removeItem(`sentences_${h.videoId}`);
          localStorage.removeItem(`progress_${h.videoId}`);
        } catch (e) {}
      }
    });

    setHistory([]);
    try {
      localStorage.removeItem("youtube_dictation_history");
    } catch (err) {
      console.error("Failed to clear history from localStorage", err);
    }
  };

  // Upload ALL history lessons & active video to Firebase Firestore (Deduplicated by videoId)
  const handleUploadToFirebase = async (targetVideoId?: string) => {
    // Collect all unique video entries from history and active video
    const videoMap = new Map<string, {
      videoId: string;
      title: string;
      sentences: Sentence[];
      videoDetails: VideoDetails | null;
      completionCount: number;
    }>();

    // 1. If targetVideoId is specified, prioritize it or add all history
    for (const h of history) {
      if (!h.videoId) continue;
      let sList = h.sentences || [];
      if ((!sList || sList.length === 0) && h.videoId === videoDetails?.videoId) {
        sList = sentences;
      }
      if (!sList || sList.length === 0) {
        const saved = localStorage.getItem(`sentences_${h.videoId}`);
        if (saved) {
          try { sList = JSON.parse(saved); } catch (e) {}
        }
      }

      const count = parseInt(localStorage.getItem(`completion_count_${h.videoId}`) || "0", 10);
      const vDetails: VideoDetails = h.videoDetails || {
        videoId: h.videoId,
        title: h.title || "YouTube Video",
        author: "Kênh YouTube",
        thumbnailUrl: `https://img.youtube.com/vi/${h.videoId}/hqdefault.jpg`,
        language: "en",
      };

      if (sList && sList.length > 0) {
        videoMap.set(h.videoId, {
          videoId: h.videoId,
          title: h.title,
          sentences: sList,
          videoDetails: vDetails,
          completionCount: count,
        });
      }
    }

    // 2. Add current active video if present
    if (videoDetails && sentences.length > 0) {
      const activeCount = parseInt(localStorage.getItem(`completion_count_${videoDetails.videoId}`) || "0", 10);
      videoMap.set(videoDetails.videoId, {
        videoId: videoDetails.videoId,
        title: videoDetails.title,
        sentences: sentences,
        videoDetails: videoDetails,
        completionCount: activeCount,
      });
    }

    const uniqueVideos = Array.from(videoMap.values());

    if (uniqueVideos.length === 0) {
      alert("Không tìm thấy dữ liệu bài học nào trong lịch sử để đẩy lên Firebase.");
      return;
    }

    // If specific target video requested, upload just that video
    const videosToUpload = targetVideoId
      ? uniqueVideos.filter((v) => v.videoId === targetVideoId)
      : uniqueVideos;

    setIsLoading(true);
    let successCount = 0;

    for (const item of videosToUpload) {
      const ok = await saveVideoToFirestore(
        item.videoId,
        item.videoDetails,
        item.sentences,
        item.completionCount
      );
      if (ok) successCount++;
    }

    setIsLoading(false);

    if (successCount > 0) {
      alert(`🎉 Đã đẩy thành công ${successCount}/${videosToUpload.length} bài học từ lịch sử lên Firebase Firestore! (Tự động chống trùng lặp theo ID video)`);
    } else {
      alert("Không thể lưu bài học lên Firebase Firestore. Vui lòng kiểm tra lại kết nối mạng hoặc cấu hình Firebase.");
    }
  };

  // Download & Restore lessons from Firebase Firestore
  const handleDownloadFromFirebase = async () => {
    setIsLoading(true);
    const firestoreLessons = await getAllVideosFromFirestore();
    setIsLoading(false);

    if (firestoreLessons.length > 0) {
      firestoreLessons.forEach((item) => {
        if (item.completionCount !== undefined) {
          localStorage.setItem(`completion_count_${item.videoId}`, String(item.completionCount));
        }
        if (item.sentences && item.sentences.length > 0) {
          localStorage.setItem(`sentences_${item.videoId}`, JSON.stringify(item.sentences));
        }
      });

      const cloudHistory = firestoreLessons.map((item) => ({
        videoId: item.videoId,
        title: item.title,
        date: new Date(item.updatedAt).toLocaleDateString("vi-VN"),
        sentences: item.sentences,
        videoDetails: {
          videoId: item.videoId,
          title: item.title,
          author: item.author,
          thumbnailUrl: item.thumbnailUrl,
        },
      }));

      // Merge cloud history with local history, deduplicating by videoId
      const mergedMap = new Map<string, typeof cloudHistory[0]>();
      cloudHistory.forEach((item) => mergedMap.set(item.videoId, item));
      history.forEach((item) => {
        if (!mergedMap.has(item.videoId)) {
          mergedMap.set(item.videoId, item);
        }
      });

      const mergedHistory = Array.from(mergedMap.values());
      setHistory(mergedHistory);
      try {
        localStorage.setItem("youtube_dictation_history", JSON.stringify(mergedHistory));
      } catch (e) {}

      // If current active video exists in Cloud, update local sentences & completion count
      if (videoDetails?.videoId) {
        const match = firestoreLessons.find((f) => f.videoId === videoDetails.videoId);
        if (match && match.sentences && match.sentences.length > 0) {
          setSentences(match.sentences);
        }
        const activeCount = parseInt(localStorage.getItem(`completion_count_${videoDetails.videoId}`) || "0", 10);
        setCompletionCount(activeCount);
      }
      alert(`🎉 Đã tải và đồng bộ ${firestoreLessons.length} bài học từ Firebase Firestore về thiết bị thành công! (Tự động khử trùng lặp)`);
    } else {
      alert("Chưa có bài học nào được lưu trên Firebase Firestore.");
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

    const targetSentence = sentences[currentIndex].sentence;
    const vietnameseTrans = sentences[currentIndex].vietnamese;

    // Helper for local normal word-by-word comparison fallback
    const evaluateLocally = () => {
      const cleanWord = (w: string) =>
        (w || "")
          .toLowerCase()
          .replace(/[’‘`´]/g, "'")
          .replace(/[“”]/g, '"')
          .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'–—]/g, "")
          .trim();

      const normOriginal = (targetSentence || "").replace(/\s+/g, " ").trim();
      const normInput = (userInput || "").replace(/\s+/g, " ").trim();

      if (!normInput) {
        const rawOWords = normOriginal.split(/\s+/).filter(Boolean);
        const corrections = rawOWords.map((w, idx) => ({
          type: "missing",
          expected: w,
          position: idx + 1,
          reason: `Thiếu từ "${w}" (chưa nhập nội dung)`,
        }));
        return {
          accuracy: 0,
          feedback: "Bạn chưa nhập nội dung trả lời.",
          vietnameseTranslation: vietnameseTrans || undefined,
          corrections,
        };
      }

      const rawOWords = normOriginal.split(/\s+/).filter(Boolean);
      const rawIWords = normInput.split(/\s+/).filter(Boolean);

      const oWords = rawOWords.map(cleanWord);
      const iWords = rawIWords.map(cleanWord);

      const m = oWords.length;
      const n = iWords.length;

      const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          if (oWords[i - 1] === iWords[j - 1]) {
            dp[i][j] = dp[i - 1][j - 1] + 1;
          } else {
            dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
          }
        }
      }

      let i = m;
      let j = n;
      const ops: Array<{ op: "match" | "missing" | "extra" | "different"; oIdx?: number; iIdx?: number }> = [];

      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oWords[i - 1] === iWords[j - 1]) {
          ops.unshift({ op: "match", oIdx: i - 1, iIdx: j - 1 });
          i--;
          j--;
        } else if (i > 0 && j > 0 && dp[i - 1][j - 1] >= dp[i - 1][j] && dp[i - 1][j - 1] >= dp[i][j - 1]) {
          ops.unshift({ op: "different", oIdx: i - 1, iIdx: j - 1 });
          i--;
          j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
          ops.unshift({ op: "extra", iIdx: j - 1 });
          j--;
        } else {
          ops.unshift({ op: "missing", oIdx: i - 1 });
          i--;
        }
      }

      const corrections: Array<{ type: string; word?: string; expected?: string; position?: number; reason: string }> = [];
      let correctCount = 0;

      for (const op of ops) {
        if (op.op === "match") {
          correctCount++;
        } else if (op.op === "missing" && op.oIdx !== undefined) {
          corrections.push({
            type: "missing",
            expected: rawOWords[op.oIdx],
            position: op.oIdx + 1,
            reason: `Bị thiếu từ "${rawOWords[op.oIdx]}" tại vị trí thứ ${op.oIdx + 1}`,
          });
        } else if (op.op === "extra" && op.iIdx !== undefined) {
          corrections.push({
            type: "extra",
            word: rawIWords[op.iIdx],
            position: op.iIdx + 1,
            reason: `Thừa từ "${rawIWords[op.iIdx]}" (không có trong câu gốc)`,
          });
        } else if (op.op === "different" && op.oIdx !== undefined && op.iIdx !== undefined) {
          corrections.push({
            type: "different",
            word: rawIWords[op.iIdx],
            expected: rawOWords[op.oIdx],
            position: op.oIdx + 1,
            reason: `Khác từ tại vị trí thứ ${op.oIdx + 1}: Bạn gõ "${rawIWords[op.iIdx]}", từ đúng là "${rawOWords[op.oIdx]}"`,
          });
        }
      }

      const accuracy = m > 0 ? Math.max(0, Math.min(100, Math.round((correctCount / m) * 100))) : 0;

      let feedback = "Cố gắng lên nhé!";
      if (accuracy >= 100) feedback = "Xuất sắc! Bạn chép hoàn toàn chính xác.";
      else if (accuracy >= 80) feedback = "Rất tốt! Chỉ sai một vài lỗi nhỏ.";
      else if (accuracy >= 50) feedback = "Tốt! Cần chú ý kỹ hơn các từ khó.";

      return {
        accuracy,
        feedback,
        vietnameseTranslation: vietnameseTrans || undefined,
        corrections,
      };
    };

    let resultData: any = null;

    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          original: targetSentence,
          input: userInput,
          vietnamese: vietnameseTrans,
        }),
      });

      if (res.ok) {
        const resText = await res.text();
        if (resText && resText.trim()) {
          try {
            const parsed = JSON.parse(resText);
            if (parsed && typeof parsed.accuracy === "number") {
              resultData = parsed;
            }
          } catch (e) {
            console.warn("Non-JSON response from /api/evaluate, using local fallback", e);
          }
        }
      }
    } catch (err) {
      console.warn("Network error on /api/evaluate, using local fallback", err);
    }

    // Fall back to local comparison if server API returned non-JSON, empty, or failed
    if (!resultData) {
      resultData = evaluateLocally();
    }

    setEvaluationResult(resultData);

    // Save progress
    const currentSentenceId = sentences[currentIndex].id;
    const prevBest = progress[currentSentenceId] || 0;
    if (resultData.accuracy > prevBest) {
      const newProgress = { ...progress, [currentSentenceId]: resultData.accuracy };
      setProgress(newProgress);
      if (videoDetails) {
        localStorage.setItem(`progress_${videoDetails.videoId}`, JSON.stringify(newProgress));
      }
    }

    setIsEvaluating(false);
    setTimeout(() => {
      if (isMobile) {
        mobileTextareaRef.current?.focus();
      } else {
        desktopInputRef.current?.focus();
      }
    }, 100);
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

  const handleRedoVideo = () => {
    if (videoDetails) {
      localStorage.removeItem(`progress_${videoDetails.videoId}`);
    }
    setProgress({});
    setCurrentIndex(0);
    setUserInput("");
    setEvaluationResult(null);
    setIsCurrentRunCompleted(false);
    setTimeout(() => {
      if (isMobile) {
        mobileTextareaRef.current?.focus();
      } else {
        desktopTextareaRef.current?.focus();
      }
    }, 100);
  };

  const handleResetProgress = () => {
    if (window.confirm("Bạn có chắc chắn muốn xóa tiến trình lượt học này? (Số lần hoàn thành video vẫn sẽ được giữ lại)")) {
      setProgress({});
      setIsCurrentRunCompleted(false);
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
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <label htmlFor="pasted-text-input" className="text-xs font-bold text-slate-500 uppercase tracking-wider font-display">
                          Dán văn bản phụ đề thô (Không bắt buộc):
                        </label>
                      </div>

                      {/* Prompt Generator Range Control & Button */}
                      <div className="flex items-center justify-between flex-wrap gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                        <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium flex-wrap">
                          <Clock size={14} className="text-blue-500 shrink-0" />
                          <span className="font-bold font-display">Tạo Prompt từ phút:</span>
                          <input
                            type="number"
                            min="0"
                            max="300"
                            value={promptStartMin}
                            onChange={(e) => setPromptStartMin(e.target.value)}
                            className="w-12 px-1.5 py-0.5 bg-white border border-slate-300 focus:border-blue-500 rounded text-center font-mono font-bold text-xs outline-none shadow-2xs"
                          />
                          <span>đến phút:</span>
                          <input
                            type="number"
                            min="0"
                            max="300"
                            value={promptEndMin}
                            onChange={(e) => setPromptEndMin(e.target.value)}
                            className="w-12 px-1.5 py-0.5 bg-white border border-slate-300 focus:border-blue-500 rounded text-center font-mono font-bold text-xs outline-none shadow-2xs"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            const startM = promptStartMin.trim() || "0";
                            const endM = promptEndMin.trim() || "5";
                            const prompt = `Please extract all subtitles (English or original language) from minute ${startM}:00 to minute ${endM}:00 of the YouTube video in this link (or from the video you just watched) and segment them into short clauses suitable for dictation practice.

Important Rules:
1. SEGMENT SENTENCES: Segment into complete natural clauses (5 - 12 words). DO NOT OVER-SPLIT or cut in the middle of phrases/prepositions (e.g. NEVER separate prepositions like "in" from "Hanoi, Vietnam"). ONLY split at natural sentence endings (. ! ?) or connecting conjunctions ("and", "but", "so", "because", "when", "where", "which").
2. PRECISE INDIVIDUAL TIMESTAMPS (DETAILED TO MILLISECONDS):
   - Each segment's "start" and "end" timestamps MUST match exactly when the lyrics or spoken words are actually delivered in the audio.
   - Timestamps do NOT need to be continuous or adjoin back-to-back; natural pauses, gaps, or instrumental breaks between sentences should be preserved naturally.
   - Timestamps MUST have exact decimal numbers detailed to milliseconds (e.g. ${startM}:10.45 - ${startM}:18.12). ABSOLUTELY DO NOT round to whole seconds or ending with .00 (such as ${startM}:10.00 or ${startM}:18.00).
3. VIETNAMESE TRANSLATION: Attach an accurate Vietnamese translation for each segment (separated after a pipe | or in parentheses).

Standard Output Format Example:
(${startM}:10.45 - ${startM}:18.12): I just woke up from my dream where you and I had to say goodbye | Dịch: Tôi vừa tỉnh dậy sau giấc mơ nơi bạn và tôi phải nói lời tạm biệt
(${startM}:18.12 - ${startM}:23.50): and I don't know what it all means | Dịch: và tôi không biết tất cả điều này có nghĩa là gì
(${startM}:23.50 - ${startM}:28.05): but since I survived I realized | Dịch: nhưng từ khi tôi sống sót tôi mới nhận ra`;
                            navigator.clipboard.writeText(prompt);
                            setIsCopied(true);
                            setTimeout(() => setIsCopied(false), 2000);
                          }}
                          className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-all cursor-pointer shadow-2xs ${
                            isCopied 
                              ? "bg-emerald-50 text-emerald-600 border-emerald-200" 
                              : "bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200/80"
                          }`}
                        >
                          {isCopied ? <Check size={14} /> : <Clipboard size={14} />}
                          <span>{isCopied ? "Đã sao chép Prompt!" : `Copy Prompt mẫu (${promptStartMin || 0}m - ${promptEndMin || 5}m)`}</span>
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
                  {RECOMMENDED_VIDEOS.map((video, idx) => {
                    const videoIdMatch = video.url.match(/(?:v=|\/embed\/|\/watch\?v=|\/v\/|https:\/\/youtu\.be\/|\/shorts\/)([^#&?]*)/);
                    const recId = videoIdMatch ? videoIdMatch[1] : "";
                    const recCount = recId ? parseInt(localStorage.getItem(`completion_count_${recId}`) || "0", 10) : 0;
                    return (
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
                            <div className="flex items-center gap-1.5">
                              {recCount > 0 && (
                                <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1 shadow-2xs">
                                  <Trophy size={10} className="text-amber-500" />
                                  Xong {recCount} lần
                                </span>
                              )}
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                                video.language === "vi" 
                                  ? "bg-red-50 text-red-600 border-red-200" 
                                  : "bg-blue-50 text-blue-600 border-blue-200"
                              }`}>
                                {video.language === "vi" ? "TIẾNG VIỆT" : "TIẾNG ANH"}
                              </span>
                            </div>
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
                    );
                  })}
                </div>
              </div>

              {/* Recent History */}
              {history.length > 0 && (
                <div className="mt-4 border-t-2 border-slate-200/60 pt-6">
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <History className="text-slate-500" size={18} />
                      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider font-display">
                        Lịch sử luyện tập ({history.length})
                      </h3>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleUploadToFirebase()}
                        className="flex items-center gap-1 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-2xs"
                        title="Ghi đè bài học hiện tại lên Firebase Firestore"
                      >
                        <CloudUpload size={13} className="text-amber-600" />
                        <span>Đẩy lên Firebase (Ghi đè)</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleDownloadFromFirebase}
                        className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-300 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-2xs"
                        title="Tải toàn bộ bài học từ Firebase Firestore về thiết bị"
                      >
                        <CloudDownload size={13} className="text-blue-600" />
                        <span>Tải từ Firebase về</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleClearAllHistory}
                        className="flex items-center gap-1 px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-2xs"
                        title="Xóa toàn bộ lịch sử nghe"
                      >
                        <Trash2 size={12} />
                        <span>Xóa tất cả</span>
                      </button>
                    </div>
                  </div>
                  <div className="bg-white border-2 border-slate-200 rounded-2xl divide-y divide-slate-100 shadow-sm overflow-hidden">
                    {history.map((hist, idx) => {
                      const count = parseInt(
                        localStorage.getItem(`completion_count_${hist.videoId}`) || "0",
                        10
                      );
                      return (
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
                            className="flex-1 flex items-center justify-between text-left text-xs min-w-0 mr-3 gap-2"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <Youtube size={16} className="text-rose-500 shrink-0" />
                              <span className="text-slate-700 group-hover:text-blue-600 truncate font-semibold">
                                {hist.title}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span
                                className={`inline-flex items-center gap-1 text-[11px] font-bold font-mono px-2 py-0.5 rounded-lg border shadow-2xs ${
                                  count > 0
                                    ? "text-amber-800 bg-amber-50 border-amber-300"
                                    : "text-slate-500 bg-slate-100 border-slate-200"
                                }`}
                                title={`Đã hoàn thành video này ${count} lần`}
                              >
                                <Trophy size={11} className={count > 0 ? "text-amber-500" : "text-slate-400"} />
                                <span>Xong {count} lần</span>
                              </span>
                              <span className="text-slate-400 text-[10px] font-mono font-bold shrink-0">
                                {hist.date}
                              </span>
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
                      );
                    })}
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
                <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                  <h3 className="text-slate-800 text-[11px] font-bold truncate flex-1" title={videoDetails.title}>
                    {videoDetails.title}
                  </h3>
                  <span className="text-[10px] font-mono font-bold text-blue-600 shrink-0 bg-blue-50 px-1.5 py-0.5 rounded">
                    {completedCount}/{sentences.length} ({averageAccuracy}%)
                  </span>
                  {completionCount > 0 && (
                    <span className="text-[10px] font-mono font-bold text-amber-700 shrink-0 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Trophy size={10} className="text-amber-500" />
                      {completionCount} lần
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    id="redo-video-button-mobile"
                    onClick={handleRedoVideo}
                    className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 px-1.5 py-0.5 rounded cursor-pointer flex items-center gap-1"
                    title="Làm lại bài học"
                  >
                    <RotateCcw size={10} />
                    <span>Làm lại</span>
                  </button>
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
              </div>

              {/* Completion Banner Mobile */}
              {sentences.length > 0 && completedCount === sentences.length && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-gradient-to-r from-amber-500/10 via-emerald-500/10 to-blue-500/10 border-2 border-emerald-500/80 rounded-xl p-3 sm:p-4 text-center shadow-xs flex flex-col items-center gap-2"
                  id="video-completed-banner-mobile"
                >
                  <div className="flex items-center justify-center gap-1.5 text-emerald-700">
                    <Trophy className="w-5 h-5 text-amber-500 shrink-0 animate-bounce" />
                    <h3 className="text-xs sm:text-sm font-extrabold font-display">
                      🎉 Chúc mừng! Bạn đã hoàn thành toàn bộ {sentences.length} câu!
                    </h3>
                  </div>
                  <p className="text-[11px] text-slate-600 font-medium">
                    Tổng số lần hoàn tất video: <strong className="text-amber-700 font-mono font-bold">{completionCount} lần</strong>
                  </p>
                  <button
                    id="redo-video-banner-button-mobile"
                    onClick={handleRedoVideo}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs shadow-xs transition-all flex items-center gap-1.5 cursor-pointer uppercase tracking-wider font-display"
                  >
                    <RotateCcw size={13} />
                    <span>Làm lại bài học (Bắt đầu lượt mới)</span>
                  </button>
                </motion.div>
              )}

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

                    {/* Firebase Cloud Sync buttons inside dictation card */}
                    <button
                      type="button"
                      onClick={() => handleUploadToFirebase()}
                      className="flex items-center gap-1 px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-[10px] font-bold cursor-pointer transition-all"
                      title="Ghi đè bài học này lên Firebase Firestore"
                    >
                      <CloudUpload size={11} className="text-amber-600" />
                      <span>Đẩy Firebase</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadFromFirebase}
                      className="flex items-center gap-1 px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded-lg text-[10px] font-bold cursor-pointer transition-all"
                      title="Tải bài học từ Firebase Firestore về"
                    >
                      <CloudDownload size={11} className="text-blue-600" />
                      <span>Tải Firebase</span>
                    </button>
                  </div>
                </div>

                {/* Optional Preview Translation Before Answering */}
                {showTranslationBefore && (
                  <div className="bg-indigo-50/95 border border-indigo-200/90 rounded-lg p-2.5 text-xs text-indigo-950 shadow-xs flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <Languages size={15} className="text-indigo-600 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <span className="font-bold text-indigo-900 text-[10px] uppercase font-mono tracking-wider block">
                          Bản dịch Tiếng Việt:
                        </span>
                        <p className="font-semibold text-indigo-950 text-xs mt-0.5 leading-snug">
                          {sentences[currentIndex]?.vietnamese ? `"${sentences[currentIndex].vietnamese}"` : <span className="italic text-slate-400">Chưa có bản dịch</span>}
                        </p>
                      </div>
                    </div>
                    {sentences[currentIndex] && (
                      <button
                        onClick={(e) => handleOpenEditSentence(sentences[currentIndex], e)}
                        className="px-2 py-1 bg-white hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-md text-[10px] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                        title="Sửa bản dịch tiếng Việt"
                      >
                        <Edit3 size={11} />
                        <span>Sửa dịch</span>
                      </button>
                    )}
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
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleOpenAddSentence()}
                        className="flex items-center gap-0.5 px-1.5 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded text-[9px] font-bold cursor-pointer transition-colors"
                        title="Thêm câu mới vào bài học"
                      >
                        <PlusCircle size={10} />
                        <span>Thêm câu mới</span>
                      </button>
                      {selectedSentenceIds.length >= 2 && (
                        <>
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
                        </>
                      )}
                    </div>
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

                            <p className={`text-[11px] leading-normal break-words whitespace-normal flex-1 ${
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

                              <button
                                type="button"
                                onClick={(e) => handleOpenAddSentence(sentence, e)}
                                className="p-0.5 text-slate-400 hover:text-emerald-600 rounded cursor-pointer"
                                title="Thêm câu mới ngay sau câu này"
                              >
                                <Plus size={10} />
                              </button>

                              <button
                                type="button"
                                onClick={(e) => handleOpenEditSentence(sentence, e)}
                                className="p-0.5 text-slate-400 hover:text-blue-600 rounded cursor-pointer"
                                title="Chỉnh sửa câu"
                              >
                                <Edit3 size={10} />
                              </button>

                              <button
                                type="button"
                                onClick={(e) => handleDeleteSentence(sentence.id, e)}
                                className="p-0.5 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                                title="Xóa câu này"
                              >
                                <Trash2 size={10} />
                              </button>

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

                  {/* Completion Banner Desktop */}
                  {sentences.length > 0 && completedCount === sentences.length && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-gradient-to-r from-amber-500/10 via-emerald-500/10 to-blue-500/10 border-2 border-emerald-400/90 rounded-2xl p-4 sm:p-5 text-center shadow-sm flex flex-col items-center gap-3 my-1"
                      id="video-completed-banner-desktop"
                    >
                      <div className="flex items-center justify-center gap-2 text-emerald-700">
                        <Trophy className="w-7 h-7 text-amber-500 shrink-0 animate-bounce" />
                        <h3 className="text-base sm:text-lg font-extrabold font-display">
                          🎉 Chúc mừng! Bạn đã hoàn thành 100% tất cả các câu trong video này!
                        </h3>
                      </div>
                      <p className="text-xs sm:text-sm text-slate-600 font-medium max-w-xl">
                        Số lần hoàn thành video: <strong className="text-amber-700 font-bold font-mono text-base">{completionCount} lần</strong>.
                        Bạn có thể bấm nút <strong>"Làm lại bài học"</strong> bên dưới để bắt đầu lượt luyện tập mới!
                      </p>
                      <button
                        id="redo-video-banner-button-desktop"
                        onClick={handleRedoVideo}
                        className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs sm:text-sm shadow-md hover:shadow-lg transition-all hover:scale-105 active:scale-95 flex items-center gap-2 cursor-pointer uppercase tracking-wider font-display"
                      >
                        <RotateCcw size={16} />
                        <span>Làm lại bài học (Bắt đầu lượt mới)</span>
                      </button>
                    </motion.div>
                  )}

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
                  {showTranslationBefore && (
                    <div className="bg-indigo-50/95 border-2 border-indigo-200/90 rounded-2xl p-4 text-xs text-indigo-950 shadow-sm flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <Languages size={18} className="text-indigo-600 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <span className="font-bold text-indigo-900 text-xs uppercase font-mono tracking-wider block mb-0.5">
                            Bản dịch Tiếng Việt:
                          </span>
                          <p className="font-semibold text-indigo-950 text-base leading-relaxed">
                            {sentences[currentIndex]?.vietnamese ? `"${sentences[currentIndex].vietnamese}"` : <span className="italic text-slate-400">Chưa có bản dịch</span>}
                          </p>
                        </div>
                      </div>
                      {sentences[currentIndex] && (
                        <button
                          onClick={(e) => handleOpenEditSentence(sentences[currentIndex], e)}
                          className="px-2.5 py-1.5 bg-white hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer shadow-2xs transition-all"
                          title="Sửa bản dịch tiếng Việt"
                        >
                          <Edit3 size={13} />
                          <span>Sửa dịch</span>
                        </button>
                      )}
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
                    <div>
                      <span className="text-slate-400 block text-[9px] font-bold uppercase tracking-wider font-mono">Số lần xong</span>
                      <strong className="text-amber-600 font-mono text-sm font-bold flex items-center justify-center gap-1">
                        <Trophy size={13} className="text-amber-500 shrink-0" />
                        {completionCount} lần
                      </strong>
                    </div>
                    <div className="w-px h-6 bg-slate-200"></div>
                    <div className="flex items-center gap-1">
                      <button
                        id="redo-video-button"
                        onClick={handleRedoVideo}
                        className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                        title="Làm lại bài học (Xóa tiến trình lượt hiện tại để luyện lại từ đầu)"
                      >
                        <RotateCcw size={12} />
                        <span>Làm lại</span>
                      </button>
                      <button
                        id="reset-progress-button"
                        onClick={handleResetProgress}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                        title="Xóa tiến trình lượt này"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
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
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest font-mono">
                        Danh sách ({sentences.length} câu)
                      </span>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenAddSentence()}
                          className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold transition-all cursor-pointer"
                          title="Thêm câu mới vào bài học"
                        >
                          <PlusCircle size={13} />
                          <span>Thêm câu</span>
                        </button>

                        {selectedSentenceIds.length >= 2 && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={handleMergeSentences}
                              className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer"
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

                              <p className={`text-xs leading-normal break-words whitespace-normal flex-1 ${
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

                                <button
                                   type="button"
                                   onClick={(e) => handleOpenAddSentence(sentence, e)}
                                   className="p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors cursor-pointer"
                                   title="Thêm câu mới ngay sau câu này"
                                 >
                                   <Plus size={12} />
                                 </button>

                                 <button
                                   type="button"
                                   onClick={(e) => handleOpenEditSentence(sentence, e)}
                                   className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer"
                                   title="Chỉnh sửa nội dung và mốc thời gian"
                                 >
                                   <Edit3 size={12} />
                                 </button>

                                 <button
                                   type="button"
                                   onClick={(e) => handleDeleteSentence(sentence.id, e)}
                                   className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                                   title="Xóa câu này"
                                 >
                                   <Trash2 size={12} />
                                 </button> 

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

      {/* Edit / Insert Sentence & Timestamps Modal */}
      <EditSentenceModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingSentence(null);
          setIsInsertMode(false);
        }}
        sentence={editingSentence}
        isInsertMode={isInsertMode}
        onSave={handleUpdateSentence}
        onTestPlay={() => {
          setPlayTrigger((prev) => prev + 1);
        }}
      />
    </div>
  );
}

import React, { useState, useEffect } from "react";
import {
  X,
  Sparkles,
  PlusCircle,
  Check,
  BookOpen,
  CloudUpload,
  Loader2,
  AlertCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface AddVocabularyModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultWord?: string;
  contextSentence?: string;
}

export default function AddVocabularyModal({
  isOpen,
  onClose,
  defaultWord = "",
  contextSentence = ""
}: AddVocabularyModalProps) {
  const [word, setWord] = useState(defaultWord);
  const [vietnamese, setVietnamese] = useState("");
  const [grammar, setGrammar] = useState("noun");
  const [category, setCategory] = useState<"GENERAL" | "TOEIC">("GENERAL");
  const [englishSentence, setEnglishSentence] = useState(contextSentence);
  const [vietnameseSentence, setVietnameseSentence] = useState("");

  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setWord(defaultWord);
      setEnglishSentence(contextSentence);
      setVietnamese("");
      setVietnameseSentence("");
      setGrammar("noun");
      setCategory("GENERAL");
      setStatusMessage(null);
    }
  }, [isOpen, defaultWord, contextSentence]);

  // Handle AI Auto lookup (Phân tích nghĩa & ví dụ bằng Gemini)
  const handleAiLookup = async () => {
    if (!word.trim()) {
      setStatusMessage({ type: "error", text: "Vui lòng nhập từ vựng trước khi gọi AI." });
      return;
    }

    setIsLookingUp(true);
    setStatusMessage(null);

    try {
      const res = await fetch("/api/vocabulary/lookup-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: word.trim(),
          contextSentence: englishSentence || contextSentence
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể phân tích từ bằng AI.");
      }

      setVietnamese(data.vietnamese || "");
      setGrammar(data.grammar || "noun");
      if (data.englishSentence) setEnglishSentence(data.englishSentence);
      if (data.vietnameseSentence) setVietnameseSentence(data.vietnameseSentence);
      
      setStatusMessage({ type: "success", text: "AI Gemini đã tự động hoàn thiện nghĩa & phát âm!" });
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: "error", text: err.message || "Lỗi tra cứu từ vựng bằng AI." });
    } finally {
      setIsLookingUp(false);
    }
  };

  // Submit to Appwrite
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!word.trim()) {
      setStatusMessage({ type: "error", text: "Từ vựng không được để trống." });
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const res = await fetch("/api/vocabulary/add-appwrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: word.trim(),
          vietnamese: vietnamese.trim(),
          grammar: grammar.trim(),
          category,
          englishSentence: englishSentence.trim(),
          vietnameseSentence: vietnameseSentence.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể đồng bộ lên Appwrite.");
      }

      setStatusMessage({ type: "success", text: `Đã lưu từ "${word.trim()}" lên Appwrite Cloud thành công!` });
      
      setTimeout(() => {
        onClose();
      }, 1600);
    } catch (err: any) {
      console.error(err);
      setStatusMessage({ type: "error", text: err.message || "Lỗi gửi dữ liệu lên Appwrite." });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-white border-2 border-slate-200 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col"
        >
          {/* Modal Header */}
          <div className="p-5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex justify-between items-center">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
                <CloudUpload size={20} className="text-white" />
              </div>
              <div>
                <h3 className="font-bold text-base font-display leading-tight">Thêm Từ Vựng Vào Appwrite Cloud</h3>
                <p className="text-blue-100 text-xs font-medium">Đồng bộ tự động với app Learning-English-App</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Form Content */}
          <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
            
            {/* Word Input + AI Lookup */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-slate-700 font-display uppercase tracking-wider">
                  Từ vựng Tiếng Anh <span className="text-rose-500">*</span>:
                </label>
                <button
                  type="button"
                  onClick={handleAiLookup}
                  disabled={isLookingUp || !word.trim()}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 text-xs font-bold rounded-lg transition-all active:scale-95 disabled:opacity-50"
                  title="Nhờ AI Gemini tự động gợi ý nghĩa, từ loại và câu dịch"
                >
                  {isLookingUp ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} className="text-amber-500" />}
                  <span>{isLookingUp ? "Đang tra..." : "AI Điền Tự Động"}</span>
                </button>
              </div>

              <input
                type="text"
                placeholder="Ví dụ: survival, goodbye, dream..."
                value={word}
                onChange={(e) => setWord(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 focus:border-blue-500 focus:bg-white rounded-xl text-slate-800 text-sm font-bold font-display outline-none transition-all"
                required
              />
            </div>

            {/* Category Selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-700 font-display uppercase tracking-wider">
                Danh mục lưu trữ (Appwrite Category):
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setCategory("GENERAL")}
                  className={`py-2.5 px-3 rounded-xl border-2 text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                    category === "GENERAL"
                      ? "bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm"
                      : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                  <span>GENERAL (Từ thông dụng)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCategory("TOEIC")}
                  className={`py-2.5 px-3 rounded-xl border-2 text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                    category === "TOEIC"
                      ? "bg-amber-50 border-amber-500 text-amber-700 shadow-sm"
                      : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                  <span>TOEIC (Từ vựng TOEIC)</span>
                </button>
              </div>
            </div>

            {/* Vietnamese Meaning & Grammar */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-700 font-display uppercase tracking-wider">
                  Nghĩa tiếng Việt:
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: sự sống sót, sự tồn tại"
                  value={vietnamese}
                  onChange={(e) => setVietnamese(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-200 focus:border-blue-500 focus:bg-white rounded-xl text-slate-800 text-xs font-medium outline-none transition-all"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-700 font-display uppercase tracking-wider">
                  Từ loại:
                </label>
                <select
                  value={grammar}
                  onChange={(e) => setGrammar(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border-2 border-slate-200 focus:border-blue-500 focus:bg-white rounded-xl text-slate-800 text-xs font-bold outline-none transition-all"
                >
                  <option value="noun">Danh từ (noun)</option>
                  <option value="verb">Động từ (verb)</option>
                  <option value="adjective">Tính từ (adj)</option>
                  <option value="adverb">Trạng từ (adv)</option>
                  <option value="phrase">Cụm từ (phrase)</option>
                </select>
              </div>
            </div>

            {/* Example Sentences */}
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-700 font-display uppercase tracking-wider">
                  Câu ví dụ tiếng Anh (Sentences):
                </label>
                <textarea
                  rows={2}
                  placeholder="Câu ví dụ bằng tiếng Anh..."
                  value={englishSentence}
                  onChange={(e) => setEnglishSentence(e.target.value)}
                  className="w-full p-3 bg-slate-50 border-2 border-slate-200 focus:border-blue-500 focus:bg-white rounded-xl text-slate-800 text-xs font-medium outline-none transition-all resize-none"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-700 font-display uppercase tracking-wider">
                  Dịch câu ví dụ sang Tiếng Việt:
                </label>
                <input
                  type="text"
                  placeholder="Dịch câu ví dụ..."
                  value={vietnameseSentence}
                  onChange={(e) => setVietnameseSentence(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-200 focus:border-blue-500 focus:bg-white rounded-xl text-slate-800 text-xs font-medium outline-none transition-all"
                />
              </div>
            </div>

            {/* Status Feedback Message */}
            {statusMessage && (
              <div className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                statusMessage.type === "success"
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-rose-50 text-rose-700 border border-rose-200"
              }`}>
                {statusMessage.type === "success" ? <Check size={16} /> : <AlertCircle size={16} />}
                <span>{statusMessage.text}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs transition-colors"
              >
                Hủy bỏ
              </button>

              <button
                type="submit"
                disabled={isSubmitting || !word.trim()}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-all shadow-md shadow-blue-500/10 flex items-center gap-2 active:scale-95 disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />}
                <span>{isSubmitting ? "Đang đồng bộ..." : "Đồng Bộ Lên Appwrite"}</span>
              </button>
            </div>

          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

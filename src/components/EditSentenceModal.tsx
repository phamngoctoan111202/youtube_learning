import React, { useState, useEffect } from "react";
import { X, Clock, Play, Save, Edit3, PlusCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Sentence } from "../types";

interface EditSentenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  sentence: Sentence | null;
  onSave: (updated: Sentence) => void;
  onTestPlay: () => void;
  isInsertMode?: boolean;
}

export default function EditSentenceModal({
  isOpen,
  onClose,
  sentence,
  onSave,
  onTestPlay,
  isInsertMode = false,
}: EditSentenceModalProps) {
  const [text, setText] = useState("");
  const [vietnamese, setVietnamese] = useState("");
  const [start, setStart] = useState<number>(0);
  const [end, setEnd] = useState<number>(0);

  useEffect(() => {
    if (sentence) {
      if (isInsertMode) {
        setText("");
        setVietnamese("");
        const newStart = Number(sentence.end.toFixed(2));
        setStart(newStart);
        setEnd(Number((newStart + 4).toFixed(2)));
      } else {
        setText(sentence.sentence);
        setVietnamese(sentence.vietnamese || "");
        setStart(Number(sentence.start.toFixed(2)));
        setEnd(Number(sentence.end.toFixed(2)));
      }
    }
  }, [sentence, isInsertMode]);

  if (!isOpen || !sentence) return null;

  const handleAdjustStart = (delta: number) => {
    setStart((prev) => Math.max(0, Number((prev + delta).toFixed(2))));
  };

  const handleAdjustEnd = (delta: number) => {
    setEnd((prev) => Math.max(start + 0.1, Number((prev + delta).toFixed(2))));
  };

  const handleSave = () => {
    if (!text.trim()) return;
    onSave({
      ...sentence,
      sentence: text.trim(),
      vietnamese: vietnamese.trim() || undefined,
      start: Math.max(0, start),
      end: Math.max(start + 0.1, end),
    });
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="bg-white border-2 border-slate-200 rounded-3xl p-6 max-w-lg w-full shadow-2xl relative flex flex-col gap-5 overflow-hidden max-h-[90vh] overflow-y-auto"
        >
          {/* Top Header */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
            <div className="flex items-center gap-2.5">
              <div className={`p-2 rounded-xl border ${isInsertMode ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-blue-50 text-blue-600 border-blue-100"}`}>
                {isInsertMode ? <PlusCircle size={20} /> : <Edit3 size={20} />}
              </div>
              <div>
                <h3 className="text-slate-900 font-bold font-display text-base">
                  {isInsertMode ? `Thêm câu mới (Chèn sau câu #${sentence.id})` : `Chỉnh sửa Câu #${sentence.id}`}
                </h3>
                <p className="text-slate-400 text-xs font-medium">
                  {isInsertMode ? "Nhập nội dung và cài đặt mốc thời gian cho câu mới" : "Tùy chỉnh nội dung câu, bản dịch và mốc thời gian phát audio"}
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Form Content */}
          <div className="flex flex-col gap-4">
            {/* Sentence Text Input */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider font-display">
                Nội dung lời thoại (Tiếng Anh) <span className="text-rose-500">*</span>:
              </label>
              <textarea
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full p-3 bg-slate-50 border-2 border-slate-200 focus:border-blue-500 focus:bg-white rounded-xl text-slate-800 outline-none text-xs sm:text-sm font-medium leading-relaxed resize-none transition-all"
                placeholder="Nhập nội dung tiếng Anh của câu..."
                autoFocus
              />
            </div>

            {/* Vietnamese Translation Input */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider font-display">
                Bản dịch Tiếng Việt (Tùy chọn):
              </label>
              <textarea
                rows={2}
                value={vietnamese}
                onChange={(e) => setVietnamese(e.target.value)}
                className="w-full p-3 bg-indigo-50/50 border-2 border-indigo-100 focus:border-indigo-500 focus:bg-white rounded-xl text-slate-800 outline-none text-xs sm:text-sm font-medium leading-relaxed resize-none transition-all"
                placeholder="Nhập bản dịch tiếng Việt cho câu này..."
              />
            </div>

            {/* Timestamps adjustment grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200/80">
              {/* Start Time */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-600 flex items-center gap-1 font-display">
                    <Clock size={13} className="text-blue-500" /> Bắt đầu (giây):
                  </span>
                </div>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={start}
                  onChange={(e) => setStart(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 focus:border-blue-500 rounded-lg text-slate-800 font-mono font-bold text-sm outline-none text-center shadow-xs"
                />
                <div className="flex gap-1 justify-center">
                  {[-1, -0.5, +0.5, +1].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => handleAdjustStart(val)}
                      className="px-2 py-1 bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-600 border border-slate-200 rounded text-[10px] font-mono font-bold transition-colors shadow-2xs cursor-pointer"
                    >
                      {val > 0 ? `+${val}` : val}s
                    </button>
                  ))}
                </div>
              </div>

              {/* End Time */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-600 flex items-center gap-1 font-display">
                    <Clock size={13} className="text-emerald-500" /> Kết thúc (giây):
                  </span>
                </div>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={end}
                  onChange={(e) => setEnd(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 focus:border-emerald-500 rounded-lg text-slate-800 font-mono font-bold text-sm outline-none text-center shadow-xs"
                />
                <div className="flex gap-1 justify-center">
                  {[-1, -0.5, +0.5, +1].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => handleAdjustEnd(val)}
                      className="px-2 py-1 bg-white hover:bg-emerald-50 text-slate-600 hover:text-emerald-600 border border-slate-200 rounded text-[10px] font-mono font-bold transition-colors shadow-2xs cursor-pointer"
                    >
                      {val > 0 ? `+${val}` : val}s
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Test Play Audio Action */}
            <button
              type="button"
              onClick={() => {
                onSave({
                  ...sentence,
                  sentence: text.trim(),
                  vietnamese: vietnamese.trim() || undefined,
                  start: Math.max(0, start),
                  end: Math.max(start + 0.1, end),
                });
                onTestPlay();
              }}
              className="w-full py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <Play size={14} className="fill-indigo-600 text-indigo-600" />
              <span>Phát thử đoạn Audio (Thời lượng: {(end - start).toFixed(1)}s)</span>
            </button>
          </div>

          {/* Bottom Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!text.trim()}
              className={`px-5 py-2.5 text-white font-bold rounded-xl text-xs transition-all shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${isInsertMode ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/10" : "bg-blue-600 hover:bg-blue-500 shadow-blue-600/10"}`}
            >
              {isInsertMode ? <PlusCircle size={14} /> : <Save size={14} />}
              <span>{isInsertMode ? "Lưu & Thêm câu" : "Lưu thay đổi"}</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

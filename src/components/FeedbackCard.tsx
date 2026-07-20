import { CheckCircle2, AlertCircle, RefreshCw, X, HelpCircle } from "lucide-react";
import { EvaluationResult } from "../types";
import { motion } from "motion/react";

interface FeedbackCardProps {
  result: EvaluationResult | null;
  isEvaluating: boolean;
  onRetry: () => void;
}

export default function FeedbackCard({ result, isEvaluating, onRetry }: FeedbackCardProps) {
  if (isEvaluating) {
    return (
      <div className="bg-white border-2 border-slate-200 rounded-3xl p-8 text-center shadow-sm flex flex-col items-center justify-center min-h-[200px]" id="evaluating-card">
        <div className="relative mb-4">
          <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
        </div>
        <p className="text-slate-800 font-bold font-display">Trí Tuệ Nhân Tạo đang chấm điểm...</p>
        <p className="text-slate-400 text-xs mt-1 font-medium">So sánh chi tiết từng từ, ngữ pháp và lỗi chính tả</p>
      </div>
    );
  }

  if (!result) return null;

  const { accuracy, feedback, corrections } = result;

  // Determine feedback style based on accuracy
  const getStyle = () => {
    if (accuracy >= 95) {
      return {
        bg: "bg-emerald-50 border-2 border-emerald-200/85",
        text: "text-emerald-800",
        badge: "bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold",
        icon: <CheckCircle2 className="text-emerald-600" size={28} />,
        rating: "Xuất sắc!",
      };
    } else if (accuracy >= 80) {
      return {
        bg: "bg-blue-50 border-2 border-blue-200/85",
        text: "text-blue-800",
        badge: "bg-blue-100 text-blue-800 border border-blue-200 font-bold",
        icon: <CheckCircle2 className="text-blue-600" size={28} />,
        rating: "Rất tốt!",
      };
    } else if (accuracy >= 50) {
      return {
        bg: "bg-amber-50 border-2 border-amber-200/85",
        text: "text-amber-800",
        badge: "bg-amber-100 text-amber-800 border border-amber-200 font-bold",
        icon: <AlertCircle className="text-amber-600" size={28} />,
        rating: "Tốt / Cần Cố Gắng",
      };
    } else {
      return {
        bg: "bg-rose-50 border-2 border-rose-200/85",
        text: "text-rose-800",
        badge: "bg-rose-100 text-rose-800 border border-rose-200 font-bold",
        icon: <AlertCircle className="text-rose-600" size={28} />,
        rating: "Còn Nhiều Sai Sót",
      };
    }
  };

  const style = getStyle();

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      className={`rounded-3xl p-6 shadow-sm transition-all ${style.bg}`}
      id="feedback-evaluation-card"
    >
      <div className="flex flex-col md:flex-row items-center md:items-start justify-between gap-4 mb-5 border-b border-slate-200/60 pb-5">
        <div className="flex items-center gap-4 text-center md:text-left flex-col md:flex-row">
          <div className="p-3.5 bg-white rounded-2xl shadow-sm border border-slate-100">{style.icon}</div>
          <div>
            <div className="flex items-center gap-2 flex-wrap justify-center md:justify-start">
              <span className={`text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full ${style.badge}`}>
                {style.rating}
              </span>
              <span className="text-slate-400 text-[11px] font-bold uppercase tracking-wider font-mono">Đánh giá từ AI</span>
            </div>
            <h4 className="text-slate-800 font-bold text-lg mt-1.5 leading-snug font-display">{feedback}</h4>
          </div>
        </div>

        {/* Big circular score indicator */}
        <div className="relative flex items-center justify-center w-24 h-24 bg-white rounded-full border-2 border-slate-200 shadow-sm shrink-0">
          <svg className="absolute w-20 h-20 transform -rotate-90">
            <circle
              cx="40"
              cy="40"
              r="34"
              className="stroke-slate-100"
              strokeWidth="5"
              fill="transparent"
            />
            <circle
              cx="40"
              cy="40"
              r="34"
              className={
                accuracy >= 90
                  ? "stroke-emerald-500"
                  : accuracy >= 75
                  ? "stroke-blue-500"
                  : accuracy >= 50
                  ? "stroke-amber-500"
                  : "stroke-rose-500"
              }
              strokeWidth="5"
              fill="transparent"
              strokeDasharray={`${2 * Math.PI * 34}`}
              strokeDashoffset={`${2 * Math.PI * 34 * (1 - accuracy / 100)}`}
              strokeLinecap="round"
            />
          </svg>
          <div className="text-center">
            <span className="text-2xl font-bold text-slate-800 font-mono">{accuracy}</span>
            <span className="text-[10px] text-slate-400 block -mt-1 font-bold">%</span>
          </div>
        </div>
      </div>

      {/* Corrections detail */}
      {corrections && corrections.length > 0 ? (
        <div className="mb-5">
          <h5 className="text-slate-700 font-bold font-display text-sm mb-3 flex items-center gap-1.5">
            <HelpCircle size={16} className="text-blue-500" />
            <span>Phân tích các lỗi sai chi tiết:</span>
          </h5>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {corrections.map((corr, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2.5 bg-white border border-slate-200 rounded-2xl p-4 text-sm shadow-sm"
              >
                <div className="mt-0.5">
                  {corr.type === "missing" ? (
                    <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-600 border border-amber-200 flex items-center justify-center font-bold text-xs font-mono">
                      !
                    </span>
                  ) : (
                    <span className="w-4 h-4 rounded-full bg-rose-100 text-rose-600 border border-rose-200 flex items-center justify-center font-bold text-xs font-mono">
                      ×
                    </span>
                  )}
                </div>

                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider font-mono">
                      {corr.type === "missing"
                        ? "Thiếu từ"
                        : corr.type === "spelling"
                        ? "Chính tả"
                        : "Sai từ"}
                    </span>
                  </div>

                  <div className="mt-1">
                    {corr.type === "missing" ? (
                      <p className="text-slate-700">
                        Cần có thêm từ: <strong className="text-amber-600 font-bold font-mono">"{corr.expected}"</strong>
                      </p>
                    ) : (
                      <p className="text-slate-700 leading-relaxed">
                        Nhầm <span className="text-rose-500 line-through decoration-2">"{corr.word || "(khoảng trống)"}"</span> thành{" "}
                        <strong className="text-emerald-600 font-bold font-mono">"{corr.expected}"</strong>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        accuracy === 100 && (
          <div className="mb-5 bg-emerald-100/60 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
            <CheckCircle2 className="text-emerald-600 shrink-0" size={20} />
            <p className="text-emerald-800 text-sm font-medium">
              Tuyệt vời! Bạn không phạm bất kỳ lỗi chính tả hay lỗi chia câu nào. Tai nghe của bạn cực kỳ nhạy bén!
            </p>
          </div>
        )
      )}

      {/* Try again control */}
      <div className="flex justify-end">
        <button
          id="retry-dictation-button"
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-all shadow-sm active:scale-95"
        >
          <RefreshCw size={14} />
          <span>Luyện lại câu này</span>
        </button>
      </div>
    </motion.div>
  );
}

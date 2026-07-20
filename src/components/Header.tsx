import { Headphones, Sparkles, Youtube } from "lucide-react";

export default function Header() {
  return (
    <header className="py-3 px-3 md:px-6 border-b-2 border-slate-200/80 bg-white/90 backdrop-blur-md sticky top-0 z-50 shadow-sm">
      <div className="max-w-[1700px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Brand Logo */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-rose-500 to-red-600 flex items-center justify-center shadow-md shadow-rose-500/10">
            <Headphones className="text-white" size={20} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-900 font-bold text-lg tracking-tight font-display">YouTube Dictation</span>
              <span className="bg-rose-500/10 text-rose-600 text-[10px] font-bold px-1.5 py-0.5 rounded border border-rose-500/20 uppercase flex items-center gap-1 font-mono">
                <Youtube size={10} />
                <span>Edu</span>
              </span>
            </div>
            <p className="text-slate-500 text-xs font-medium">Luyện Chép Chính Tả Thông Minh</p>
          </div>
        </div>

        {/* Feature badge */}
        <div className="flex items-center gap-2 bg-slate-100/80 border border-slate-200 px-3.5 py-1.5 rounded-full text-xs font-medium text-slate-700">
          <Sparkles size={13} className="text-amber-500 animate-pulse" />
          <span>Tự Động Phân Đoạn Bằng AI Gemini</span>
        </div>
      </div>
    </header>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Volume2, Video, EyeOff, Repeat } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
    YT?: any;
  }
}

interface YoutubePlayerProps {
  videoId: string;
  start: number;
  end: number;
  padding: number; // 0, 1, or 2 seconds
  onStateChange?: (playing: boolean) => void;
  playTrigger?: number; // Counter to trigger playback programmatically
}

export default function YoutubePlayer({
  videoId,
  start,
  end,
  padding,
  onStateChange,
  playTrigger = 0,
}: YoutubePlayerProps) {
  const containerId = `yt-player-${videoId}`;
  const playerRef = useRef<any>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const [isLoaded, setIsLoaded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(80);
  const [hideVideo, setHideVideo] = useState(false); // Default to showing video
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isLooping, setIsLooping] = useState(false);

  // Adjust bounds based on padding/cushion
  const paddedStart = Math.max(0, start - padding);
  const paddedEnd = end + padding;

  // Load YouTube Player API if not already loaded
  useEffect(() => {
    const loadYT = () => {
      if (window.YT && window.YT.Player) {
        initPlayer();
        return;
      }

      // Check if tag is already inserted
      const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (!existingScript) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName("script")[0];
        firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
      }

      // Store previous callback if any
      const previousCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (previousCallback) previousCallback();
        initPlayer();
      };
    };

    const initPlayer = () => {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch (e) {
          console.warn("Error destroying previous player:", e);
        }
      }

      playerRef.current = new window.YT.Player(containerId, {
        height: "100%",
        width: "100%",
        videoId: videoId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          controls: 0, // Hide controls for professional clean interface
          disablekb: 1,
          fs: 0,
          rel: 0,
          showinfo: 0,
          iv_load_policy: 3,
          modestbranding: 1,
          playsinline: 1,
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (event: any) => {
            setIsLoaded(true);
            event.target.setVolume(volume);
            event.target.setPlaybackRate(playbackRate);
          },
          onStateChange: (event: any) => {
            const state = event.data;
            const playing = state === window.YT.PlayerState.PLAYING;
            setIsPlaying(playing);
            if (onStateChange) onStateChange(playing);
          },
        },
      });
    };

    loadYT();

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [videoId]);

  // Monitor playback limits
  useEffect(() => {
    if (isPlaying && playerRef.current) {
      if (intervalRef.current) clearInterval(intervalRef.current);

      intervalRef.current = setInterval(() => {
        if (!playerRef.current || typeof playerRef.current.getCurrentTime !== "function") return;
        
        try {
          const time = playerRef.current.getCurrentTime();
          setCurrentTime(time);

          if (time >= paddedEnd) {
            if (isLooping) {
              playerRef.current.seekTo(paddedStart, true);
              playerRef.current.playVideo();
            } else {
              playerRef.current.pauseVideo();
              setIsPlaying(false);
              if (onStateChange) onStateChange(false);
              if (intervalRef.current) clearInterval(intervalRef.current);
            }
          }
        } catch (e) {
          console.warn("Error accessing YouTube current time:", e);
        }
      }, 100);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, paddedEnd, isLooping, paddedStart, onStateChange]);

  // Trigger segment playback when playTrigger or start/end changes
  useEffect(() => {
    if (isLoaded && playerRef.current && playTrigger > 0) {
      playSegment();
    }
  }, [playTrigger, start, end, padding, isLoaded]);

  const playSegment = () => {
    if (!playerRef.current || !isLoaded) return;
    try {
      playerRef.current.seekTo(paddedStart, true);
      playerRef.current.playVideo();
      setIsPlaying(true);
      if (onStateChange) onStateChange(true);
    } catch (e) {
      console.error("Failed to play YouTube segment:", e);
    }
  };

  const pauseSegment = () => {
    if (!playerRef.current || !isLoaded) return;
    try {
      playerRef.current.pauseVideo();
      setIsPlaying(false);
      if (onStateChange) onStateChange(false);
    } catch (e) {
      console.error("Failed to pause YouTube segment:", e);
    }
  };

  const replaySegment = () => {
    playSegment();
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setVolume(val);
    if (playerRef.current && isLoaded) {
      try {
        playerRef.current.setVolume(val);
      } catch (err) {
        console.warn("Failed to set YouTube volume:", err);
      }
    }
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (playerRef.current && isLoaded) {
      try {
        playerRef.current.setPlaybackRate(rate);
      } catch (err) {
        console.warn("Failed to set YouTube playback rate:", err);
      }
    }
  };

  // Helper to format time (e.g. 01:23)
  const formatTime = (timeInSecs: number) => {
    const minutes = Math.floor(timeInSecs / 60);
    const seconds = Math.floor(timeInSecs % 60);
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  };

  return (
    <div className="bg-white border-2 border-slate-200 rounded-3xl overflow-hidden shadow-sm" id="youtube-player-card">
      <div className="p-4 bg-slate-50 border-b-2 border-slate-100 flex justify-between items-center flex-wrap gap-2">
        <div className="flex items-center gap-2 text-slate-600 text-sm font-semibold font-display">
          <div className="relative flex h-2 w-2">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isLoaded ? 'bg-emerald-400' : 'bg-amber-400'} opacity-75`}></span>
            <span className={`relative inline-flex rounded-full h-2 w-2 ${isLoaded ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
          </div>
          <span>{isLoaded ? "Trình phát sẵn sàng" : "Đang tải dữ liệu..."}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Hide/Show Video toggle - critical for dictation */}
          <button
            id="toggle-video-mode-button"
            onClick={() => setHideVideo(!hideVideo)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              hideVideo
                ? "bg-blue-50 text-blue-600 border border-blue-200/80 hover:bg-blue-100"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200"
            }`}
            title={hideVideo ? "Hiển thị khung hình Video" : "Ẩn Video (Chế độ chỉ nghe Audio)"}
          >
            {hideVideo ? <EyeOff size={14} /> : <Video size={14} />}
            <span>{hideVideo ? "Chế độ Chỉ Nghe" : "Hiện Khung Hình"}</span>
          </button>
        </div>
      </div>

      <div className="relative aspect-video bg-black flex items-center justify-center">
        {/* The Actual IFrame wrapper */}
        <div
          className={`w-full h-full absolute top-0 left-0 transition-opacity duration-300 ${
            hideVideo ? "opacity-0 pointer-events-none" : "opacity-100"
          }`}
        >
          <div id={containerId} className="w-full h-full"></div>
        </div>

        {/* Beautiful vinyl/audio animation when video is hidden */}
        {hideVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-slate-950 to-slate-900 p-6 overflow-hidden">
            {/* Spinning Vinyl Record */}
            <div className="relative mb-6">
              <motion.div
                animate={{ rotate: isPlaying ? 360 : 0 }}
                transition={{ repeat: Infinity, duration: 6, ease: "linear" }}
                className="w-32 h-32 md:w-40 md:h-40 rounded-full bg-slate-950 border-4 border-slate-800 flex items-center justify-center shadow-2xl relative"
              >
                {/* Vinyl Grooves */}
                <div className="absolute inset-2 rounded-full border border-slate-800/50"></div>
                <div className="absolute inset-4 rounded-full border border-slate-700/30"></div>
                <div className="absolute inset-8 rounded-full border border-slate-800/50"></div>
                <div className="absolute inset-12 rounded-full border border-slate-700/30"></div>
                {/* Center Label */}
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-blue-600 border border-blue-400 flex items-center justify-center relative">
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-950"></div>
                </div>
              </motion.div>

              {/* Styled floating notes or pulses when playing */}
              {isPlaying && (
                <div className="absolute inset-0 flex justify-center items-center pointer-events-none">
                  <span className="absolute animate-ping h-36 w-36 md:h-44 md:w-44 rounded-full border border-blue-500/20 opacity-75"></span>
                  <span className="absolute animate-ping h-44 w-44 md:h-52 md:w-52 rounded-full border border-blue-500/10 opacity-50 delay-1000"></span>
                </div>
              )}
            </div>

            {/* Audio Waveform Micro-animation */}
            <div className="flex items-center gap-1.5 h-8 mb-2">
              {[...Array(12)].map((_, i) => (
                <motion.div
                  key={i}
                  animate={{
                    height: isPlaying ? [10, Math.random() * 32 + 8, 10] : 4,
                  }}
                  transition={{
                    repeat: Infinity,
                    duration: 0.6 + i * 0.1,
                    ease: "easeInOut",
                  }}
                  className="w-1 bg-blue-500 rounded-full"
                />
              ))}
            </div>

            <p className="text-slate-400 text-xs text-center font-mono tracking-wider max-w-xs uppercase">
              {isPlaying ? "Đang phát đoạn nghe..." : "Tạm dừng phát"}
            </p>
          </div>
        )}
      </div>

      {/* Control Area */}
      <div className="p-4 bg-slate-50 border-t-2 border-slate-100 flex flex-col sm:flex-row items-center gap-4">
        {/* Audio controls */}
        <div className="flex items-center gap-3 w-full sm:w-auto justify-center sm:justify-start">
          <button
            id="play-segment-button"
            disabled={!isLoaded}
            onClick={isPlaying ? pauseSegment : playSegment}
            className={`w-12 h-12 rounded-full flex items-center justify-center shadow-md transition-all ${
              isPlaying
                ? "bg-rose-600 text-white hover:bg-rose-500 hover:scale-105 active:scale-95"
                : "bg-blue-600 text-white hover:bg-blue-500 hover:scale-105 active:scale-95 disabled:bg-slate-200 disabled:text-slate-400 disabled:scale-100"
            }`}
            title={isPlaying ? "Tạm dừng" : "Phát"}
          >
            {isPlaying ? <Pause size={20} /> : <Play className="ml-1" size={20} />}
          </button>

          <button
            id="replay-segment-button"
            disabled={!isLoaded}
            onClick={replaySegment}
            className="w-10 h-10 rounded-full bg-white border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-slate-50 hover:scale-105 active:scale-95 disabled:bg-slate-100 disabled:text-slate-400 transition-all shadow-sm"
            title="Nghe lại câu này"
          >
            <RotateCcw size={18} />
          </button>
          
          <button
            id="loop-segment-button"
            disabled={!isLoaded}
            onClick={() => setIsLooping(!isLooping)}
            className={`w-10 h-10 rounded-full border flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-sm ${
              isLooping
                ? "bg-blue-100 border-blue-300 text-blue-600"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
            title={isLooping ? "Tắt lặp lại" : "Lặp lại câu này"}
          >
            <Repeat size={18} />
          </button>
        </div>

        {/* Timeline Indicator */}
        <div className="flex-1 w-full text-center sm:text-left">
          <div className="flex justify-between items-center text-xs font-mono text-slate-500 mb-1">
            <span>{formatTime(paddedStart)}</span>
            <span className="text-blue-600 font-bold bg-blue-50 border border-blue-100 px-2 py-0.5 rounded font-mono">
              Thời lượng đoạn nghe: {(paddedEnd - paddedStart).toFixed(1)}s
            </span>
            <span>{formatTime(paddedEnd)}</span>
          </div>

          <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden relative">
            <div
              className="h-full bg-blue-600 transition-all duration-100"
              style={{
                width: `${
                  Math.min(
                    100,
                    Math.max(
                      0,
                      ((currentTime - paddedStart) / (paddedEnd - paddedStart)) * 100
                    )
                  )
                }%`,
              }}
            ></div>
          </div>
        </div>

        {/* Volume & Speed controls */}
        <div className="flex flex-col items-center sm:items-end gap-2 w-full sm:w-auto">
          {/* Speed Control */}
          <div className="flex items-center gap-1.5 bg-slate-200/50 rounded-lg p-0.5 border border-slate-200">
            <span className="text-[10px] font-bold text-slate-400 pl-1.5 uppercase">Tốc độ:</span>
            {[0.5, 0.75, 1, 1.25].map((rate) => (
              <button
                key={rate}
                onClick={() => handleRateChange(rate)}
                className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded-md transition-all ${
                  playbackRate === rate
                    ? "bg-white text-blue-600 shadow-sm border border-slate-200"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-200"
                }`}
                title={`Tốc độ: ${rate}x`}
              >
                {rate}x
              </button>
            ))}
          </div>
          {/* Volume Control */}
          <div className="flex items-center gap-2">
            <Volume2 size={16} className="text-slate-500" />
            <input
              id="volume-slider"
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={handleVolumeChange}
              className="w-24 accent-blue-600 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer"
              title="Âm lượng"
            />
            <span className="text-xs font-mono text-slate-500 min-w-[24px] text-right font-bold">
              {volume}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

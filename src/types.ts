export interface Sentence {
  id: number;
  sentence: string;
  start: number;
  end: number;
}

export interface VideoDetails {
  videoId: string;
  title: string;
  author: string;
  thumbnailUrl: string;
  language: string;
  isRestored?: boolean;
}

export interface Correction {
  word: string;
  expected: string;
  type: "missing" | "spelling" | "incorrect";
}

export interface EvaluationResult {
  accuracy: number;
  feedback: string;
  corrections: Correction[];
}

export interface RecommendedVideo {
  title: string;
  url: string;
  author: string;
  language: "vi" | "en";
  category: string;
}

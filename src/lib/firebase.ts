import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  deleteDoc,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { Sentence, VideoDetails } from "../types";

// Firebase Configuration from environment variables or sensible defaults
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDemoPlaceholderKeyForFirebaseSync",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "youtube-dictation-learning.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "youtube-dictation-learning",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "youtube-dictation-learning.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1234567890",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:1234567890:web:abcdef123456",
};

// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Firestore DB
export const db = getFirestore(app);

export interface FirestoreVideoLesson {
  videoId: string;
  url: string;
  title: string;
  author: string;
  thumbnailUrl: string;
  sentences: Sentence[];
  sentenceCount: number;
  updatedAt: string;
  createdAt: string;
}

/**
 * Save video details and subtitle segments to Firebase Firestore
 */
export async function saveVideoToFirestore(
  videoId: string,
  videoDetails: VideoDetails | null,
  sentences: Sentence[]
): Promise<boolean> {
  if (!videoId || !sentences || sentences.length === 0) return false;

  try {
    const docRef = doc(db, "videos", videoId);
    const now = new Date().toISOString();

    const lessonData: FirestoreVideoLesson = {
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: videoDetails?.title || "Video YouTube",
      author: videoDetails?.author || "Kênh YouTube",
      thumbnailUrl: videoDetails?.thumbnailUrl || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      sentences: sentences.map((s) => ({
        id: s.id,
        sentence: s.sentence,
        start: Number(s.start.toFixed(2)),
        end: Number(s.end.toFixed(2)),
        vietnamese: s.vietnamese || undefined,
        isMerged: s.isMerged || undefined,
      })),
      sentenceCount: sentences.length,
      updatedAt: now,
      createdAt: now,
    };

    // Use setDoc with merge: true so existing metadata like createdAt is preserved
    await setDoc(docRef, lessonData, { merge: true });
    console.log(`Successfully saved video ${videoId} and ${sentences.length} sub segments to Firestore.`);
    return true;
  } catch (error) {
    console.warn("Failed to save video to Firebase Firestore (Offline or Config required):", error);
    return false;
  }
}

/**
 * Get video details and subtitle segments from Firebase Firestore by videoId
 */
export async function getVideoFromFirestore(videoId: string): Promise<FirestoreVideoLesson | null> {
  if (!videoId) return null;

  try {
    const docRef = doc(db, "videos", videoId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return docSnap.data() as FirestoreVideoLesson;
    }
    return null;
  } catch (error) {
    console.warn(`Failed to fetch video ${videoId} from Firestore:`, error);
    return null;
  }
}

/**
 * Fetch all saved video lessons from Firestore ordered by recent updates
 */
export async function getAllVideosFromFirestore(maxLimit = 20): Promise<FirestoreVideoLesson[]> {
  try {
    const videosRef = collection(db, "videos");
    const q = query(videosRef, orderBy("updatedAt", "desc"), limit(maxLimit));
    const querySnapshot = await getDocs(q);

    const lessons: FirestoreVideoLesson[] = [];
    querySnapshot.forEach((doc) => {
      lessons.push(doc.data() as FirestoreVideoLesson);
    });

    return lessons;
  } catch (error) {
    console.warn("Failed to fetch videos list from Firestore:", error);
    return [];
  }
}

/**
 * Delete a video document and its sub segments from Firebase Firestore
 */
export async function deleteVideoFromFirestore(videoId: string): Promise<boolean> {
  if (!videoId) return false;

  try {
    const docRef = doc(db, "videos", videoId);
    await deleteDoc(docRef);
    console.log(`Deleted video ${videoId} from Firestore.`);
    return true;
  } catch (error) {
    console.warn(`Failed to delete video ${videoId} from Firestore:`, error);
    return false;
  }
}

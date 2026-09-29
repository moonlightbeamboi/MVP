import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getFirestore, type Firestore } from 'firebase/firestore'

/**
 * Firebase is OPTIONAL. Create a project at https://console.firebase.google.com,
 * enable Firestore (test mode) and copy its web config into a `.env` file
 * (see `.env.example`). Without it, the app runs on an offline local store
 * with identical behaviour (cross-tab sync included).
 */
const env = import.meta.env

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
}

export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId)
}

let app: FirebaseApp | null = null
let db: Firestore | null = null

export function getDb(): Firestore {
  if (!isFirebaseConfigured()) throw new Error('Firebase not configured')
  if (!db) {
    app = initializeApp(firebaseConfig)
    db = getFirestore(app)
  }
  return db
}

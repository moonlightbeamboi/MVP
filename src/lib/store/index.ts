import type { DataBackend } from '../../types'
import { isFirebaseConfigured } from '../firebaseConfig'
import { FirebaseStore } from './firebaseStore'
import { LocalStore } from './localStore'

let backend: DataBackend | null = null

/**
 * Returns the app-wide data backend. Uses Firestore when a `.env` Firebase
 * config is present, otherwise an offline local store with identical API.
 */
export async function getBackend(): Promise<DataBackend> {
  if (backend) return backend
  if (isFirebaseConfigured()) {
    const fb = new FirebaseStore()
    try {
      await fb.init()
      backend = fb
      return backend
    } catch (e) {
      console.warn('[store] Firebase init failed, falling back to local store:', e)
    }
  }
  const local = new LocalStore()
  await local.init()
  backend = local
  return backend
}

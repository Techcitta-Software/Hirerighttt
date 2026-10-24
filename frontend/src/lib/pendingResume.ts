/**
 * Pending Resume Persistence Utility
 *
 * Temporarily persists a resume when the user picks a file on the homepage before
 * sign-up/login. Onboarding attaches it only when `hireright.consumePendingResume`
 * is set (see markPendingResumeForAttachOnboarding). Otherwise stale copies are cleared.
 */

const DB_NAME = 'hireright_storage'
const DB_VERSION = 1
const STORE_NAME = 'pending_files'
const KEY = 'pending_resume'

const META_STORAGE_KEY = 'hireright.pendingResumeMeta'
const BASE64_STORAGE_KEY = 'hireright.pendingResumeBase64'

/** Set when the user explicitly chose a file on the homepage before auth; cleared after attach. */
export const CONSUME_PENDING_RESUME_KEY = 'hireright.consumePendingResume'

export function markPendingResumeForAttachOnboarding() {
  try {
    sessionStorage.setItem(CONSUME_PENDING_RESUME_KEY, '1')
  } catch {
    // ignore
  }
}

export function clearPendingResumeAttachFlag() {
  try {
    sessionStorage.removeItem(CONSUME_PENDING_RESUME_KEY)
  } catch {
    // ignore
  }
}

export function shouldAttachPendingResumeOnboarding(): boolean {
  try {
    return sessionStorage.getItem(CONSUME_PENDING_RESUME_KEY) === '1'
  } catch {
    return false
  }
}

interface PendingMeta {
  name: string
  type: string
  size: number
  lastModified: number
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported'))
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'))
  })
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = (err) => reject(err)
    reader.readAsDataURL(file)
  })
}

function base64ToBlob(dataUrl: string, fallbackType: string): Blob {
  const parts = dataUrl.split(',')
  const mime = parts[0]?.match(/:(.*?);/)?.[1] || fallbackType
  const bstr = atob(parts[1] || '')
  let n = bstr.length
  const u8arr = new Uint8Array(n)
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n)
  }
  return new Blob([u8arr], { type: mime })
}

/**
 * Store the chosen resume file into IndexedDB and fallback sessionStorage.
 */
export async function setPendingResume(file: File): Promise<void> {
  markPendingResumeForAttachOnboarding()
  const meta: PendingMeta = {
    name: file.name,
    type: file.type || 'application/pdf',
    size: file.size,
    lastModified: file.lastModified || Date.now(),
  }

  // 1. Save metadata to sessionStorage
  try {
    sessionStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta))
  } catch (err) {
    console.warn('[pendingResume] Could not save meta to sessionStorage', err)
  }

  // 2. Attempt saving binary to IndexedDB
  let savedToIndexedDB = false
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const putReq = store.put(file, KEY)
      putReq.onsuccess = () => resolve()
      putReq.onerror = () => reject(putReq.error)
    })
    savedToIndexedDB = true
  } catch (idbErr) {
    console.warn('[pendingResume] IndexedDB unavailable, will use base64 fallback', idbErr)
  }

  // 3. Fallback to base64 in sessionStorage if file is <= 4MB
  if (!savedToIndexedDB || file.size < 3 * 1024 * 1024) {
    try {
      const base64 = await fileToBase64(file)
      sessionStorage.setItem(BASE64_STORAGE_KEY, base64)
    } catch (err) {
      console.warn('[pendingResume] Could not save base64 to sessionStorage', err)
    }
  }
}

/**
 * Retrieve the pending resume file, if one exists.
 */
export async function getPendingResume(): Promise<File | null> {
  const metaStr = sessionStorage.getItem(META_STORAGE_KEY)
  let meta: PendingMeta | null = null
  if (metaStr) {
    try {
      meta = JSON.parse(metaStr)
    } catch {
      meta = null
    }
  }

  // 1. Try retrieving binary from IndexedDB
  try {
    const db = await openDB()
    const stored = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const getReq = store.get(KEY)
      getReq.onsuccess = () => resolve(getReq.result)
      getReq.onerror = () => reject(getReq.error)
    })

    if (stored) {
      if (stored instanceof File) {
        return stored
      }
      if (stored instanceof Blob) {
        return new File([stored], meta?.name || 'resume.pdf', {
          type: meta?.type || stored.type || 'application/pdf',
          lastModified: meta?.lastModified || Date.now(),
        })
      }
    }
  } catch (err) {
    console.warn('[pendingResume] Failed to get from IndexedDB', err)
  }

  // 2. Try fallback from sessionStorage base64
  try {
    const base64 = sessionStorage.getItem(BASE64_STORAGE_KEY)
    if (base64 && meta) {
      const blob = base64ToBlob(base64, meta.type)
      return new File([blob], meta.name, {
        type: meta.type,
        lastModified: meta.lastModified,
      })
    }
  } catch (err) {
    console.warn('[pendingResume] Failed to reconstruct from sessionStorage base64', err)
  }

  return null
}

/**
 * Clear the pending resume after it has been safely loaded into onboarding.
 */
export async function clearPendingResume(): Promise<void> {
  clearPendingResumeAttachFlag()
  try {
    sessionStorage.removeItem(META_STORAGE_KEY)
    sessionStorage.removeItem(BASE64_STORAGE_KEY)
  } catch {
    // Ignore
  }

  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const delReq = store.delete(KEY)
      delReq.onsuccess = () => resolve()
      delReq.onerror = () => reject(delReq.error)
    })
  } catch {
    // Ignore
  }
}

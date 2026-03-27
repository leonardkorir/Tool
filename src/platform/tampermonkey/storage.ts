import type { StorageService } from '../../app/types'

function hasGm(): boolean {
  return typeof GM_getValue === 'function' && typeof GM_setValue === 'function'
}

export function createStorageService(namespace: string): StorageService {
  const prefix = `${namespace}.`
  const gmAvailable = hasGm()

  return {
    get<T>(key: string, fallback: T): T {
      const namespacedKey = `${prefix}${key}`
      if (gmAvailable) {
        try {
          return GM_getValue(namespacedKey, fallback) as T
        } catch {
          // fall through
        }
      }
      try {
        const raw = localStorage.getItem(namespacedKey)
        if (raw == null) return fallback
        return JSON.parse(raw) as T
      } catch {
        return fallback
      }
    },
    set<T>(key: string, value: T): void {
      const namespacedKey = `${prefix}${key}`
      if (gmAvailable) {
        try {
          GM_setValue(namespacedKey, value)
          return
        } catch {
          // fall through
        }
      }
      try {
        localStorage.setItem(namespacedKey, JSON.stringify(value))
      } catch {
        // ignore
      }
    },
    remove(key: string): void {
      const namespacedKey = `${prefix}${key}`
      if (gmAvailable && typeof GM_deleteValue === 'function') {
        try {
          GM_deleteValue(namespacedKey)
        } catch {
          // ignore
        }
      }
      try {
        localStorage.removeItem(namespacedKey)
      } catch {
        // ignore
      }
    },
  }
}

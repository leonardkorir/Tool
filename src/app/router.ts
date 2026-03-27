import { toDisposable } from '../shared/disposable'
import type { Router } from './types'

export function createRouter(): Router {
  // Guard against accidental double-init (e.g. script re-executed). Keeping the router singleton
  // prevents stacking history wrappers and duplicate polling.
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g.__ld2_router__ as Router | undefined
  if (existing) return existing

  const listeners = new Set<(href: string) => void>()
  let lastHref = window.location.href

  function emit(): void {
    const href = window.location.href
    if (href === lastHref) return
    lastHref = href
    for (const cb of listeners) {
      try {
        cb(href)
      } catch (err) {
        console.error('[ld2] router listener failed', err)
      }
    }
  }

  const originalPushState = history.pushState.bind(history)
  const originalReplaceState = history.replaceState.bind(history)

  history.pushState = ((...args: Parameters<History['pushState']>) => {
    originalPushState(...args)
    emit()
  }) as History['pushState']

  history.replaceState = ((...args: Parameters<History['replaceState']>) => {
    originalReplaceState(...args)
    emit()
  }) as History['replaceState']

  window.addEventListener('popstate', emit)
  window.addEventListener('hashchange', emit)

  const router: Router = {
    getHref: () => lastHref,
    onChange(listener) {
      listeners.add(listener)
      return toDisposable(() => {
        listeners.delete(listener)
      })
    },
  }

  g.__ld2_router__ = router
  return router
}

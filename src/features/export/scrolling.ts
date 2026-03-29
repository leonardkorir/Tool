export type SharedDomScrollConfig = {
  stepPx: number
  delayMs: number
  stableThreshold: number
  maxScrollCount: number
  collectIntervalMs: number
  scrollToTop: boolean
}

export type ScrollCollectionState<T> = {
  iteration: number
  merged: Map<unknown, T>
  done: number
  lastDone: number
  added: number
  spinner: boolean
  atBottom: boolean
  stable: number
  sizeStable: number
  spinnerStable: number
  scrollStable: number
  scrollY: number
  lastScrollY: number
  stepPx: number
  delayMs: number
  baseStepPx: number
  baseDelayMs: number
  stableThreshold: number
}

export function clampScrollInt(
  value: number,
  min: number,
  max: number,
  fallback: number
): number {
  if (!Number.isFinite(value)) return fallback
  const n = Math.floor(value)
  return Math.min(max, Math.max(min, n))
}

export async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'))
    const timerId = window.setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timerId)
        reject(new DOMException('aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}

export function getDocumentScrollHeight(): number {
  try {
    const body = document.body
    const el = document.documentElement
    const candidates = [
      body?.scrollHeight ?? 0,
      body?.offsetHeight ?? 0,
      el?.scrollHeight ?? 0,
      el?.offsetHeight ?? 0,
      el?.clientHeight ?? 0,
    ]
    return Math.max(...candidates)
  } catch {
    return document.body.scrollHeight
  }
}

export function isVisibleElement(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return true
  const style = window.getComputedStyle(el)
  if (style.display === 'none') return false
  if (style.visibility === 'hidden') return false
  if (style.opacity === '0') return false
  try {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
  } catch {
    // ignore measurement errors
  }
  return true
}

export function hasVisibleMatch(selector: string, root: ParentNode = document): boolean {
  try {
    const els = Array.from(root.querySelectorAll(selector))
    for (const el of els) {
      if (!isVisibleElement(el)) continue
      try {
        const rect = (el as Element).getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) continue
        const marginPx = 240
        if (rect.bottom < -marginPx) continue
        if (rect.top > window.innerHeight + marginPx) continue
      } catch {
        return true
      }
      return true
    }
    return false
  } catch {
    return false
  }
}

export async function collectByScrolling<T>(options: {
  signal: AbortSignal
  config?: Partial<SharedDomScrollConfig>
  defaultConfig: SharedDomScrollConfig
  collectOnce: () => Map<unknown, T>
  onProgress?: (state: ScrollCollectionState<T>) => void
  hasSpinner?: () => boolean
  shouldStop?: (state: ScrollCollectionState<T>) => boolean
  shouldForceStop?: (state: ScrollCollectionState<T>) => boolean
  getNextTiming?: (
    state: ScrollCollectionState<T>
  ) => Pick<ScrollCollectionState<T>, 'stepPx' | 'delayMs'>
}): Promise<Map<unknown, T>> {
  const cfg: SharedDomScrollConfig = {
    stepPx: clampScrollInt(
      options.config?.stepPx ?? options.defaultConfig.stepPx,
      50,
      5000,
      options.defaultConfig.stepPx
    ),
    delayMs: clampScrollInt(
      options.config?.delayMs ?? options.defaultConfig.delayMs,
      0,
      60_000,
      options.defaultConfig.delayMs
    ),
    stableThreshold: clampScrollInt(
      options.config?.stableThreshold ?? options.defaultConfig.stableThreshold,
      1,
      60,
      options.defaultConfig.stableThreshold
    ),
    maxScrollCount: clampScrollInt(
      options.config?.maxScrollCount ?? options.defaultConfig.maxScrollCount,
      50,
      20_000,
      options.defaultConfig.maxScrollCount
    ),
    collectIntervalMs: clampScrollInt(
      options.config?.collectIntervalMs ?? options.defaultConfig.collectIntervalMs,
      0,
      10_000,
      options.defaultConfig.collectIntervalMs
    ),
    scrollToTop: options.config?.scrollToTop ?? options.defaultConfig.scrollToTop,
  }

  const startX = window.scrollX
  const startY = window.scrollY
  const merged = new Map<unknown, T>()

  const merge = (items: Map<unknown, T>): number => {
    let added = 0
    for (const [key, value] of items) {
      if (merged.has(key)) continue
      merged.set(key, value)
      added += 1
    }
    return added
  }

  const isAtBottom = () => window.innerHeight + window.scrollY >= getDocumentScrollHeight() - 220

  try {
    if (cfg.scrollToTop) {
      window.scrollTo(startX, 0)
      await sleepWithAbort(240, options.signal)
    }

    let stepPx = cfg.stepPx
    let delayMs = cfg.delayMs
    let stable = 0
    let sizeStable = 0
    let spinnerStable = 0
    let scrollStable = 0
    let lastDone = 0
    let lastScrollY = window.scrollY

    for (let iteration = 0; iteration < cfg.maxScrollCount; iteration += 1) {
      if (options.signal.aborted) throw new DOMException('aborted', 'AbortError')

      const added = merge(options.collectOnce())
      const done = merged.size
      const spinner = options.hasSpinner ? options.hasSpinner() : false
      const atBottom = isAtBottom()
      const scrollY = window.scrollY

      if (done === lastDone) sizeStable += 1
      else sizeStable = 0

      if (done === lastDone && !spinner) stable += 1
      else stable = 0

      if (done === lastDone && spinner) spinnerStable += 1
      else spinnerStable = 0

      if (Math.abs(scrollY - lastScrollY) < 2) scrollStable += 1
      else scrollStable = 0

      const state: ScrollCollectionState<T> = {
        iteration,
        merged,
        done,
        lastDone,
        added,
        spinner,
        atBottom,
        stable,
        sizeStable,
        spinnerStable,
        scrollStable,
        scrollY,
        lastScrollY,
        stepPx,
        delayMs,
        baseStepPx: cfg.stepPx,
        baseDelayMs: cfg.delayMs,
        stableThreshold: cfg.stableThreshold,
      }

      options.onProgress?.(state)

      const shouldStop =
        options.shouldStop?.(state) ?? (stable >= cfg.stableThreshold && atBottom && !spinner)
      const shouldForceStop =
        options.shouldForceStop?.(state) ??
        ((scrollStable >= cfg.stableThreshold &&
          sizeStable >= cfg.stableThreshold &&
          !spinner) ||
          (atBottom &&
            sizeStable >= cfg.stableThreshold &&
            spinnerStable >= cfg.stableThreshold * 2))
      if (shouldStop || shouldForceStop) break

      const nextTiming = options.getNextTiming?.(state)
      if (nextTiming) {
        stepPx = clampScrollInt(nextTiming.stepPx, 50, 5000, cfg.stepPx)
        delayMs = clampScrollInt(nextTiming.delayMs, 0, 60_000, cfg.delayMs)
      }

      window.scrollBy(0, stepPx)
      if (cfg.collectIntervalMs > 0) await sleepWithAbort(cfg.collectIntervalMs, options.signal)
      merge(options.collectOnce())

      const remaining = Math.max(0, delayMs - cfg.collectIntervalMs)
      if (remaining > 0) await sleepWithAbort(remaining, options.signal)

      lastDone = done
      lastScrollY = scrollY
    }

    merge(options.collectOnce())
    return merged
  } finally {
    try {
      window.scrollTo(startX, startY)
    } catch {
      // ignore restore failures
    }
  }
}

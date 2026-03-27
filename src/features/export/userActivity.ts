import type { DomSnapshotScrollConfig } from './domSnapshot'
import { getPassiveUserActivityOuterHtmlCache } from './domPassiveCache'
import { cleanUrlParamU, hasUrlParamU } from '../../shared/url'

export type UserActivityEntry = {
  postId: string
  topicTitle: string
  topicHref: string | null
  categoryName: string | null
  time: number
  timeLabel: string
  cookedHtml: string
}

function toAbsUrl(raw: string, origin: string): string {
  const v = String(raw || '').trim()
  if (!v) return ''
  try {
    const abs = new URL(v, origin).toString()
    return hasUrlParamU(abs) ? cleanUrlParamU(abs, origin) : abs
  } catch {
    return v
  }
}

function absolutifyCookedHtml(html: string, origin: string): string {
  const attrs = ['href', 'src', 'data-src', 'data-download-href']
  let out = html
  for (const attr of attrs) {
    out = out.replace(
      new RegExp(`\\b${attr}=\\"(\\/)(?!\\/)([^\\"]*)\\"`, 'g'),
      `${attr}="${origin}/$2"`
    )
  }
  return out
}

function sanitizeCookedHtmlUrlParams(html: string, origin: string): string {
  if (!hasUrlParamU(html)) return html
  const attrs = ['href', 'src', 'data-src', 'data-download-href']

  let out = html
  for (const attr of attrs) {
    out = out.replace(new RegExp(`\\b${attr}="([^"]+)"`, 'g'), (m, v: string) => {
      if (!v || !hasUrlParamU(v)) return m
      return `${attr}="${cleanUrlParamU(v, origin)}"`
    })
    out = out.replace(new RegExp(`\\b${attr}='([^']+)'`, 'g'), (m, v: string) => {
      if (!v || !hasUrlParamU(v)) return m
      return `${attr}='${cleanUrlParamU(v, origin)}'`
    })
  }

  return out
}

function formatTimeLabel(timeEl: Element | null, fallbackTime: number): string {
  const title = String(timeEl?.getAttribute?.('title') || '').trim()
  if (title) return title
  const raw = String(timeEl?.getAttribute?.('data-time') || '')
  const ts = Number.parseInt(raw, 10)
  const best = Number.isFinite(ts) && ts > 0 ? ts : fallbackTime
  if (!Number.isFinite(best) || best <= 0) return ''
  try {
    return new Date(best).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function parseEntry(options: {
  html: string
  time: number
  origin: string
}): UserActivityEntry | null {
  const html = String(options.html || '').trim()
  if (!html) return null

  const tmp = document.createElement('div')
  tmp.innerHTML = html

  const item =
    tmp.querySelector<HTMLElement>('.post-list-item.user-stream-item') ??
    (tmp.firstElementChild instanceof HTMLElement ? tmp.firstElementChild : tmp)

  const excerpt = item.querySelector<HTMLElement>('.excerpt[data-post-id], .excerpt')
  const postId = String(excerpt?.getAttribute('data-post-id') || '').trim()
  if (!postId) return null

  const topicA = item.querySelector<HTMLAnchorElement>(
    '.stream-topic-title span.title a[href], .stream-topic-title a[href], a[href*="/t/"]'
  )
  const topicTitle = String(topicA?.textContent || '').trim()
  const topicHrefRaw = String(topicA?.getAttribute('href') || '').trim()
  const topicHref = topicHrefRaw ? toAbsUrl(topicHrefRaw, options.origin) : null

  const catEl = item.querySelector<HTMLElement>(
    '.post-list-item__metadata .badge-category__name, .stream-post-category .badge-category__name, .badge-category__name'
  )
  const categoryName = String(catEl?.textContent || '').trim() || null

  const timeEl = item.querySelector<HTMLElement>(
    '.post-list-item__metadata .relative-date[data-time], .relative-date[data-time], .relative-date'
  )
  const timeLabel = formatTimeLabel(timeEl, options.time)

  const cookedEl =
    (excerpt ? excerpt.querySelector<HTMLElement>('.cooked') : null) ??
    item.querySelector<HTMLElement>('.cooked')
  const cookedRaw = cookedEl
    ? String(cookedEl.innerHTML || '')
    : excerpt
      ? String(excerpt.innerHTML || '')
      : ''
  const cookedHtml = sanitizeCookedHtmlUrlParams(
    absolutifyCookedHtml(cookedRaw, options.origin),
    options.origin
  )

  return {
    postId,
    topicTitle: topicTitle || (topicHref ? topicHref : '话题'),
    topicHref,
    categoryName,
    time: options.time,
    timeLabel,
    cookedHtml,
  }
}

function collectVisibleUserActivityOuterHtml(): Map<string, { html: string; time: number }> {
  const cache = new Map<string, { html: string; time: number }>()
  const userStream = document.querySelector<HTMLElement>('.user-stream')
  if (!userStream) return cache

  const items = Array.from(
    userStream.querySelectorAll<HTMLElement>('.post-list-item.user-stream-item')
  )
  for (const item of items) {
    const excerpt = item.querySelector<HTMLElement>('.excerpt[data-post-id]')
    if (!excerpt) continue
    const postId = excerpt.getAttribute('data-post-id') || ''
    if (!postId || cache.has(postId)) continue
    const timeEl = item.querySelector<HTMLElement>('.relative-date[data-time]')
    const time = timeEl ? Number.parseInt(timeEl.getAttribute('data-time') || '', 10) : 0
    cache.set(postId, { html: item.outerHTML, time: Number.isFinite(time) ? time : 0 })
  }

  return cache
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  const n = Math.floor(value)
  return Math.min(max, Math.max(min, n))
}

function getDocumentScrollHeight(): number {
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

function isVisibleElement(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return true
  const style = window.getComputedStyle(el)
  if (style.display === 'none') return false
  if (style.visibility === 'hidden') return false
  if (style.opacity === '0') return false
  return true
}

function hasVisibleMatch(selector: string, root: ParentNode = document): boolean {
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

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'))
    const t = window.setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(t)
        reject(new DOMException('aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}

async function collectByScrolling<T>(options: {
  signal: AbortSignal
  config?: Partial<DomSnapshotScrollConfig>
  collectOnce: () => Map<unknown, T>
  onProgress?: (info: { done: number; message: string }) => void
}): Promise<Map<unknown, T>> {
  const cfg: DomSnapshotScrollConfig = {
    stepPx: clampInt(options.config?.stepPx ?? 400, 50, 5000, 400),
    delayMs: clampInt(options.config?.delayMs ?? 2500, 0, 60_000, 2500),
    stableThreshold: clampInt(options.config?.stableThreshold ?? 8, 1, 60, 8),
    maxScrollCount: clampInt(options.config?.maxScrollCount ?? 1000, 50, 20_000, 1000),
    collectIntervalMs: clampInt(options.config?.collectIntervalMs ?? 300, 0, 10_000, 300),
    scrollToTop: options.config?.scrollToTop ?? true,
  }

  const startX = window.scrollX
  const startY = window.scrollY

  const merged = new Map<unknown, T>()
  const merge = (m: Map<unknown, T>) => {
    for (const [k, v] of m) if (!merged.has(k)) merged.set(k, v)
  }

  const isAtBottom = () => window.innerHeight + window.scrollY >= getDocumentScrollHeight() - 220
  const hasSpinner = () => {
    const userStream = document.querySelector<HTMLElement>('.user-stream')
    if (userStream && hasVisibleMatch('.spinner', userStream)) return true
    return hasVisibleMatch('.loading-container .spinner')
  }

  try {
    if (cfg.scrollToTop) {
      window.scrollTo(startX, 0)
      await sleep(240, options.signal)
    }

    let stable = 0
    let sizeStable = 0
    let spinnerStable = 0
    let scrollStable = 0
    let lastSize = 0
    let lastScrollY = window.scrollY

    for (let i = 0; i < cfg.maxScrollCount; i += 1) {
      if (options.signal.aborted) throw new DOMException('aborted', 'AbortError')

      merge(options.collectOnce())
      const size = merged.size
      const spinner = hasSpinner()
      const atBottom = isAtBottom()
      const scrollY = window.scrollY

      if (size === lastSize) sizeStable += 1
      else sizeStable = 0

      if (size === lastSize && !spinner) stable += 1
      else stable = 0

      if (size === lastSize && spinner) spinnerStable += 1
      else spinnerStable = 0

      if (Math.abs(scrollY - lastScrollY) < 2) scrollStable += 1
      else scrollStable = 0

      lastSize = size
      lastScrollY = scrollY

      options.onProgress?.({ done: size, message: `DOM 滚动收集… 已收集 ${size}` })

      const shouldStop = stable >= cfg.stableThreshold && atBottom && !spinner
      const shouldForceStop =
        (scrollStable >= cfg.stableThreshold && sizeStable >= cfg.stableThreshold && !spinner) ||
        (atBottom && sizeStable >= cfg.stableThreshold && spinnerStable >= cfg.stableThreshold * 2)
      if (shouldStop || shouldForceStop) break

      window.scrollBy(0, cfg.stepPx)
      if (cfg.collectIntervalMs > 0) await sleep(cfg.collectIntervalMs, options.signal)
      const remaining = Math.max(0, cfg.delayMs - cfg.collectIntervalMs)
      if (remaining > 0) await sleep(remaining, options.signal)
    }

    merge(options.collectOnce())
    return merged
  } finally {
    try {
      window.scrollTo(startX, startY)
    } catch {
      /* ignore */
    }
  }
}

export async function collectUserActivityEntries(options: {
  origin: string
  username: string | null
  mode: 'visible' | 'scroll'
  signal: AbortSignal
  scrollConfig?: Partial<DomSnapshotScrollConfig>
  onProgress?: (message: string) => void
}): Promise<UserActivityEntry[]> {
  const passive = getPassiveUserActivityOuterHtmlCache(options.username)

  const mergeOuterHtml = (
    a: Map<string, { html: string; time: number }>,
    b: Map<string, { html: string; time: number }>
  ) => {
    for (const [k, v] of b) a.set(k, v)
  }

  const cachedVisible = () => {
    const merged = new Map<string, { html: string; time: number }>()
    if (passive) mergeOuterHtml(merged, passive)
    mergeOuterHtml(merged, collectVisibleUserActivityOuterHtml())
    return merged
  }

  const collected =
    options.mode === 'scroll'
      ? await collectByScrolling({
          signal: options.signal,
          config: { ...options.scrollConfig, scrollToTop: true },
          collectOnce: collectVisibleUserActivityOuterHtml,
          onProgress: (p) => options.onProgress?.(`${p.message} 条`),
        })
      : cachedVisible()

  if (options.signal.aborted) throw new DOMException('aborted', 'AbortError')

  const merged = new Map<string, { html: string; time: number }>()
  if (options.mode === 'scroll') {
    // Best-effort: include passive cache items collected while browsing before scroll started.
    if (passive) mergeOuterHtml(merged, passive)
    mergeOuterHtml(merged, collected as Map<string, { html: string; time: number }>)
    mergeOuterHtml(merged, collectVisibleUserActivityOuterHtml())
  } else {
    mergeOuterHtml(merged, collected as Map<string, { html: string; time: number }>)
  }

  const entries: UserActivityEntry[] = []
  for (const [postId, it] of merged) {
    const parsed = parseEntry({ html: it.html, time: it.time, origin: options.origin })
    if (!parsed) continue
    // trust map key first (more stable than parsing)
    parsed.postId = postId
    entries.push(parsed)
  }

  entries.sort((a, b) => {
    const ta = Number.parseInt(String(a.time || 0), 10) || 0
    const tb = Number.parseInt(String(b.time || 0), 10) || 0
    if (tb !== ta) return tb - ta
    const pa = Number.parseInt(String(a.postId || 0), 10) || 0
    const pb = Number.parseInt(String(b.postId || 0), 10) || 0
    return pb - pa
  })

  return entries
}

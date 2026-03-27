export type PendingFullExport = {
  topicId: string
  startUrl: string
  createdAt: number
  attempt: number
}

const FULL_EXPORT_RESUME_KEY = 'ld2_pending_full_export_v2'

export const FULL_EXPORT_RESUME_TTL_MS = 2 * 60 * 1000
export const FULL_EXPORT_RESUME_MAX_ATTEMPTS = 2

function toast(title: string, desc: string): void {
  try {
    window.dispatchEvent(new CustomEvent('ld2:toast', { detail: { title, desc, ttlMs: 5200 } }))
  } catch {
    /* ignore */
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
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

function getFirstPostElement(): Element | null {
  return document.querySelector(
    'article[data-post-number="1"], .topic-post[data-post-number="1"], #post_1'
  )
}

function getPostNumberFromTopicPath(pathname: string): number | null {
  const parts = String(pathname || '')
    .split('/')
    .filter(Boolean)
  if (parts[0] !== 't') return null
  const numeric = parts.slice(1).filter((p) => /^\d+$/.test(p))
  if (numeric.length < 2) return null
  const postNumber = Number.parseInt(numeric[1], 10)
  return Number.isFinite(postNumber) && postNumber > 0 ? postNumber : null
}

function buildTopicStartUrl(options: {
  origin: string
  topicId: number
  slug: string | null
}): string {
  const origin = options.origin.replace(/\/+$/, '')
  const slug = (options.slug || '').trim()
  if (slug) return `${origin}/t/${slug}/${options.topicId}/1`
  return `${origin}/t/${options.topicId}/1`
}

export function readPendingFullExport(): PendingFullExport | null {
  try {
    const raw = sessionStorage.getItem(FULL_EXPORT_RESUME_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const v = parsed as Partial<PendingFullExport>
    if (!v.topicId || !v.startUrl) return null
    const createdAt = Number(v.createdAt)
    const attempt = Number(v.attempt)
    if (!Number.isFinite(createdAt) || !Number.isFinite(attempt)) return null
    return { topicId: String(v.topicId), startUrl: String(v.startUrl), createdAt, attempt }
  } catch {
    return null
  }
}

export function writePendingFullExport(value: PendingFullExport): void {
  try {
    sessionStorage.setItem(FULL_EXPORT_RESUME_KEY, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export function clearPendingFullExport(): void {
  try {
    sessionStorage.removeItem(FULL_EXPORT_RESUME_KEY)
  } catch {
    /* ignore */
  }
}

function updatePendingFullExport(topicId: number, startUrl: string): number {
  const now = Date.now()
  const prev = readPendingFullExport()
  const sameTopic = prev && String(prev.topicId || '') === String(topicId || '')
  const createdAt = sameTopic && Number.isFinite(prev.createdAt) ? prev.createdAt : now
  const attempt0 = sameTopic && Number.isFinite(prev.attempt) ? prev.attempt : 0
  const attempt = attempt0 + 1
  writePendingFullExport({
    topicId: String(topicId || ''),
    startUrl: String(startUrl || ''),
    createdAt,
    attempt,
  })
  return attempt
}

export async function ensureTopicAtFirstPost(options: {
  origin: string
  topicId: number
  slug: string | null
  signal: AbortSignal
  onStatus?: (message: string) => void
}): Promise<boolean> {
  const { signal, topicId } = options
  if (!topicId) return true

  // Already at top: clear pending state.
  if (getFirstPostElement()) {
    const pending = readPendingFullExport()
    if (pending && String(pending.topicId || '') === String(topicId)) clearPendingFullExport()
    return true
  }

  // If URL already looks like /1, give it a moment to render to avoid redirect loops.
  const currentPost = getPostNumberFromTopicPath(window.location.pathname)
  if (currentPost === 1) {
    for (let i = 0; i < 40; i += 1) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      if (getFirstPostElement()) {
        const pending = readPendingFullExport()
        if (pending && String(pending.topicId || '') === String(topicId)) clearPendingFullExport()
        return true
      }
      await sleep(250, signal)
    }
  }

  const startUrl = buildTopicStartUrl({ origin: options.origin, topicId, slug: options.slug })
  const attempt = updatePendingFullExport(topicId, startUrl)
  if (attempt > FULL_EXPORT_RESUME_MAX_ATTEMPTS) {
    clearPendingFullExport()
    toast('完整导出', '自动跳转到第 1 楼失败，请手动回到第 1 楼后再导出')
    return false
  }

  if (attempt === 1) {
    options.onStatus?.('检测到从中间楼层进入，正在跳转到第 1 楼后继续导出…')
    toast('完整导出', '检测到从中间楼层进入，正在跳转到第 1 楼后继续导出…')
  }

  // Prefer Discourse SPA routing (no hard refresh).
  let routed = false
  try {
    type GlobalLike = { DiscourseURL?: { routeTo?: (path: string) => void } }
    const root = (typeof unsafeWindow !== 'undefined'
      ? unsafeWindow
      : globalThis) as unknown as GlobalLike
    const durl = root?.DiscourseURL
    if (durl && typeof durl.routeTo === 'function') {
      let path = startUrl
      try {
        const u = new URL(startUrl, window.location.origin)
        path = `${u.pathname}${u.search}${u.hash}`
      } catch {
        /* ignore */
      }
      durl.routeTo(path)
      routed = true
    }
  } catch {
    /* ignore */
  }

  if (routed) {
    for (let i = 0; i < 40; i += 1) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      if (getFirstPostElement()) {
        clearPendingFullExport()
        return true
      }
      await sleep(250, signal)
    }
  }

  // Fallback: hard navigation. Pending export will resume after reload (sessionStorage).
  try {
    window.location.href = startUrl
  } catch {
    try {
      window.location.assign(startUrl)
    } catch {
      /* ignore */
    }
  }
  return false
}

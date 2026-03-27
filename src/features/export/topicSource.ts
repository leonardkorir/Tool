import { fetchPostsByIds, fetchTopicJson } from '../../platform/discourse/api'
import type { DiscourseTopicJson } from '../../platform/discourse/api'
import type { DiscoursePost } from '../../platform/discourse/api'
import { tryGetTopicJsonFromDataPreloaded } from '../../platform/discourse/preloaded'
import type { ExportProgress, TopicData } from './types'
import { normalizeTopicData } from './transform'
import { getPassiveTopicPostOuterHtmlCache } from './domPassiveCache'

export type TopicLoadMode = 'auto' | 'api' | 'dom-visible' | 'dom-scroll'

export type DomScrollConfig = {
  stepPx: number
  delayMs: number
  stableThreshold: number
  maxScrollCount: number
  collectIntervalMs: number
  scrollToTop: boolean
}

export type TopicLoadMetrics = {
  mode: TopicLoadMode
  topicJsonSource: 'preloaded' | 'api' | 'none'
  totalIds: number
  topicJsonPosts: number
  fromPassiveCache: number
  fromRenderedDom: number
  fetchedFromApi: number
  remainingMissing: number
  usedDomFallback: boolean
  fallbackMode: 'none' | 'dom-visible' | 'dom-scroll'
}

function getTopicPostCountHint(topicId: number): number | null {
  let hint: number | null = null

  const candidates = document.querySelectorAll<HTMLElement>(
    '.topic-post-count, [data-post-count], #topic-progress-wrapper, .topic-progress'
  )
  for (const el of Array.from(candidates)) {
    const parts: string[] = []
    const attr = el.getAttribute('data-post-count')
    if (attr) parts.push(attr)
    if (el.textContent) parts.push(el.textContent)

    for (const part of parts) {
      const nums = String(part).match(/\d+/g)
      if (!nums) continue
      for (const raw of nums) {
        const n = Number.parseInt(raw, 10)
        if (!Number.isFinite(n) || n <= 0) continue
        hint = hint == null ? n : Math.max(hint, n)
      }
    }
  }

  const preloaded = tryGetTopicJsonFromDataPreloaded(topicId)
  if (preloaded) {
    const streamLen = Array.isArray(preloaded.post_stream?.stream)
      ? preloaded.post_stream.stream.length
      : 0
    const postsCount = Number(preloaded.posts_count)
    const best = Math.max(
      Number.isFinite(postsCount) ? postsCount : 0,
      Number.isFinite(streamLen) ? streamLen : 0
    )
    if (best > 0) hint = hint == null ? best : Math.max(hint, best)
  }

  return hint && hint > 0 ? hint : null
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'))
    const t = setTimeout(() => resolve(), ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}

function parsePostNumberFromHref(href: string): number | null {
  const raw = String(href || '').trim()
  if (!raw) return null

  // #post_123 / #post-123
  const hash = raw.match(/#post[_-](\d+)\b/i)
  if (hash) {
    const n = Number.parseInt(hash[1], 10)
    return Number.isFinite(n) && n > 0 ? n : null
  }

  try {
    const u = new URL(raw, window.location.origin)
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts[0] !== 't') return null
    const numeric = parts.slice(1).filter((p) => /^\d+$/.test(p))
    if (numeric.length < 2) return null
    const postNumber = Number.parseInt(numeric[1], 10)
    return Number.isFinite(postNumber) && postNumber > 0 ? postNumber : null
  } catch {
    return null
  }
}

function collectRenderedTopicPosts(): Array<{
  id: number
  post_number: number
  username: string
  name?: string | null
  avatar_template?: string | null
  created_at: string
  cooked: string
  reply_to_post_number?: number | null
}> {
  const posts: Array<{
    id: number
    post_number: number
    username: string
    name?: string | null
    avatar_template?: string | null
    created_at: string
    cooked: string
    reply_to_post_number?: number | null
  }> = []

  const root =
    document.querySelector<HTMLElement>('div.post-stream') ??
    document.querySelector<HTMLElement>('#post-stream') ??
    document

  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>('.topic-post[data-post-number], article[data-post-number]')
  )
  const seen = new Set<number>()

  for (const el of nodes) {
    if (el.classList.contains('post-stream--cloaked')) continue
    const postNumRaw = el.getAttribute('data-post-number') || ''
    const postNumber = Number.parseInt(postNumRaw, 10)
    if (!Number.isFinite(postNumber) || postNumber <= 0) continue
    if (seen.has(postNumber)) continue

    const article =
      el.tagName === 'ARTICLE' ? el : el.querySelector<HTMLElement>('article[data-post-id]')
    if (!article) continue

    const postIdRaw = article.getAttribute('data-post-id')
    const postId = postIdRaw ? Number.parseInt(postIdRaw, 10) : NaN
    if (!Number.isFinite(postId) || postId <= 0) continue

    seen.add(postNumber)

    const timeEl = article.querySelector('time')
    const createdAt = timeEl?.getAttribute('datetime') || new Date().toISOString()

    const userEl = article.querySelector('a[data-user-card]')
    const username =
      userEl?.getAttribute('data-user-card') || userEl?.textContent?.trim() || 'unknown'

    const avatarImg =
      article.querySelector<HTMLImageElement>('img.avatar') ??
      article.querySelector<HTMLImageElement>('.topic-avatar img') ??
      article.querySelector<HTMLImageElement>('img[data-src][class*="avatar"]')
    const avatarTemplateRaw =
      (
        avatarImg?.getAttribute('data-src') ||
        avatarImg?.getAttribute('src') ||
        avatarImg?.currentSrc ||
        ''
      ).trim() || null

    const cookedEl = article.querySelector('.cooked')
    const cooked = cookedEl ? cookedEl.innerHTML : ''
    if (!String(cooked || '').trim()) continue

    // Best-effort reply-to: Discourse usually renders a.reply-to-tab linking to the parent post.
    const replyTab = article.querySelector<HTMLAnchorElement>('a.reply-to-tab[href]')
    const replyToPostNumber = replyTab
      ? parsePostNumberFromHref(replyTab.getAttribute('href') || replyTab.href)
      : null

    posts.push({
      id: postId,
      post_number: postNumber,
      username,
      name: null,
      avatar_template: avatarTemplateRaw,
      created_at: createdAt,
      cooked,
      reply_to_post_number: replyToPostNumber,
    })
  }

  return posts
}

function parseTopicPostOuterHtml(options: {
  html: string
  origin: string
  topicId: number
}): DiscoursePost | null {
  const html = String(options.html || '').trim()
  if (!html) return null

  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const root = tpl.content.firstElementChild as HTMLElement | null
  if (!root) return null

  const postNumberRaw =
    root.getAttribute('data-post-number') ||
    root.querySelector<HTMLElement>('[data-post-number]')?.getAttribute('data-post-number') ||
    ''
  const postNumber = Number.parseInt(postNumberRaw, 10)
  if (!Number.isFinite(postNumber) || postNumber <= 0) return null

  const article =
    root.tagName === 'ARTICLE'
      ? root
      : (root.querySelector<HTMLElement>('article[data-post-id]') ?? null)
  if (!article) return null

  const postIdRaw = article.getAttribute('data-post-id') || ''
  const postId = Number.parseInt(postIdRaw, 10)
  if (!Number.isFinite(postId) || postId <= 0) return null

  const timeEl = article.querySelector('time')
  const createdAt = timeEl?.getAttribute('datetime') || new Date().toISOString()

  const userEl = article.querySelector<HTMLElement>('a[data-user-card]')
  const username =
    userEl?.getAttribute('data-user-card') || userEl?.textContent?.trim() || 'unknown'

  const avatarImg =
    article.querySelector<HTMLImageElement>('img.avatar') ??
    article.querySelector<HTMLImageElement>('.topic-avatar img') ??
    article.querySelector<HTMLImageElement>('img[data-src][class*="avatar"]')
  const avatarTemplateRaw =
    (
      avatarImg?.getAttribute('data-src') ||
      avatarImg?.getAttribute('src') ||
      avatarImg?.currentSrc ||
      ''
    ).trim() || null

  const cookedEl = article.querySelector<HTMLElement>('.cooked')
  const cooked = cookedEl ? cookedEl.innerHTML : ''
  if (!String(cooked || '').trim()) return null

  const replyTab = article.querySelector<HTMLAnchorElement>('a.reply-to-tab[href]')
  const replyToPostNumber = replyTab
    ? parsePostNumberFromHref(replyTab.getAttribute('href') || replyTab.href)
    : null

  return {
    id: postId,
    post_number: postNumber,
    username,
    name: null,
    avatar_template: avatarTemplateRaw,
    created_at: createdAt,
    cooked,
    reply_to_post_number: replyToPostNumber,
  }
}

function loadTopicDataFromDom(options: {
  origin: string
  topicId: number
  slug: string
}): TopicData | null {
  const { origin, topicId, slug } = options
  const title = document.title?.trim() || `topic_${topicId}`

  const byId = new Map<number, DiscoursePost>()

  const passive = getPassiveTopicPostOuterHtmlCache(topicId)
  if (passive && passive.size > 0) {
    for (const html of passive.values()) {
      const p = parseTopicPostOuterHtml({ html, origin, topicId })
      if (p) byId.set(p.id, p)
    }
  }

  for (const p of collectRenderedTopicPosts()) byId.set(p.id, p as unknown as DiscoursePost)
  const posts = Array.from(byId.values())

  if (posts.length === 0) return null

  const topicJson = {
    id: topicId,
    title,
    slug,
    posts_count: posts.length,
    post_stream: {
      stream: posts.map((p) => p.id),
      posts,
    },
  } satisfies DiscourseTopicJson

  return normalizeTopicData({ origin, topicJson, posts: posts as unknown as DiscoursePost[] })
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  const n = Math.floor(value)
  return Math.min(max, Math.max(min, n))
}

async function loadTopicDataFromDomByScrolling(options: {
  origin: string
  topicId: number
  slug: string
  signal: AbortSignal
  onProgress?: (p: ExportProgress) => void
  config?: Partial<DomScrollConfig>
}): Promise<TopicData | null> {
  const { origin, topicId, slug, signal, onProgress } = options

  const startX = window.scrollX
  const startY = window.scrollY

  const title = document.title?.trim() || `topic_${topicId}`
  const byPostNumber = new Map<number, DiscoursePost>()
  const totalHint = getTopicPostCountHint(topicId)

  const collect = (): number => {
    const rendered = collectRenderedTopicPosts()
    let added = 0
    for (const p of rendered) {
      if (!byPostNumber.has(p.post_number)) {
        byPostNumber.set(p.post_number, p as unknown as DiscoursePost)
        added += 1
      }
    }
    return added
  }

  const countCloaked = (): number => {
    const root =
      document.querySelector<HTMLElement>('div.post-stream') ??
      document.querySelector<HTMLElement>('#post-stream') ??
      document
    try {
      return root.querySelectorAll('.post-stream--cloaked').length
    } catch {
      return 0
    }
  }

  const isAtBottom = (): boolean =>
    window.innerHeight + window.scrollY >= document.body.scrollHeight - 220
  const hasSpinner = (): boolean => {
    const selector = '.spinner, .loading-container, .topic-timeline .spinner, .user-stream .spinner'
    try {
      const nodes = Array.from(document.querySelectorAll(selector))
      for (const el of nodes) {
        if (el instanceof HTMLElement) {
          const style = window.getComputedStyle(el)
          if (style.display === 'none') continue
          if (style.visibility === 'hidden') continue
          if (style.opacity === '0') continue
        }
        try {
          const rect = el.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) continue
          const marginPx = 240
          if (rect.bottom < -marginPx) continue
          if (rect.top > window.innerHeight + marginPx) continue
        } catch {
          // If we can't measure, conservatively treat it as active.
          return true
        }
        return true
      }
      return false
    } catch {
      return false
    }
  }

  try {
    const cfg: DomScrollConfig = {
      stepPx: clampInt(options.config?.stepPx ?? 450, 50, 5000, 450),
      delayMs: clampInt(options.config?.delayMs ?? 850, 0, 60_000, 850),
      stableThreshold: clampInt(options.config?.stableThreshold ?? 10, 1, 60, 10),
      maxScrollCount: clampInt(options.config?.maxScrollCount ?? 1200, 50, 20_000, 1200),
      collectIntervalMs: clampInt(options.config?.collectIntervalMs ?? 320, 0, 10_000, 320),
      // v1 parity: full export should always start from top (we restore scroll position afterwards).
      scrollToTop: true,
    }

    if (cfg.scrollToTop) {
      window.scrollTo(startX, 0)
      await sleep(240, signal)
    }

    let stable = 0
    const baseStepPx = cfg.stepPx
    const baseDelayMs = cfg.delayMs
    let stepPx = cfg.stepPx
    let delayMs = cfg.delayMs

    for (let i = 0; i < cfg.maxScrollCount; i += 1) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')

      const added = collect()
      if (added > 0) stable = 0
      else stable += 1

      const cloaked = countCloaked()
      const spinner = hasSpinner()
      onProgress?.({
        stage: 'posts',
        done: byPostNumber.size,
        total: totalHint ?? undefined,
        message: totalHint
          ? `DOM 滚动收集… 已收集 ${byPostNumber.size}/${totalHint} 楼（cloaked ${cloaked}）`
          : `DOM 滚动收集… 已收集 ${byPostNumber.size} 楼（cloaked ${cloaked}）`,
      })

      if (totalHint && byPostNumber.size >= totalHint) break
      if (stable >= cfg.stableThreshold && (isAtBottom() || cloaked === 0) && !spinner) break

      // Adaptive scroll pacing:
      // - If a spinner is visible, slow down and reduce step to avoid "scrolling past" load triggers.
      // - Otherwise, gradually recover towards base, and nudge step up when nothing new is collected.
      if (spinner) {
        delayMs = clampInt(Math.max(delayMs, baseDelayMs) + 450, 0, 60_000, baseDelayMs)
        stepPx = clampInt(Math.floor(stepPx * 0.88), 50, 5000, baseStepPx)
      } else {
        delayMs = clampInt(Math.floor(delayMs * 0.92), baseDelayMs, 60_000, baseDelayMs)
        const bump = added > 0 ? 1.03 : stable >= 2 ? 1.07 : 1.02
        stepPx = clampInt(Math.floor(stepPx * bump), 50, 5000, baseStepPx)
      }

      window.scrollBy(0, stepPx)
      if (cfg.collectIntervalMs > 0) await sleep(cfg.collectIntervalMs, signal)
      collect()

      const remaining = Math.max(0, delayMs - cfg.collectIntervalMs)
      if (remaining > 0) await sleep(remaining, signal)
    }

    // Final sweep after stopping.
    collect()

    if (byPostNumber.size === 0) return null

    const posts = Array.from(byPostNumber.values()).sort((a, b) => a.post_number - b.post_number)
    const topicJson = {
      id: topicId,
      title,
      slug,
      posts_count: posts.length,
      post_stream: {
        stream: posts.map((p) => p.id),
        posts,
      },
    } satisfies DiscourseTopicJson

    return normalizeTopicData({ origin, topicJson, posts })
  } finally {
    // Best-effort restore view.
    try {
      window.scrollTo(startX, startY)
    } catch {
      /* ignore */
    }
  }
}

export async function loadTopicData(options: {
  origin: string
  topicId: number
  slug: string
  signal: AbortSignal
  onProgress?: (p: ExportProgress) => void
  mode?: TopicLoadMode
  domScrollConfig?: Partial<DomScrollConfig>
  networkDelayMs?: number
}): Promise<{ data: TopicData; metrics: TopicLoadMetrics }> {
  const { origin, topicId, slug, signal, onProgress } = options
  const mode: TopicLoadMode = options.mode ?? 'auto'

  if (mode === 'dom-visible') {
    onProgress?.({ stage: 'topic', message: 'DOM 导出（仅当前已渲染楼层）…' })
    const fallback = loadTopicDataFromDom({ origin, topicId, slug })
    if (fallback) {
      onProgress?.({ stage: 'topic', message: `DOM：已收集 ${fallback.posts.length} 楼` })
      return {
        data: fallback,
        metrics: {
          mode,
          topicJsonSource: 'none',
          totalIds: fallback.posts.length,
          topicJsonPosts: 0,
          fromPassiveCache: 0,
          fromRenderedDom: fallback.posts.length,
          fetchedFromApi: 0,
          remainingMissing: 0,
          usedDomFallback: true,
          fallbackMode: 'dom-visible',
        },
      }
    }
    throw new Error('DOM 中未找到可导出的楼层（可能尚未加载帖子）')
  }

  if (mode === 'dom-scroll') {
    onProgress?.({ stage: 'topic', message: 'DOM 导出（自动滚动收集）…' })
    const scrollFallback = await loadTopicDataFromDomByScrolling({
      origin,
      topicId,
      slug,
      signal,
      onProgress,
      config: options.domScrollConfig,
    })
    if (scrollFallback) {
      onProgress?.({ stage: 'topic', message: `DOM：已收集 ${scrollFallback.posts.length} 楼` })
      return {
        data: scrollFallback,
        metrics: {
          mode,
          topicJsonSource: 'none',
          totalIds: scrollFallback.posts.length,
          topicJsonPosts: 0,
          fromPassiveCache: 0,
          fromRenderedDom: scrollFallback.posts.length,
          fetchedFromApi: 0,
          remainingMissing: 0,
          usedDomFallback: true,
          fallbackMode: 'dom-scroll',
        },
      }
    }
    throw new Error('DOM 滚动导出失败：未收集到任何楼层')
  }

  const baseDelayMs = clampInt(Number(options.networkDelayMs ?? 800), 0, 10_000, 800)
  let adaptiveDelayMs = baseDelayMs

  let topicJson: DiscourseTopicJson
  let topicJsonSource: 'preloaded' | 'api' = 'api'
  try {
    const preloaded = tryGetTopicJsonFromDataPreloaded(topicId)
    if (preloaded) {
      onProgress?.({ stage: 'topic', message: '话题数据：使用页面预加载缓存…' })
      topicJson = preloaded
      topicJsonSource = 'preloaded'
    } else {
      onProgress?.({ stage: 'topic', message: '获取话题数据…' })
      topicJson = await fetchTopicJson({ origin, topicId, slug, signal })
      topicJsonSource = 'api'
    }
  } catch (err) {
    if (signal.aborted) throw err
    if (mode === 'api') throw err

    onProgress?.({ stage: 'topic', message: 'API 不可用，尝试 DOM 滚动导出…' })
    const scrollFallback = await loadTopicDataFromDomByScrolling({
      origin,
      topicId,
      slug,
      signal,
      onProgress,
      config: options.domScrollConfig,
    })
    if (scrollFallback) {
      onProgress?.({
        stage: 'topic',
        message: `DOM 导出：已收集 ${scrollFallback.posts.length} 楼`,
      })
      return {
        data: scrollFallback,
        metrics: {
          mode,
          topicJsonSource: 'none',
          totalIds: scrollFallback.posts.length,
          topicJsonPosts: 0,
          fromPassiveCache: 0,
          fromRenderedDom: scrollFallback.posts.length,
          fetchedFromApi: 0,
          remainingMissing: 0,
          usedDomFallback: true,
          fallbackMode: 'dom-scroll',
        },
      }
    }

    onProgress?.({ stage: 'topic', message: 'DOM 滚动导出不可用，尝试 DOM 快照…' })
    const fallback = loadTopicDataFromDom({ origin, topicId, slug })
    if (fallback) {
      onProgress?.({
        stage: 'topic',
        message: `DOM 兜底：仅导出当前已渲染楼层（${fallback.posts.length}）`,
      })
      return {
        data: fallback,
        metrics: {
          mode,
          topicJsonSource: 'none',
          totalIds: fallback.posts.length,
          topicJsonPosts: 0,
          fromPassiveCache: 0,
          fromRenderedDom: fallback.posts.length,
          fetchedFromApi: 0,
          remainingMissing: 0,
          usedDomFallback: true,
          fallbackMode: 'dom-visible',
        },
      }
    }
    throw err
  }

  const total = topicJson.post_stream.stream.length
  const byId = new Map<number, DiscoursePost>()
  for (const p of topicJson.post_stream.posts) byId.set(p.id, p)
  const initialInJson = byId.size

  let fromPassiveCache = 0
  let fromRenderedDom = 0

  // Merge in best-effort cached DOM posts (passive cache + rendered) to minimize network补齐.
  const passive = getPassiveTopicPostOuterHtmlCache(topicId)
  if (passive && passive.size > 0) {
    for (const html of passive.values()) {
      const parsed = parseTopicPostOuterHtml({ html, origin, topicId })
      if (parsed && !byId.has(parsed.id)) {
        byId.set(parsed.id, parsed)
        fromPassiveCache += 1
      }
    }
  }
  for (const p of collectRenderedTopicPosts()) {
    const post = p as unknown as DiscoursePost
    if (!byId.has(post.id)) {
      byId.set(post.id, post)
      fromRenderedDom += 1
    }
  }

  let done = byId.size
  onProgress?.({ stage: 'posts', done, total, message: '获取楼层内容…' })

  let fetchedFromApi = 0
  const fetchMissing = async (ids: number[], batchSize: number): Promise<void> => {
    for (let i = 0; i < ids.length; i += batchSize) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      const batch = ids.slice(i, i + batchSize)
      let posts: DiscoursePost[] = []
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        try {
          posts = await fetchPostsByIds({ origin, topicId, slug, postIds: batch, signal })
          // success: slowly recover towards base delay
          adaptiveDelayMs = Math.max(baseDelayMs, Math.floor(adaptiveDelayMs * 0.92))
          break
        } catch (err) {
          const status =
            typeof (err as { status?: unknown })?.status === 'number'
              ? (err as { status: number }).status
              : null
          if (status === 429 && attempt < 2) {
            // Adaptive backoff: grow delay, then wait with jitter.
            adaptiveDelayMs = Math.min(
              8000,
              Math.max(adaptiveDelayMs, baseDelayMs) + 600 + attempt * 800
            )
            const jitterMs = adaptiveDelayMs > 0 ? Math.floor(Math.random() * 240) : 0
            const waitMs = adaptiveDelayMs + jitterMs
            onProgress?.({
              stage: 'posts',
              done,
              total,
              message: `429 限流，等待 ${waitMs} 毫秒后重试…`,
            })
            await sleep(waitMs, signal)
            continue
          }
          throw err
        }
      }
      for (const p of posts) {
        if (!byId.has(p.id)) {
          byId.set(p.id, p)
          done += 1
          fetchedFromApi += 1
        }
      }
      onProgress?.({ stage: 'posts', done, total })
      const jitterMs = adaptiveDelayMs > 0 ? Math.floor(Math.random() * 240) : 0
      const waitMs = adaptiveDelayMs + jitterMs
      await sleep(waitMs, signal)
    }
  }

  const missing = topicJson.post_stream.stream.filter((id) => !byId.has(id))
  let apiErr: unknown = null
  try {
    await fetchMissing(missing, 30)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    apiErr = err
  }

  let remaining = topicJson.post_stream.stream.filter((id) => !byId.has(id))
  if (!apiErr && remaining.length > 0) {
    onProgress?.({
      stage: 'posts',
      done,
      total,
      message: `API 拉取不完整：缺少 ${remaining.length}/${total}，尝试小批量补齐…`,
    })
    try {
      await fetchMissing(remaining, 10)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      apiErr = err
    }
    remaining = topicJson.post_stream.stream.filter((id) => !byId.has(id))
  }

  if (remaining.length > 0) {
    const msg = `API 拉取不完整：缺少 ${remaining.length}/${total} 个楼层`
    if (mode === 'api') throw apiErr ?? new Error(`${msg}（建议切换为“自动”或“DOM 滚动”）`)

    onProgress?.({ stage: 'topic', message: `${msg}，切换到 DOM 滚动导出兜底…` })
    const scrollFallback = await loadTopicDataFromDomByScrolling({
      origin,
      topicId,
      slug,
      signal,
      onProgress,
      config: options.domScrollConfig,
    })
    if (scrollFallback) {
      onProgress?.({
        stage: 'topic',
        message: `DOM 导出：已收集 ${scrollFallback.posts.length} 楼（API 不完整已兜底）`,
      })
      return {
        data: scrollFallback,
        metrics: {
          mode,
          topicJsonSource,
          totalIds: total,
          topicJsonPosts: initialInJson,
          fromPassiveCache,
          fromRenderedDom,
          fetchedFromApi,
          remainingMissing: 0,
          usedDomFallback: true,
          fallbackMode: 'dom-scroll',
        },
      }
    }

    onProgress?.({ stage: 'topic', message: `${msg}（DOM 兜底失败，仍将导出已获取内容）` })
  }

  const allPosts = topicJson.post_stream.stream
    .map((id) => byId.get(id))
    .filter(Boolean) as DiscoursePost[]
  return {
    data: normalizeTopicData({ origin, topicJson, posts: allPosts }),
    metrics: {
      mode,
      topicJsonSource,
      totalIds: total,
      topicJsonPosts: initialInJson,
      fromPassiveCache,
      fromRenderedDom,
      fetchedFromApi,
      remainingMissing: remaining.length,
      usedDomFallback: false,
      fallbackMode: 'none',
    },
  }
}

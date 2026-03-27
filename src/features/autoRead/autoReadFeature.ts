import type { AppContext, Feature } from '../../app/types'
import type { Disposable } from '../../shared/disposable'
import { tryGetTopicJsonFromDataPreloaded } from '../../platform/discourse/preloaded'
import { combineDisposables, toDisposable } from '../../shared/disposable'
import { createButton, createNumberInput, createRow } from '../ui/dom'
import {
  AUTO_READ_START_EVENT,
  AUTO_READ_STOP_EVENT,
  AUTO_READ_TOGGLE_EVENT,
  emitUiRefresh,
} from '../ui/events'

type AutoReadState = 'idle' | 'running' | 'paused'
type AutoReadPreset = 'conservative' | 'balanced' | 'aggressive'

type AutoReadConfig = {
  stepMin: number
  stepMax: number
  delayMinMs: number
  delayMaxMs: number
  userActivityPauseMs: number
  commentLimit: number
  topicListLimit: number
  queueThrottleMinMs: number
  queueThrottleMaxMs: number
  fallbackTopicUrl: string
  minTopicStayMs: number
  bottomPauseMinMs: number
  bottomPauseMaxMs: number
  continueWhenHidden: boolean
  autoLikeEnabled: boolean
  autoLikeProbability: number
  autoLikeDailyLimit: number
  autoLikeLimitPerTopic: boolean
}

type TopicSource = 'unread' | 'new' | 'latest'
type TopicRef = {
  id: number
  lastReadPostNumber: number | null
  maxPostNumber: number | null
  unreadFromPostNumber: number | null
  source: TopicSource
}
type VisitedTopic = { id: number; unreadFrom: number; maxPost: number; at: number }
type PendingAutoLike = {
  topicId: number
  expiresAt: number
  postId: number | null
  target: HTMLElement | null
}

const FEATURE_ID = 'ld2-autoRead'

const KEY_ENABLED = 'read.enabled'
const KEY_STATE = 'read.state'
const KEY_CFG = 'read.config'
const KEY_QUEUE = 'read.queue'
const KEY_VISITED = 'read.visited'
const KEY_LIKE_DATE = 'read.like.date'
const KEY_LIKE_COUNT = 'read.like.count'
const KEY_LIKE_AUTO_COUNT = 'read.like.autoCount'
const KEY_LIKE_NEXT_AT = 'read.like.nextAt'

const VISITED_TTL_MS = 30 * 60_000

const AUTO_READ_PRESETS: Record<
  AutoReadPreset,
  Pick<AutoReadConfig, 'stepMin' | 'stepMax' | 'delayMinMs' | 'delayMaxMs'>
> = {
  conservative: { stepMin: 70, stepMax: 180, delayMinMs: 180, delayMaxMs: 360 },
  balanced: { stepMin: 80, stepMax: 360, delayMinMs: 60, delayMaxMs: 220 },
  aggressive: { stepMin: 180, stepMax: 520, delayMinMs: 40, delayMaxMs: 120 },
}

const LIKE_TARGET_SELECTOR = [
  '.discourse-reactions-reaction-button',
  '.discourse-reactions-actions button.btn-toggle-reaction-like',
  '.discourse-reactions-actions button.reaction-button',
  'nav.post-controls button.post-action-menu__like',
  'nav.post-controls button.like',
].join(', ')

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  const n = Math.floor(value)
  return Math.min(max, Math.max(min, n))
}

function clampFloat(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function randInt(min: number, max: number): number {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

function todayKey(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function fetchLatestTopicsPage(options: {
  origin: string
  source: TopicSource
  page: number
  commentLimit: number
  signal: AbortSignal
}): Promise<TopicRef[]> {
  const url = `${options.origin}/${options.source}.json?no_definitions=true&page=${options.page}`
  const res = await fetch(url, { signal: options.signal, credentials: 'include' })
  if (!res.ok) {
    const err = new Error(`http ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  type LatestTopic = {
    id?: unknown
    last_read_post_number?: unknown
    posts_count?: unknown
    highest_post_number?: unknown
  }
  const json = (await res.json()) as { topic_list?: { topics?: LatestTopic[] } }
  const topics = json.topic_list?.topics ?? []
  const out: TopicRef[] = []
  for (const t of topics) {
    const id = Number.parseInt(String(t?.id ?? ''), 10)
    if (!Number.isFinite(id)) continue

    const limit = Number(options.commentLimit)
    const postsCount = Number.parseInt(String(t?.posts_count ?? ''), 10)
    const highestPostNumber = Number.parseInt(String(t?.highest_post_number ?? ''), 10)
    const maxPostNumber =
      Number.isFinite(highestPostNumber) && highestPostNumber > 0
        ? highestPostNumber
        : Number.isFinite(postsCount)
          ? postsCount
          : null
    if (Number.isFinite(limit) && limit > 0 && maxPostNumber != null && maxPostNumber >= limit)
      continue

    const lastReadRaw = t?.last_read_post_number
    const lastRead = Number.parseInt(String(lastReadRaw ?? ''), 10)
    const lastReadPostNumber = Number.isFinite(lastRead) && lastRead > 0 ? lastRead : null
    const unreadFromPostNumber = lastReadPostNumber != null ? lastReadPostNumber + 1 : 1
    if (maxPostNumber != null && unreadFromPostNumber > maxPostNumber) continue

    out.push({
      id,
      lastReadPostNumber,
      maxPostNumber,
      unreadFromPostNumber,
      source: options.source,
    })
  }
  return out
}

function topicUrl(origin: string, topic: TopicRef): string {
  const unreadFrom =
    topic.unreadFromPostNumber ??
    (topic.lastReadPostNumber && topic.lastReadPostNumber > 0 ? topic.lastReadPostNumber + 1 : null)
  if (unreadFrom && unreadFrom > 1) {
    return `${origin}/t/topic/${topic.id}/${unreadFrom}`
  }
  return `${origin}/t/topic/${topic.id}`
}

function isAtBottom(): boolean {
  return window.innerHeight + window.scrollY >= document.body.scrollHeight - 160
}

function isVisibleElement(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return true
  const style = window.getComputedStyle(el)
  if (style.display === 'none') return false
  if (style.visibility === 'hidden') return false
  if (style.opacity === '0') return false
  try {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
  } catch {
    // ignore
  }
  return true
}

function isVisibleLikeTarget(target: HTMLElement): boolean {
  if (target instanceof HTMLButtonElement && target.disabled) return false
  if (target.getAttribute('aria-disabled') === 'true') return false
  return isVisibleElement(target)
}

function hasVisibleLoadingSpinner(): boolean {
  const topSpinner = document.querySelector('.loading-container .spinner, .topic-timeline .spinner')
  if (topSpinner && isVisibleElement(topSpinner)) return true

  const stream =
    document.querySelector<HTMLElement>('div.post-stream') ??
    document.querySelector<HTMLElement>('#post-stream')
  if (stream) {
    const s = stream.querySelector('.spinner')
    if (s && isVisibleElement(s)) return true
  }
  return false
}

function getRenderedPostProgress(): { count: number; highestPostNumber: number | null } {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>('.topic-post[data-post-number], article[data-post-number]')
  )
  const seen = new Set<number>()
  let highestPostNumber: number | null = null
  for (const row of rows) {
    const raw = row.getAttribute('data-post-number') ?? ''
    const postNumber = Number.parseInt(raw, 10)
    if (!Number.isFinite(postNumber) || postNumber <= 0 || seen.has(postNumber)) continue
    seen.add(postNumber)
    highestPostNumber = highestPostNumber == null ? postNumber : Math.max(highestPostNumber, postNumber)
  }
  return { count: seen.size, highestPostNumber }
}

function getTopicMaxPostHint(topicId: number): number | null {
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
        const value = Number.parseInt(raw, 10)
        if (!Number.isFinite(value) || value <= 0) continue
        hint = hint == null ? value : Math.max(hint, value)
      }
    }
  }

  const preloaded = tryGetTopicJsonFromDataPreloaded(topicId)
  if (preloaded) {
    const preloadedHighestPostNumber = Array.isArray(preloaded.post_stream?.posts)
      ? preloaded.post_stream.posts.reduce((max, post) => {
          const postNumber =
            typeof post?.post_number === 'number' && Number.isFinite(post.post_number)
              ? post.post_number
              : 0
          return Math.max(max, postNumber)
        }, 0)
      : 0
    const streamLen = Array.isArray(preloaded.post_stream?.stream) ? preloaded.post_stream.stream.length : 0
    const postsCount = Number(preloaded.posts_count)
    const best = Math.max(
      Number.isFinite(postsCount) ? postsCount : 0,
      Number.isFinite(streamLen) ? streamLen : 0,
      preloadedHighestPostNumber
    )
    if (best > 0) hint = hint == null ? best : Math.max(hint, best)
  }

  return hint && hint > 0 ? hint : null
}

type TopicDomSnapshot = {
  topicId: number
  postCount: number
  highestPostNumber: number | null
  maxPostHint: number | null
  hasVisibleSpinner: boolean
}

function isAbortLikeError(err: unknown, signal?: AbortSignal | null): boolean {
  if (signal?.aborted) return true
  if (err instanceof DOMException && err.name === 'AbortError') return true
  if (!(err instanceof Error)) return false
  if (err.name === 'AbortError') return true
  const msg = err.message.toLowerCase()
  return (
    msg.includes('signal is aborted') ||
    msg.includes('aborterror') ||
    msg.startsWith('aborted') ||
    msg.includes(' aborted')
  )
}

function getLikeTargetHintText(target: Element): string {
  const parts = [
    target.getAttribute('title') ?? '',
    target.getAttribute('aria-label') ?? '',
    target.getAttribute('data-reaction') ?? '',
    target.getAttribute('class') ?? '',
  ]
  const innerButton = target.querySelector<HTMLElement>('button')
  if (innerButton) {
    parts.push(
      innerButton.getAttribute('title') ?? '',
      innerButton.getAttribute('aria-label') ?? '',
      innerButton.getAttribute('data-reaction') ?? '',
      innerButton.getAttribute('class') ?? ''
    )
  }
  return parts.join(' ').toLowerCase()
}

function isProbablyLikeAction(target: HTMLElement): boolean {
  if (target.classList.contains('btn-toggle-reaction-like')) return true
  if (target.classList.contains('discourse-reactions-reaction-button')) {
    const title = String(target.getAttribute('title') ?? '').trim().toLowerCase()
    if (title.includes('like') || title.includes('赞') || title.includes('喜欢')) return true
  }
  const hint = getLikeTargetHintText(target)
  if (hint.includes('btn-toggle-reaction-like')) return true
  if (hint.includes('点赞此帖子') || hint.includes('like this post')) return true
  if (hint.includes(' like ') || hint.startsWith('like ') || hint.endsWith(' like')) return true
  if (hint.includes('赞') || hint.includes('喜欢')) return true
  return hint.includes('like')
}

function findRandomLikeTarget(): HTMLElement | null {
  const root = document.querySelector<HTMLElement>('div.post-stream') ?? document
  const candidates: HTMLElement[] = []
  const articles = Array.from(root.querySelectorAll<HTMLElement>('article[data-post-id]'))
  for (const article of articles) {
    if (article.classList.contains('my-post')) continue
    const targets = Array.from(article.querySelectorAll<HTMLElement>(LIKE_TARGET_SELECTOR))
    for (const target of targets) {
      if (target.closest('.my-post')) continue
      if (!isProbablyLikeAction(target)) continue
      if (!isVisibleLikeTarget(target)) continue
      if (isLikeTargetPressed(target)) continue
      candidates.push(target)
    }
  }
  if (candidates.length === 0) return null

  return candidates[Math.floor(Math.random() * candidates.length)] ?? null
}

function isLikeTargetPressed(target: HTMLElement): boolean {
  const reactions = target.closest<HTMLElement>('.discourse-reactions-actions')
  if (reactions?.classList.contains('has-reacted')) return true

  const aria = target.getAttribute('aria-pressed')
  if (aria === 'true') return true
  if (target.classList.contains('has-like')) return true
  if (target.classList.contains('reaction-button--active')) return true
  if (target.closest('.discourse-reactions-reaction-button.is-used')) return true
  const innerButton = target.querySelector<HTMLElement>('button[aria-pressed="true"]')
  if (innerButton) return true
  return false
}

function triggerLikeClick(target: HTMLElement): void {
  const clickTarget =
    target.closest<HTMLElement>('.discourse-reactions-reaction-button') ?? target
  clickTarget.click()
}

export function autoReadFeature(): Feature {
  return {
    id: FEATURE_ID,
    mount(ctx: AppContext) {
      const statusEl = document.getElementById('ld2-read-status')
      const controls = document.getElementById('ld2-read-controls')
      if (!statusEl || !controls) {
        ctx.logger.warn('autoRead ui missing')
        return
      }
      const status = statusEl

      const cfgDefault: AutoReadConfig = {
        // Faster defaults (still randomized); keep enough delay to avoid starving late-loading posts.
        stepMin: 80,
        stepMax: 360,
        delayMinMs: 60,
        delayMaxMs: 220,
        userActivityPauseMs: 0,
        commentLimit: 2000,
        topicListLimit: 50,
        queueThrottleMinMs: 60,
        queueThrottleMaxMs: 180,
        fallbackTopicUrl: '',
        minTopicStayMs: 1200,
        bottomPauseMinMs: 120,
        bottomPauseMaxMs: 300,
        continueWhenHidden: true,
        autoLikeEnabled: false,
        autoLikeProbability: 0.1,
        autoLikeDailyLimit: 30,
        autoLikeLimitPerTopic: false,
      }

      function readConfig(): AutoReadConfig {
        const raw = ctx.storage.get(KEY_CFG, cfgDefault)
        const cfg = { ...cfgDefault, ...(raw as Partial<AutoReadConfig>) }
        return {
          ...cfg,
          stepMin: clampInt(cfg.stepMin, 10, 2000, cfgDefault.stepMin),
          stepMax: clampInt(cfg.stepMax, 10, 2000, cfgDefault.stepMax),
          delayMinMs: clampInt(cfg.delayMinMs, 10, 60_000, cfgDefault.delayMinMs),
          delayMaxMs: clampInt(cfg.delayMaxMs, 10, 60_000, cfgDefault.delayMaxMs),
          userActivityPauseMs: clampInt(
            cfg.userActivityPauseMs,
            0,
            60_000,
            cfgDefault.userActivityPauseMs
          ),
          commentLimit: clampInt(cfg.commentLimit, 0, 50_000, cfgDefault.commentLimit),
          topicListLimit: clampInt(cfg.topicListLimit, 1, 200, cfgDefault.topicListLimit),
          queueThrottleMinMs: clampInt(
            cfg.queueThrottleMinMs,
            0,
            60_000,
            cfgDefault.queueThrottleMinMs
          ),
          queueThrottleMaxMs: clampInt(
            cfg.queueThrottleMaxMs,
            0,
            60_000,
            cfgDefault.queueThrottleMaxMs
          ),
          fallbackTopicUrl:
            typeof cfg.fallbackTopicUrl === 'string' ? cfg.fallbackTopicUrl.trim() : '',
          minTopicStayMs: clampInt(cfg.minTopicStayMs, 0, 10 * 60_000, cfgDefault.minTopicStayMs),
          bottomPauseMinMs: clampInt(cfg.bottomPauseMinMs, 0, 60_000, cfgDefault.bottomPauseMinMs),
          bottomPauseMaxMs: clampInt(cfg.bottomPauseMaxMs, 0, 120_000, cfgDefault.bottomPauseMaxMs),
          continueWhenHidden: !!cfg.continueWhenHidden,
          autoLikeEnabled: !!cfg.autoLikeEnabled,
          autoLikeProbability: clampFloat(
            cfg.autoLikeProbability,
            0,
            1,
            cfgDefault.autoLikeProbability
          ),
          autoLikeDailyLimit: clampInt(
            cfg.autoLikeDailyLimit,
            0,
            500,
            cfgDefault.autoLikeDailyLimit
          ),
          autoLikeLimitPerTopic: !!cfg.autoLikeLimitPerTopic,
        }
      }

      function writeConfig(cfg: AutoReadConfig): void {
        ctx.storage.set(KEY_CFG, cfg)
        emitUiRefresh()
      }

      function setStatus(text: string): void {
        status.textContent = text
        emitUiRefresh()
      }

      const startBtn = createButton({ text: '开始', className: 'btn primary' })

      const pauseBtn = createButton({ text: '暂停', className: 'btn' })

      const stopBtn = createButton({ text: '停止', className: 'btn danger' })

      const likeLabel = document.createElement('label')
      likeLabel.style.display = 'flex'
      likeLabel.style.alignItems = 'center'
      likeLabel.style.gap = '8px'
      likeLabel.style.fontSize = '12px'
      const likeCb = document.createElement('input')
      likeCb.type = 'checkbox'
      likeLabel.appendChild(likeCb)
      likeLabel.appendChild(document.createTextNode('自动点赞'))

      const likeInfo = document.createElement('div')
      likeInfo.className = 'ld2-muted'
      likeInfo.style.fontSize = '12px'
      likeInfo.style.lineHeight = '1.5'
      likeInfo.style.marginTop = '6px'

      const stepMinInput = createNumberInput({
        min: 10,
        max: 2000,
        step: 10,
        widthPx: 84,
        placeholder: '最小',
      })
      stepMinInput.setAttribute('aria-label', '步长最小值（像素）')

      const stepMaxInput = createNumberInput({
        min: 10,
        max: 2000,
        step: 10,
        widthPx: 84,
        placeholder: '最大',
      })
      stepMaxInput.setAttribute('aria-label', '步长最大值（像素）')

      const delayMinInput = createNumberInput({
        min: 10,
        max: 60000,
        step: 10,
        widthPx: 84,
        placeholder: '最小',
      })
      delayMinInput.setAttribute('aria-label', '间隔最小值（毫秒）')

      const delayMaxInput = createNumberInput({
        min: 10,
        max: 60000,
        step: 10,
        widthPx: 84,
        placeholder: '最大',
      })
      delayMaxInput.setAttribute('aria-label', '间隔最大值（毫秒）')

      const stepRange = document.createElement('div')
      stepRange.className = 'stack ld2-pair-grid'
      stepRange.appendChild(stepMinInput)
      stepRange.appendChild(stepMaxInput)

      const delayRange = document.createElement('div')
      delayRange.className = 'stack ld2-pair-grid'
      delayRange.appendChild(delayMinInput)
      delayRange.appendChild(delayMaxInput)

      const advanced = document.createElement('details')
      advanced.style.marginTop = '8px'
      const advancedSummary = document.createElement('summary')
      advancedSummary.textContent = '高级'
      advancedSummary.style.cursor = 'pointer'
      advancedSummary.style.fontSize = '12px'
      advancedSummary.style.color = 'var(--ld2-muted)'
      advanced.appendChild(advancedSummary)

      const advWrap = document.createElement('div')
      advWrap.className = 'stack vertical'
      advWrap.style.marginTop = '8px'

      const userActivityPauseInput = document.createElement('input')
      userActivityPauseInput.type = 'number'
      userActivityPauseInput.min = '0'
      userActivityPauseInput.max = '60000'
      userActivityPauseInput.step = '200'
      userActivityPauseInput.placeholder = '0'
      userActivityPauseInput.setAttribute('aria-label', '用户操作暂停（毫秒，0=不暂停）')
      userActivityPauseInput.className = 'ld2-field-md'

      const continueWhenHiddenLabel = document.createElement('label')
      continueWhenHiddenLabel.style.display = 'flex'
      continueWhenHiddenLabel.style.alignItems = 'center'
      continueWhenHiddenLabel.style.gap = '8px'
      continueWhenHiddenLabel.style.fontSize = '12px'
      const continueWhenHiddenCb = document.createElement('input')
      continueWhenHiddenCb.type = 'checkbox'
      continueWhenHiddenLabel.appendChild(continueWhenHiddenCb)
      continueWhenHiddenLabel.appendChild(document.createTextNode('开启'))

      const commentLimitInput = document.createElement('input')
      commentLimitInput.type = 'number'
      commentLimitInput.min = '0'
      commentLimitInput.max = '50000'
      commentLimitInput.step = '100'
      commentLimitInput.placeholder = '2000'
      commentLimitInput.setAttribute('aria-label', '跳过超长话题（楼层数 ≥ 阈值）')
      commentLimitInput.className = 'ld2-field-md'

      const topicListLimitInput = document.createElement('input')
      topicListLimitInput.type = 'number'
      topicListLimitInput.min = '1'
      topicListLimitInput.max = '200'
      topicListLimitInput.step = '1'
      topicListLimitInput.placeholder = '50'
      topicListLimitInput.setAttribute('aria-label', '队列填充上限（条）')
      topicListLimitInput.className = 'ld2-field-md'

      const queueThrottleMinInput = document.createElement('input')
      queueThrottleMinInput.type = 'number'
      queueThrottleMinInput.min = '0'
      queueThrottleMinInput.max = '60000'
      queueThrottleMinInput.step = '50'
      queueThrottleMinInput.placeholder = '最小'
      queueThrottleMinInput.setAttribute('aria-label', '队列抓取间隔最小值（毫秒）')

      const queueThrottleMaxInput = document.createElement('input')
      queueThrottleMaxInput.type = 'number'
      queueThrottleMaxInput.min = '0'
      queueThrottleMaxInput.max = '60000'
      queueThrottleMaxInput.step = '50'
      queueThrottleMaxInput.placeholder = '最大'
      queueThrottleMaxInput.setAttribute('aria-label', '队列抓取间隔最大值（毫秒）')

      const queueThrottleRange = document.createElement('div')
      queueThrottleRange.className = 'stack ld2-pair-grid'
      queueThrottleRange.appendChild(queueThrottleMinInput)
      queueThrottleRange.appendChild(queueThrottleMaxInput)

      const fallbackTopicInput = document.createElement('input')
      fallbackTopicInput.type = 'text'
      fallbackTopicInput.placeholder = '可选：/t/topic/13716/900'
      fallbackTopicInput.setAttribute('aria-label', '无话题时兜底话题链接（留空则 /latest）')
      fallbackTopicInput.className = 'ld2-field-md'

      const minStayInput = document.createElement('input')
      minStayInput.type = 'number'
      minStayInput.min = '0'
      minStayInput.max = '600000'
      minStayInput.step = '500'
      minStayInput.placeholder = '例如：12000'
      minStayInput.setAttribute('aria-label', '每个话题最少停留（毫秒）')
      minStayInput.className = 'ld2-field-md'

      const bottomPauseMinInput = document.createElement('input')
      bottomPauseMinInput.type = 'number'
      bottomPauseMinInput.min = '0'
      bottomPauseMinInput.max = '120000'
      bottomPauseMinInput.step = '200'
      bottomPauseMinInput.placeholder = '最小'
      bottomPauseMinInput.setAttribute('aria-label', '到底部后停留最小值（毫秒）')

      const bottomPauseMaxInput = document.createElement('input')
      bottomPauseMaxInput.type = 'number'
      bottomPauseMaxInput.min = '0'
      bottomPauseMaxInput.max = '120000'
      bottomPauseMaxInput.step = '200'
      bottomPauseMaxInput.placeholder = '最大'
      bottomPauseMaxInput.setAttribute('aria-label', '到底部后停留最大值（毫秒）')

      const bottomPauseRange = document.createElement('div')
      bottomPauseRange.className = 'stack ld2-pair-grid'
      bottomPauseRange.appendChild(bottomPauseMinInput)
      bottomPauseRange.appendChild(bottomPauseMaxInput)

      const likeProbabilityInput = document.createElement('input')
      likeProbabilityInput.type = 'number'
      likeProbabilityInput.min = '0'
      likeProbabilityInput.max = '1'
      likeProbabilityInput.step = '0.05'
      likeProbabilityInput.placeholder = '0.10'
      likeProbabilityInput.setAttribute('aria-label', '自动点赞概率（0-1）')

      const likeDailyLimitInput = document.createElement('input')
      likeDailyLimitInput.type = 'number'
      likeDailyLimitInput.min = '0'
      likeDailyLimitInput.max = '500'
      likeDailyLimitInput.step = '1'
      likeDailyLimitInput.placeholder = '30'
      likeDailyLimitInput.setAttribute('aria-label', '自动点赞每日上限（次）')

      const likeAdvRange = document.createElement('div')
      likeAdvRange.className = 'stack ld2-pair-grid'
      likeAdvRange.appendChild(likeProbabilityInput)
      likeAdvRange.appendChild(likeDailyLimitInput)

      const likeLimitPerTopicLabel = document.createElement('label')
      likeLimitPerTopicLabel.style.display = 'flex'
      likeLimitPerTopicLabel.style.alignItems = 'center'
      likeLimitPerTopicLabel.style.gap = '8px'
      likeLimitPerTopicLabel.style.fontSize = '12px'

      const likeLimitPerTopicCb = document.createElement('input')
      likeLimitPerTopicCb.type = 'checkbox'
      likeLimitPerTopicLabel.appendChild(likeLimitPerTopicCb)
      likeLimitPerTopicLabel.appendChild(document.createTextNode('限制同一话题只点一次'))

      advWrap.appendChild(
        createRow({
          title: '用户操作暂停（毫秒）',
          right: userActivityPauseInput,
        })
      )
      advWrap.appendChild(
        createRow({
          title: '后台继续运行',
          right: continueWhenHiddenLabel,
        })
      )
      advWrap.appendChild(
        createRow({
          title: '超长话题跳过',
          right: commentLimitInput,
        })
      )
      advWrap.appendChild(
        createRow({
          title: '队列填充上限',
          right: topicListLimitInput,
        })
      )
      advWrap.appendChild(
        createRow({
          title: '队列抓取间隔（毫秒）',
          right: queueThrottleRange,
        })
      )
      advWrap.appendChild(
        createRow({
          title: '无话题兜底',
          right: fallbackTopicInput,
        })
      )
      advWrap.appendChild(
        createRow({
          title: '最少停留（毫秒）',
          right: minStayInput,
        })
      )
      advWrap.appendChild(
        createRow({
          title: '底部等待（毫秒）',
          right: bottomPauseRange,
        })
      )
      advWrap.appendChild(
        createRow({
          title: '点赞（概率 / 上限）',
          right: likeAdvRange,
        })
      )
      advWrap.appendChild(
        createRow({
          title: '同话题仅点一次',
          right: likeLimitPerTopicLabel,
        })
      )
      advanced.appendChild(advWrap)

      const presetWrap = document.createElement('div')
      presetWrap.className = 'ld2-presets'
      const presetButtons = new Map<AutoReadPreset, HTMLButtonElement>()
      const renderPresetSelection = (cfg: AutoReadConfig) => {
        for (const [key, btn] of presetButtons) {
          const preset = AUTO_READ_PRESETS[key]
          const selected =
            cfg.stepMin === preset.stepMin &&
            cfg.stepMax === preset.stepMax &&
            cfg.delayMinMs === preset.delayMinMs &&
            cfg.delayMaxMs === preset.delayMaxMs
          btn.classList.toggle('selected', selected)
        }
      }
      const applyPreset = (presetKey: AutoReadPreset) => {
        const cfg = readConfig()
        const preset = AUTO_READ_PRESETS[presetKey]
        cfg.stepMin = preset.stepMin
        cfg.stepMax = preset.stepMax
        cfg.delayMinMs = preset.delayMinMs
        cfg.delayMaxMs = preset.delayMaxMs
        writeConfig(cfg)
        stepMinInput.value = String(cfg.stepMin)
        stepMaxInput.value = String(cfg.stepMax)
        delayMinInput.value = String(cfg.delayMinMs)
        delayMaxInput.value = String(cfg.delayMaxMs)
        renderPresetSelection(cfg)
      }
      for (const [key, title, desc] of [
        ['conservative', '保守', '更稳，适合长时间挂机'],
        ['balanced', '均衡', '默认推荐，速度与稳定折中'],
        ['aggressive', '激进', '更快，但更容易触发限流'],
      ] as const) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'ld2-preset'
        btn.innerHTML = `<strong>${title}</strong><span>${desc}</span>`
        btn.addEventListener('click', () => applyPreset(key))
        presetButtons.set(key, btn)
        presetWrap.appendChild(btn)
      }

      const actionsRow = document.createElement('div')
      actionsRow.className = 'stack ld2-action-grid'
      actionsRow.appendChild(startBtn)
      actionsRow.appendChild(pauseBtn)
      actionsRow.appendChild(stopBtn)

      controls.appendChild(presetWrap)
      controls.appendChild(actionsRow)
      controls.appendChild(
        createRow({
          title: '步长范围（像素）',
          right: stepRange,
        })
      )
      controls.appendChild(
        createRow({
          title: '间隔范围（毫秒）',
          right: delayRange,
        })
      )
      controls.appendChild(advanced)
      controls.appendChild(likeLabel)
      controls.appendChild(likeInfo)

      let state: AutoReadState = 'idle'
      let timer: number | null = null
      let controller: AbortController | null = null
      let tickInFlight = false
      let pendingTick = false
      let topicEnterAt = 0
      let bottomArrivedAt = 0
      let bottomPauseMs = 0
      let lastTopicId: number | null = null
      let lastAutoLikeTopicId: number | null = null
      let lastActivityAt = 0
      let likePlannedTopicId: number | null = null
      let likeTriggerAtMs = 0
      let likeTriggerMinRenderedPosts = 0
      let pendingAutoLike: PendingAutoLike | null = null
      let pendingAutoLikeConfirmTimer: number | null = null
      let pendingTopicExpectation: { topicId: number; maxPostNumber: number | null } | null = null
      let currentTopicExpectedMaxPostNumber: number | null = null
      let lastRenderedHighestPostNumber = 0
      let lastRenderedProgressAt = 0
      let waitMoreStartedAt = 0
      let topicDomSnapshot: TopicDomSnapshot | null = null
      let topicDomDirty = true
      let topicDomObservedTopicId: number | null = null
      let topicDomObserver: MutationObserver | null = null
      let topicDomObserverRetryTimer: number | null = null

      function normalizeVisited(raw: unknown): VisitedTopic[] {
        const out: VisitedTopic[] = []
        if (!Array.isArray(raw)) return out
        for (const item of raw) {
          if (typeof item === 'number') {
            const id = Math.floor(item)
            if (!Number.isFinite(id) || id <= 0) continue
            out.push({ id, unreadFrom: 0, maxPost: 0, at: 0 })
            continue
          }
          if (!item || typeof item !== 'object') continue
          const maybe = item as Partial<VisitedTopic> & {
            id?: unknown
            unreadFrom?: unknown
            maxPost?: unknown
            postsCount?: unknown
            at?: unknown
          }
          const id = Number.parseInt(String(maybe.id ?? ''), 10)
          if (!Number.isFinite(id) || id <= 0) continue
          const unreadFrom = Number.parseInt(String(maybe.unreadFrom ?? ''), 10)
          const maxPostRaw =
            (typeof maybe.maxPost === 'number' || typeof maybe.maxPost === 'string'
              ? maybe.maxPost
              : null) ??
            (typeof maybe.postsCount === 'number' || typeof maybe.postsCount === 'string'
              ? maybe.postsCount
              : null)
          const maxPost = Number.parseInt(String(maxPostRaw ?? ''), 10)
          const at = Number.parseInt(String(maybe.at ?? ''), 10)
          out.push({
            id,
            unreadFrom: Number.isFinite(unreadFrom) && unreadFrom > 0 ? unreadFrom : 0,
            maxPost: Number.isFinite(maxPost) && maxPost > 0 ? maxPost : 0,
            at: Number.isFinite(at) && at > 0 ? at : 0,
          })
        }
        return out
      }

      function readVisited(): VisitedTopic[] {
        return normalizeVisited(ctx.storage.get(KEY_VISITED, [] as unknown as unknown[]))
      }

      function computeUnreadFrom(topic: TopicRef): number {
        if (topic.unreadFromPostNumber != null && topic.unreadFromPostNumber > 0)
          return topic.unreadFromPostNumber
        if (topic.lastReadPostNumber != null && topic.lastReadPostNumber > 0)
          return topic.lastReadPostNumber + 1
        return 0
      }

      function clearTimer(): void {
        if (timer != null) {
          window.clearTimeout(timer)
          timer = null
        }
      }

      function clearTopicDomObserverRetryTimer(): void {
        if (topicDomObserverRetryTimer != null) {
          window.clearTimeout(topicDomObserverRetryTimer)
          topicDomObserverRetryTimer = null
        }
      }

      function disconnectTopicDomObserver(): void {
        topicDomObserver?.disconnect()
        topicDomObserver = null
        topicDomObservedTopicId = null
        clearTopicDomObserverRetryTimer()
      }

      function invalidateTopicDomSnapshot(topicId: number | null = null): void {
        topicDomDirty = true
        if (topicId == null || topicDomSnapshot?.topicId !== topicId) {
          topicDomSnapshot = null
        }
      }

      function syncTopicDomObserver(route = ctx.discourse.getRouteInfo()): void {
        if (!route.isTopic || !route.topicId) {
          disconnectTopicDomObserver()
          invalidateTopicDomSnapshot()
          return
        }
        if (topicDomObservedTopicId === route.topicId && topicDomObserver) return

        disconnectTopicDomObserver()
        topicDomObservedTopicId = route.topicId

        const observer = new MutationObserver(() => {
          invalidateTopicDomSnapshot(route.topicId)
        })

        let observedAny = false
        const observe = (target: Node | null, options: MutationObserverInit): void => {
          if (!target) return
          observer.observe(target, options)
          observedAny = true
        }

        const stream =
          document.querySelector<HTMLElement>('div.post-stream') ??
          document.querySelector<HTMLElement>('#post-stream')
        observe(stream, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'data-post-number'],
        })

        const progressTargets = [
          document.querySelector<HTMLElement>('.loading-container'),
          document.querySelector<HTMLElement>('.topic-timeline'),
          document.querySelector<HTMLElement>('#topic-progress-wrapper'),
          document.querySelector<HTMLElement>('.topic-progress'),
        ]
        for (const target of progressTargets) {
          observe(target, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
            attributeFilter: ['class', 'data-post-count'],
          })
        }

        if (!observedAny) {
          observer.disconnect()
          topicDomObserver = null
          clearTopicDomObserverRetryTimer()
          topicDomObserverRetryTimer = window.setTimeout(() => {
            topicDomObserverRetryTimer = null
            if (state === 'idle') return
            syncTopicDomObserver()
          }, 300)
          return
        }

        topicDomObserver = observer
      }

      function getTopicDomSnapshot(topicId: number): TopicDomSnapshot {
        syncTopicDomObserver({ ...ctx.discourse.getRouteInfo(), isTopic: true, topicId })
        if (!topicDomDirty && topicDomSnapshot?.topicId === topicId) return topicDomSnapshot

        const rendered = getRenderedPostProgress()
        const next: TopicDomSnapshot = {
          topicId,
          postCount: rendered.count,
          highestPostNumber: rendered.highestPostNumber,
          maxPostHint: getTopicMaxPostHint(topicId),
          hasVisibleSpinner: hasVisibleLoadingSpinner(),
        }
        topicDomSnapshot = next
        topicDomDirty = false
        return next
      }

      function scheduleTick(delayMs: number, predicate?: () => boolean): void {
        clearTimer()
        timer = window.setTimeout(() => {
          timer = null
          if (state !== 'running') return
          if (predicate && !predicate()) return
          if (tickInFlight) {
            pendingTick = true
            return
          }
          void tick()
        }, Math.max(0, delayMs))
      }

      function requestTick(): void {
        clearTimer()
        if (state !== 'running') return
        if (tickInFlight) {
          pendingTick = true
          return
        }
        void tick()
      }

      function setState(next: AutoReadState): void {
        state = next
        ctx.storage.set(KEY_ENABLED, next !== 'idle')
        ctx.storage.set(KEY_STATE, next)
        startBtn.disabled = state === 'running'
        pauseBtn.disabled = state === 'idle'
        stopBtn.disabled = state === 'idle'
        pauseBtn.textContent = state === 'paused' ? '继续' : '暂停'
        setStatus(state === 'idle' ? '空闲' : state === 'paused' ? '已暂停' : '运行中')
      }

      function clearPendingAutoLikeConfirmTimer(): void {
        if (pendingAutoLikeConfirmTimer == null) return
        window.clearTimeout(pendingAutoLikeConfirmTimer)
        pendingAutoLikeConfirmTimer = null
      }

      function clearPendingAutoLike(): void {
        pendingAutoLike = null
        clearPendingAutoLikeConfirmTimer()
      }

      function findLikeArticle(postId: number | null): HTMLElement | null {
        if (!Number.isFinite(postId) || postId == null || postId <= 0) return null
        return document.querySelector<HTMLElement>(`article[data-post-id="${postId}"]`)
      }

      function isLikeConfirmedInArticle(article: HTMLElement | null): boolean {
        if (!article) return false
        const targets = Array.from(article.querySelectorAll<HTMLElement>(LIKE_TARGET_SELECTOR))
        for (const target of targets) {
          if (!isProbablyLikeAction(target)) continue
          if (isLikeTargetPressed(target)) return true
        }
        return false
      }

      function isPendingAutoLikeConfirmed(pending: PendingAutoLike): boolean {
        if (pending.target?.isConnected && isLikeTargetPressed(pending.target)) return true
        return isLikeConfirmedInArticle(findLikeArticle(pending.postId))
      }

      function schedulePendingAutoLikeConfirmation(cfg: AutoReadConfig): void {
        clearPendingAutoLikeConfirmTimer()

        const poll = () => {
          pendingAutoLikeConfirmTimer = null
          const pending = pendingAutoLike
          if (!pending) return
          if (pending.expiresAt <= Date.now()) {
            clearPendingAutoLike()
            refreshLikeInfo(cfg)
            return
          }
          if (isPendingAutoLikeConfirmed(pending)) {
            handleLikeSucceeded(cfg, pending.topicId)
            return
          }
          pendingAutoLikeConfirmTimer = window.setTimeout(poll, 180)
        }

        pendingAutoLikeConfirmTimer = window.setTimeout(poll, 180)
      }

      function clearAutoLikePlan(): void {
        likePlannedTopicId = null
        likeTriggerAtMs = 0
        likeTriggerMinRenderedPosts = 0
        clearPendingAutoLike()
      }

      function isPerTopicAutoLikeBlocked(cfg: AutoReadConfig, topicId: number | null): boolean {
        return cfg.autoLikeLimitPerTopic && topicId != null && lastAutoLikeTopicId === topicId
      }

      function planAutoLikeForTopic(topicId: number, cfg: AutoReadConfig): void {
        clearAutoLikePlan()
        if (!cfg.autoLikeEnabled) return
        if (isPerTopicAutoLikeBlocked(cfg, topicId)) return
        if (!canAutoLike(cfg)) return
        if (cfg.autoLikeProbability <= 0) return
        likePlannedTopicId = topicId
        likeTriggerAtMs = Date.now() + randInt(800, 2500)
        likeTriggerMinRenderedPosts = randInt(1, 4)
      }

      function rearmCurrentTopicAutoLike(cfg: AutoReadConfig): void {
        const route = ctx.discourse.getRouteInfo()
        if (!route.topicId) {
          clearAutoLikePlan()
          refreshLikeInfo(cfg)
          return
        }
        planAutoLikeForTopic(route.topicId, cfg)
        refreshLikeInfo(cfg)
        if (state === 'running') requestTick()
      }

      function resetTopicTimers(topicId: number): void {
        if (topicId === lastTopicId) return
        lastTopicId = topicId
        topicEnterAt = Date.now()
        bottomArrivedAt = 0
        const cfg = readConfig()
        bottomPauseMs = randInt(cfg.bottomPauseMinMs, cfg.bottomPauseMaxMs)
        clearAutoLikePlan()
        currentTopicExpectedMaxPostNumber =
          pendingTopicExpectation?.topicId === topicId &&
          pendingTopicExpectation.maxPostNumber != null &&
          pendingTopicExpectation.maxPostNumber > 0
            ? pendingTopicExpectation.maxPostNumber
            : null
        pendingTopicExpectation = null
        lastRenderedHighestPostNumber = 0
        lastRenderedProgressAt = Date.now()
        waitMoreStartedAt = 0
        invalidateTopicDomSnapshot(topicId)
        syncTopicDomObserver()
        planAutoLikeForTopic(topicId, cfg)
        refreshLikeInfo(cfg)
      }

      function rememberTopicExpectation(topic: TopicRef | null): void {
        if (!topic || !Number.isFinite(topic.id) || topic.id <= 0) {
          pendingTopicExpectation = null
          return
        }
        pendingTopicExpectation = { topicId: topic.id, maxPostNumber: topic.maxPostNumber }
      }

      function syncRenderedProgress(highestPostNumber: number | null): void {
        const nextHighest = highestPostNumber ?? 0
        if (nextHighest <= 0) {
          if (!lastRenderedProgressAt) lastRenderedProgressAt = Date.now()
          return
        }
        if (nextHighest === lastRenderedHighestPostNumber) {
          if (!lastRenderedProgressAt) lastRenderedProgressAt = Date.now()
          return
        }
        lastRenderedHighestPostNumber = nextHighest
        lastRenderedProgressAt = Date.now()
        bottomArrivedAt = 0
        waitMoreStartedAt = 0
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

      async function ensureQueue(signal: AbortSignal): Promise<void> {
        const rawQ = ctx.storage.get(KEY_QUEUE, [] as unknown as unknown[])
        if (Array.isArray(rawQ) && rawQ.length > 0) {
          // If the queue was produced by an older version, it may contain already-read topics.
          // Drop it and rebuild with unread-only logic.
          const looksModern = rawQ.every(
            (it) =>
              it &&
              typeof it === 'object' &&
              'unreadFromPostNumber' in (it as object) &&
              'maxPostNumber' in (it as object) &&
              'source' in (it as object)
          )
          if (looksModern) return
          ctx.storage.set(KEY_QUEUE, [])
        }

        const visited = readVisited()
        const visitedById = new Map<number, VisitedTopic>()
        for (const v of visited) {
          const prev = visitedById.get(v.id)
          if (!prev || v.at > prev.at) visitedById.set(v.id, v)
        }

        const cfg = readConfig()
        const now = Date.now()
        const topicListLimit = cfg.topicListLimit
        const maxPages = Math.min(5, Math.max(1, Math.ceil(topicListLimit / 30)))
        const throttleMinMs = cfg.queueThrottleMinMs
        const throttleMaxMs = cfg.queueThrottleMaxMs

        const seen = new Set<number>()
        const unread: TopicRef[] = []
        const news: TopicRef[] = []
        const latest: TopicRef[] = []

        const pushIfEligible = (t: TopicRef) => {
          if (seen.has(t.id)) return
          const v = visitedById.get(t.id)
          if (v && v.at > 0 && now - v.at <= VISITED_TTL_MS) {
            const unreadFrom = computeUnreadFrom(t)
            const maxPost = t.maxPostNumber ?? 0
            if (v.unreadFrom === unreadFrom && v.maxPost === maxPost) return
          }
          seen.add(t.id)
          if (t.source === 'unread') unread.push(t)
          else if (t.source === 'new') news.push(t)
          else latest.push(t)
        }

        const fetchPages = async (source: TopicSource, pages: number, cap: number) => {
          for (let p = 1; p <= pages; p += 1) {
            if (signal.aborted) throw new DOMException('aborted', 'AbortError')
            if (source === 'unread' && unread.length >= cap) break
            if (source === 'new' && news.length >= cap) break
            if (source === 'latest' && latest.length >= cap) break

            const topics = await fetchLatestTopicsPage({
              origin: window.location.origin,
              source,
              page: p,
              commentLimit: cfg.commentLimit,
              signal,
            })
            for (const t of topics) pushIfEligible(t)
            if (p < pages) {
              const reachedCap =
                (source === 'unread' && unread.length >= cap) ||
                (source === 'new' && news.length >= cap) ||
                (source === 'latest' && latest.length >= cap)
              if (!reachedCap) {
                const throttleMs = randInt(throttleMinMs, throttleMaxMs)
                await sleep(throttleMs, signal)
              }
            }
          }
        }

        // Include both unread replies and new topics (avoid starving new topics when /latest is dominated by bumped threads).
        await fetchPages('unread', maxPages, topicListLimit)
        await fetchPages('new', maxPages, topicListLimit)

        const out: TopicRef[] = []
        while (out.length < topicListLimit) {
          if (unread.length) {
            const t = unread.shift()
            if (t) out.push(t)
          }
          if (out.length >= topicListLimit) break
          if (news.length) {
            const t = news.shift()
            if (t) out.push(t)
          }
          if (out.length >= topicListLimit) break
          if (!unread.length && !news.length) break
        }

        if (out.length < topicListLimit) {
          await fetchPages('latest', maxPages, topicListLimit)
          while (out.length < topicListLimit && latest.length) {
            const t = latest.shift()
            if (!t) break
            out.push(t)
          }
        }

        ctx.storage.set(KEY_QUEUE, out)
      }

      async function popNextTopic(signal: AbortSignal): Promise<TopicRef | null> {
        await ensureQueue(signal)
        const q = ctx.storage.get(KEY_QUEUE, [] as TopicRef[])
        if (!Array.isArray(q) || q.length === 0) return null
        const next = q.shift()
        if (!next) return null
        ctx.storage.set(KEY_QUEUE, q)
        return next
      }

      function markVisited(topic: TopicRef): void {
        const now = Date.now()
        const unreadFrom = computeUnreadFrom(topic)
        const maxPost = topic.maxPostNumber ?? 0

        const list = readVisited()
        const next = list.filter((v) => v.id !== topic.id)
        next.push({ id: topic.id, unreadFrom, maxPost, at: now })
        ctx.storage.set(KEY_VISITED, next.slice(-800))
      }

      function shouldPauseForActivity(cfg: AutoReadConfig): boolean {
        if (!Number.isFinite(cfg.userActivityPauseMs) || cfg.userActivityPauseMs <= 0) return false
        if (!lastActivityAt) return false
        return Date.now() - lastActivityAt < cfg.userActivityPauseMs
      }

      function markActivity(): void {
        lastActivityAt = Date.now()
      }

      function nextMidnightMs(now = new Date()): number {
        const d = new Date(now.getTime())
        d.setHours(24, 0, 0, 0)
        return d.getTime()
      }

      function formatLocalDateTime(ms: number): string {
        try {
          return new Date(ms).toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        } catch {
          return String(ms)
        }
      }

      function ensureLikeState(): {
        day: string
        count: number
        autoCount: number
        nextAtMs: number | null
      } {
        const day = todayKey()
        const storedDay = ctx.storage.get(KEY_LIKE_DATE, '')
        if (storedDay !== day) {
          ctx.storage.set(KEY_LIKE_DATE, day)
          ctx.storage.set(KEY_LIKE_COUNT, 0)
          ctx.storage.set(KEY_LIKE_AUTO_COUNT, 0)
          ctx.storage.remove(KEY_LIKE_NEXT_AT)
        }
        const countRaw = Number(ctx.storage.get(KEY_LIKE_COUNT, 0))
        const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : 0
        const autoCountRaw = Number(ctx.storage.get(KEY_LIKE_AUTO_COUNT, 0))
        const autoCount =
          Number.isFinite(autoCountRaw) && autoCountRaw > 0 ? Math.floor(autoCountRaw) : 0
        if (autoCount !== autoCountRaw) ctx.storage.set(KEY_LIKE_AUTO_COUNT, autoCount)
        const nextAtRaw = Number(ctx.storage.get(KEY_LIKE_NEXT_AT, 0))
        const nextAtMs = Number.isFinite(nextAtRaw) && nextAtRaw > 0 ? nextAtRaw : null
        return { day, count, autoCount, nextAtMs }
      }

      function parseRetryAfterMs(value: string | null | undefined): number | null {
        const v = String(value ?? '').trim()
        if (!v) return null

        const seconds = Number.parseInt(v, 10)
        if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000

        const at = new Date(v).getTime()
        return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null
      }

      function getRemainingAutoLikeQuota(cfg: AutoReadConfig): number {
        if (cfg.autoLikeDailyLimit <= 0) return 0
        return Math.max(0, cfg.autoLikeDailyLimit - ensureLikeState().autoCount)
      }

      function getCurrentTopicAutoLikeStatus(cfg: AutoReadConfig): string | null {
        if (!cfg.autoLikeEnabled) return null
        if (cfg.autoLikeDailyLimit <= 0) return '自动点赞已禁用'

        const route = ctx.discourse.getRouteInfo()
        const pendingTopicId = getPendingAutoLikeTopicId()
        if (pendingTopicId != null) {
          return pendingTopicId === route.topicId ? '本帖点赞提交中' : '点赞提交中'
        }

        if (!route.isTopic || !route.topicId) return '进入话题后生效'
        if (isPerTopicAutoLikeBlocked(cfg, route.topicId)) return '本帖已点过'
        if (!canAutoLike(cfg)) {
          if (getRemainingAutoLikeQuota(cfg) <= 0) return '今日上限已满'
          return '冷却中'
        }
        if (likePlannedTopicId !== route.topicId) return '本帖未计划'

        const { count: postCount } = getRenderedPostProgress()
        if (postCount < likeTriggerMinRenderedPosts) {
          return `本帖待点赞（等楼层 ${postCount}/${likeTriggerMinRenderedPosts}）`
        }
        if (Date.now() < likeTriggerAtMs) return '本帖待点赞（等时机）'
        if (!findRandomLikeTarget()) return '本帖暂无可点赞按钮'
        return '本帖待点赞'
      }

      function refreshLikeInfo(cfg: AutoReadConfig): void {
        const { count, autoCount, nextAtMs } = ensureLikeState()

        const parts: string[] = []
        if (!cfg.autoLikeEnabled) parts.push('自动点赞：关闭')
        else if (cfg.autoLikeDailyLimit <= 0) parts.push('自动点赞：已禁用（上限=0）')
        else parts.push('自动点赞：开启')

        parts.push(`今日已赞 ${count}（本地）`)
        parts.push(`自动已点 ${autoCount}/${cfg.autoLikeDailyLimit}`)

        const currentTopicStatus = getCurrentTopicAutoLikeStatus(cfg)
        if (currentTopicStatus) parts.push(currentTopicStatus)

        if (cfg.autoLikeDailyLimit > 0 && getRemainingAutoLikeQuota(cfg) <= 0) {
          const next = nextAtMs && nextAtMs > Date.now() ? nextAtMs : nextMidnightMs()
          if (!nextAtMs || nextAtMs !== next) ctx.storage.set(KEY_LIKE_NEXT_AT, next)
          parts.push(`已达上限，下次 ${formatLocalDateTime(next)}`)
        } else if (nextAtMs && nextAtMs > Date.now()) {
          parts.push(`下次 ${formatLocalDateTime(nextAtMs)}`)
        }

        likeInfo.textContent = parts.join(' · ')
      }

      function canAutoLike(cfg: AutoReadConfig): boolean {
        if (!cfg.autoLikeEnabled) return false
        const { autoCount, nextAtMs } = ensureLikeState()
        if (nextAtMs && nextAtMs > Date.now()) return false
        if (cfg.autoLikeDailyLimit <= 0) return false
        if (autoCount >= cfg.autoLikeDailyLimit) return false
        return true
      }

      function getPendingAutoLikeTopicId(): number | null {
        if (!pendingAutoLike) return null
        if (pendingAutoLike.expiresAt <= Date.now()) {
          clearPendingAutoLike()
          return null
        }
        return pendingAutoLike.topicId
      }

      function tryAutoLike(cfg: AutoReadConfig, postCount: number): void {
        const route = ctx.discourse.getRouteInfo()
        if (!route.topicId) return
        if (isPerTopicAutoLikeBlocked(cfg, route.topicId)) return
        if (likePlannedTopicId !== route.topicId) return
        if (postCount < likeTriggerMinRenderedPosts) return
        if (Date.now() < likeTriggerAtMs) return
        if (!canAutoLike(cfg)) return
        if (getPendingAutoLikeTopicId() != null) return

        const target = findRandomLikeTarget()
        if (!target) {
          refreshLikeInfo(cfg)
          return
        }
        if (Math.random() > cfg.autoLikeProbability) {
          if (cfg.autoLikeLimitPerTopic) clearAutoLikePlan()
          else planAutoLikeForTopic(route.topicId, cfg)
          refreshLikeInfo(cfg)
          return
        }

        triggerLikeClick(target)
        const article = target.closest<HTMLElement>('article[data-post-id]')
        const postId = Number.parseInt(String(article?.getAttribute('data-post-id') ?? ''), 10)
        pendingAutoLike = {
          topicId: route.topicId,
          expiresAt: Date.now() + 15_000,
          postId: Number.isFinite(postId) && postId > 0 ? postId : null,
          target,
        }
        schedulePendingAutoLikeConfirmation(cfg)
        likeTriggerAtMs = Date.now() + 1_500
        refreshLikeInfo(cfg)
      }

      function handleLikeSucceeded(cfg: AutoReadConfig, topicId: number | null): void {
        const before = ensureLikeState()
        clearPendingAutoLike()
        if (topicId != null) lastAutoLikeTopicId = topicId
        likePlannedTopicId = null
        likeTriggerAtMs = 0
        likeTriggerMinRenderedPosts = 0

        // If we can like again, clear any previous cooldown.
        if (before.nextAtMs && before.nextAtMs > Date.now()) ctx.storage.remove(KEY_LIKE_NEXT_AT)

        const nextCount = before.count + 1
        const nextAutoCount = before.autoCount + 1
        ctx.storage.set(KEY_LIKE_COUNT, nextCount)
        ctx.storage.set(KEY_LIKE_AUTO_COUNT, nextAutoCount)

        const reachedScriptCap =
          cfg.autoLikeEnabled &&
          cfg.autoLikeDailyLimit > 0 &&
          nextAutoCount >= cfg.autoLikeDailyLimit

        if (reachedScriptCap) {
          const nextAt = nextMidnightMs()
          ctx.storage.set(KEY_LIKE_NEXT_AT, nextAt)
          window.dispatchEvent(
            new CustomEvent('ld2:toast', {
              detail: {
                title: '自动点赞已达上限',
                desc: `${nextCount} · 下次 ${formatLocalDateTime(nextAt)}`,
              },
            })
          )
        } else if (!cfg.autoLikeLimitPerTopic && topicId != null) {
          planAutoLikeForTopic(topicId, cfg)
        }
        refreshLikeInfo(cfg)
      }

      function handleLikeRateLimited(cfg: AutoReadConfig, retryAfter: string | null): void {
        const before = ensureLikeState()
        clearPendingAutoLike()
        likePlannedTopicId = null
        likeTriggerAtMs = 0
        likeTriggerMinRenderedPosts = 0
        const retryAfterMs = parseRetryAfterMs(retryAfter)
        const nextAt = retryAfterMs != null ? Date.now() + retryAfterMs : nextMidnightMs()
        ctx.storage.set(KEY_LIKE_NEXT_AT, nextAt)
        refreshLikeInfo(cfg)

        if (
          !before.nextAtMs ||
          before.nextAtMs < Date.now() ||
          Math.abs(before.nextAtMs - nextAt) > 1500
        ) {
          window.dispatchEvent(
            new CustomEvent('ld2:toast', {
              detail: {
                title: '点赞已受限',
                desc: `下次 ${formatLocalDateTime(nextAt)}`,
              },
            })
          )
        }
      }

      function handleLikeFailed(cfg: AutoReadConfig): void {
        clearPendingAutoLike()
        if (likePlannedTopicId != null) {
          likeTriggerAtMs = Date.now() + randInt(1800, 4000)
        }
        refreshLikeInfo(cfg)
      }

      function bodyToLowerString(body: unknown): string {
        try {
          if (typeof body === 'string') return body.toLowerCase()
          if (body instanceof URLSearchParams) return body.toString().toLowerCase()
          if (typeof FormData !== 'undefined' && body instanceof FormData) {
            const params = new URLSearchParams()
            for (const [k, v] of body.entries())
              params.append(k, typeof v === 'string' ? v : String(v?.name ?? 'file'))
            return params.toString().toLowerCase()
          }
          if (body && typeof body === 'object') return JSON.stringify(body).toLowerCase()
        } catch {
          // ignore
        }
        return ''
      }

      function isLikeRequest(method: string | null, urlRaw: string | null, body: unknown): boolean {
        const m = String(method ?? '').toUpperCase()
        if (m !== 'POST') return false

        let url: URL | null = null
        try {
          url = urlRaw ? new URL(urlRaw, window.location.origin) : null
        } catch {
          url = null
        }

        const path = url?.pathname ?? ''
        const bodyStr = bodyToLowerString(body)

        // Classic like: POST /post_actions (post_action_type_id=2)
        if (
          path.includes('/post_actions') &&
          (bodyStr.includes('post_action_type_id=2') || bodyStr.includes('"post_action_type_id":2'))
        ) {
          return true
        }

        // Reactions plugin (best-effort): look for "like" in reactions endpoints/payload.
        if (
          (path.includes('reactions') || path.includes('discourse-reactions')) &&
          bodyStr.includes('like')
        ) {
          return true
        }

        // Fallback: payload hint (even if URL is rewritten by plugins).
        if (bodyStr.includes('post_action_type_id=2')) return true
        return false
      }

      function installLikeNetworkObserver(): Disposable {
        const root = (typeof unsafeWindow !== 'undefined'
          ? unsafeWindow
          : globalThis) as unknown as Record<string, unknown>
        const FLAG = '__ld2_like_net_observer_installed__'
        if (root[FLAG]) return toDisposable(() => {})
        root[FLAG] = true

        const xhrMetaKey = '__ld2_like_meta__'
        const origOpen = XMLHttpRequest.prototype.open
        const origSend = XMLHttpRequest.prototype.send

        XMLHttpRequest.prototype.open = function (method: string, url: string, ...rest: unknown[]) {
          ;(this as unknown as Record<string, unknown>)[xhrMetaKey] = { method, url }
          // biome-ignore lint/suspicious/noExplicitAny: patching built-in prototype.
          return (origOpen as any).call(this, method, url, ...rest)
        }

        XMLHttpRequest.prototype.send = function (body?: unknown) {
          const rec = (this as unknown as Record<string, unknown>)[xhrMetaKey]
          const meta =
            (rec && typeof rec === 'object' ? (rec as { method?: unknown; url?: unknown }) : {}) ??
            {}
          ;(this as unknown as Record<string, unknown>)[xhrMetaKey] = { ...meta, body }

          this.addEventListener(
            'loadend',
            () => {
              try {
                const r = (this as unknown as Record<string, unknown>)[xhrMetaKey]
                const m =
                  r && typeof r === 'object'
                    ? (r as { method?: unknown; url?: unknown; body?: unknown })
                    : null
                const method = typeof m?.method === 'string' ? m.method : null
                const url = typeof m?.url === 'string' ? m.url : null
                const b = m?.body
                if (!isLikeRequest(method, url, b)) return

                const pendingTopicId = getPendingAutoLikeTopicId()
                if (pendingTopicId == null) return
                const cfg = readConfig()
                if (this.status >= 200 && this.status < 300) handleLikeSucceeded(cfg, pendingTopicId)
                else if (this.status === 429)
                  handleLikeRateLimited(cfg, this.getResponseHeader('retry-after'))
                else handleLikeFailed(cfg)
              } catch {
                // ignore
              }
            },
            { once: true }
          )

          // biome-ignore lint/suspicious/noExplicitAny: patching built-in prototype.
          return (origSend as any).call(this, body)
        }

        const origFetch = window.fetch
        window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          // biome-ignore lint/suspicious/noExplicitAny: fetch typing differences across environments.
          const res = await (origFetch as any).call(window, input, init)
          try {
            const urlRaw =
              typeof input === 'string'
                ? input
                : input instanceof URL
                  ? input.href
                  : typeof Request !== 'undefined' && input instanceof Request
                    ? input.url
                    : null
            const methodRaw =
              init?.method ??
              (typeof Request !== 'undefined' && input instanceof Request ? input.method : null)
            const bodyRaw = init?.body
            if (isLikeRequest(methodRaw ?? null, urlRaw, bodyRaw)) {
              const pendingTopicId = getPendingAutoLikeTopicId()
              if (pendingTopicId == null) return res
              const cfg = readConfig()
              if (res.status >= 200 && res.status < 300) handleLikeSucceeded(cfg, pendingTopicId)
              else if (res.status === 429)
                handleLikeRateLimited(cfg, res.headers.get('retry-after'))
              else handleLikeFailed(cfg)
            }
          } catch {
            // ignore
          }
          return res
        }) as typeof window.fetch

        return toDisposable(() => {
          XMLHttpRequest.prototype.open = origOpen
          XMLHttpRequest.prototype.send = origSend
          window.fetch = origFetch
          try {
            delete root[FLAG]
          } catch {
            // ignore
          }
        })
      }

      function getHttpStatus(err: unknown): number | null {
        if (err && typeof err === 'object') {
          const maybe = err as { status?: unknown }
          if (typeof maybe.status === 'number') return maybe.status
        }
        if (err instanceof Error) {
          const m = err.message.match(/\bhttp\s+(\d{3})\b/i)
          if (m?.[1]) {
            const n = Number.parseInt(m[1], 10)
            return Number.isFinite(n) ? n : null
          }
        }
        return null
      }

      function formatTickError(err: unknown): string {
        const status = getHttpStatus(err)
        if (status === 403) return '需要登录（HTTP 403）'
        if (status === 429) return '请求过于频繁（HTTP 429）'
        if (err instanceof Error) return err.message
        return '未知错误'
      }

      function normalizeFallbackTopicUrl(origin: string, raw: string): string | null {
        const v = String(raw || '').trim()
        if (!v) return null
        try {
          const u = new URL(v, origin)
          if (u.origin !== origin) return null
          return u.href
        } catch {
          return null
        }
      }

      function tryDiscourseRouteTo(href: string): boolean {
        try {
          type DiscourseUrlLike = { routeTo?: (href: string) => void }
          type RootLike = {
            DiscourseURL?: DiscourseUrlLike
            Discourse?: { URL?: DiscourseUrlLike }
          }
          const root = (typeof unsafeWindow !== 'undefined'
            ? unsafeWindow
            : globalThis) as unknown as RootLike
          const du = root?.DiscourseURL ?? root?.Discourse?.URL
          const routeTo = du?.routeTo
          if (typeof routeTo !== 'function') return false
          routeTo.call(du, href)
          return true
        } catch {
          return false
        }
      }

      function navigate(href: string): void {
        try {
          const u = new URL(href, window.location.origin)
          if (u.origin !== window.location.origin) {
            window.location.href = u.href
            return
          }
          const path = `${u.pathname}${u.search}${u.hash}`
          if (tryDiscourseRouteTo(path) || tryDiscourseRouteTo(u.href)) return
          window.location.href = u.href
        } catch {
          window.location.href = href
        }
      }

      function navigateWithRecovery(href: string, shouldRetry: () => boolean): void {
        navigate(href)
        scheduleTick(500, shouldRetry)
      }

      async function tick(): Promise<void> {
        if (state !== 'running') return
        const activeController = controller
        if (!activeController) return
        if (activeController.signal.aborted) return
        if (tickInFlight) {
          pendingTick = true
          return
        }

        tickInFlight = true

        try {
          const cfg = readConfig()
          if (document.visibilityState === 'hidden' && !cfg.continueWhenHidden) {
            clearTimer()
            setStatus('运行中（页面不可见，等待返回…）')
            return
          }
          if (shouldPauseForActivity(cfg)) {
            const remaining = Math.max(0, cfg.userActivityPauseMs - (Date.now() - lastActivityAt))
            const waitMs = Math.max(120, Math.min(800, remaining))
            scheduleTick(waitMs)
            return
          }
          const route = ctx.discourse.getRouteInfo()

          if (!route.isTopic || !route.topicId) {
            setStatus('运行中（选择话题…）')
            const next = await popNextTopic(activeController.signal)
            if (!next) {
              const fallback = normalizeFallbackTopicUrl(
                window.location.origin,
                cfg.fallbackTopicUrl
              )
              if (fallback) {
                setStatus('运行中（无话题，跳转兜底…）')
                navigateWithRecovery(fallback, () => {
                  const current = ctx.discourse.getRouteInfo()
                  return !current.isTopic || !current.topicId
                })
              } else {
                setStatus('运行中（无话题，跳转 /latest）')
                navigateWithRecovery(`${window.location.origin}/latest`, () => {
                  const current = ctx.discourse.getRouteInfo()
                  return !current.isTopic || !current.topicId
                })
              }
            } else {
              rememberTopicExpectation(next)
              markVisited(next)
              navigateWithRecovery(topicUrl(window.location.origin, next), () => {
                const current = ctx.discourse.getRouteInfo()
                return !current.isTopic || current.topicId !== next.id
              })
            }
            return
          }

          resetTopicTimers(route.topicId)

          const topicDom = getTopicDomSnapshot(route.topicId)
          const postCount = topicDom.postCount
          const highestPostNumber = topicDom.highestPostNumber
          syncRenderedProgress(highestPostNumber)
          const topicMaxPostHint = topicDom.maxPostHint
          if (topicMaxPostHint != null) {
            currentTopicExpectedMaxPostNumber =
              currentTopicExpectedMaxPostNumber == null
                ? topicMaxPostHint
                : Math.max(currentTopicExpectedMaxPostNumber, topicMaxPostHint)
          }
          const loadingElapsed = topicEnterAt ? Date.now() - topicEnterAt : 0
          const hasVisibleSpinner = topicDom.hasVisibleSpinner
          if (loadingElapsed < 10_000 && hasVisibleSpinner) {
            setStatus('运行中（加载话题…）')
            scheduleTick(300)
            return
          }
          if (postCount === 0) {
            if (loadingElapsed < 15_000) {
              setStatus('运行中（加载话题…）')
              scheduleTick(300)
              return
            }
          }

          if (!isAtBottom()) {
            waitMoreStartedAt = 0
            tryAutoLike(cfg, postCount)
            const step = randInt(cfg.stepMin, cfg.stepMax)
            window.scrollBy(0, step)
            scheduleTick(randInt(cfg.delayMinMs, cfg.delayMaxMs))
            return
          }

          const expectedMaxPostNumber = currentTopicExpectedMaxPostNumber
          const renderedMaxPostNumber = highestPostNumber ?? postCount
          if (
            expectedMaxPostNumber != null &&
            renderedMaxPostNumber > 0 &&
            renderedMaxPostNumber < expectedMaxPostNumber
          ) {
            if (!waitMoreStartedAt) waitMoreStartedAt = Date.now()
            const waitMoreElapsed = Date.now() - waitMoreStartedAt
            const renderedStableForMs = lastRenderedProgressAt ? Date.now() - lastRenderedProgressAt : 0
            if (hasVisibleSpinner || waitMoreElapsed < 1600 || renderedStableForMs < 500) {
              setStatus(`运行中（等待楼层加载… #${renderedMaxPostNumber}/${expectedMaxPostNumber}）`)
              window.scrollBy(0, Math.max(80, Math.min(220, cfg.stepMin)))
              scheduleTick(hasVisibleSpinner ? 220 : 320)
              return
            }
          } else {
            waitMoreStartedAt = 0
          }

          const now = Date.now()
          const elapsed = topicEnterAt ? now - topicEnterAt : Infinity
          if (cfg.minTopicStayMs > 0 && elapsed < cfg.minTopicStayMs) {
            const remaining = cfg.minTopicStayMs - elapsed
            const waitMs = Math.max(120, Math.min(800, remaining))
            scheduleTick(waitMs)
            return
          }

          if (!bottomArrivedAt) bottomArrivedAt = now
          if (bottomPauseMs > 0 && now - bottomArrivedAt < bottomPauseMs) {
            const remaining = bottomPauseMs - (now - bottomArrivedAt)
            const waitMs = Math.max(120, Math.min(800, remaining))
            scheduleTick(waitMs)
            return
          }

          setStatus('运行中（切换话题…）')
          const fromTopicId = route.topicId
          const next = await popNextTopic(activeController.signal)
          if (next) {
            rememberTopicExpectation(next)
            markVisited(next)
            navigateWithRecovery(topicUrl(window.location.origin, next), () => {
              const r2 = ctx.discourse.getRouteInfo()
              return !r2.isTopic || r2.topicId === fromTopicId
            })
            return
          }

          const fallback = normalizeFallbackTopicUrl(window.location.origin, cfg.fallbackTopicUrl)
          if (fallback) {
            navigateWithRecovery(fallback, () => {
              const r2 = ctx.discourse.getRouteInfo()
              return !r2.isTopic || r2.topicId === fromTopicId
            })
          } else {
            navigateWithRecovery(`${window.location.origin}/latest`, () => {
              const r2 = ctx.discourse.getRouteInfo()
              return !r2.isTopic || r2.topicId === fromTopicId
            })
          }
        } catch (err) {
          if (isAbortLikeError(err, activeController.signal)) return
          const status = getHttpStatus(err)
          if (status === 403) {
            setState('paused')
            clearTimer()
            setStatus('已暂停（需要登录）')
            window.dispatchEvent(
              new CustomEvent('ld2:toast', {
                detail: { title: '自动阅读已暂停', desc: '需要登录后才能继续' },
              })
            )
            return
          }

          const msg = formatTickError(err)
          const delayMs = status === 429 ? 15_000 : 3_000
          setStatus(`运行中（${Math.round(delayMs / 1000)}秒后重试：${msg}）`)
          scheduleTick(delayMs)
        } finally {
          tickInFlight = false
          const shouldRerun =
            pendingTick &&
            timer == null &&
            state === 'running' &&
            controller === activeController &&
            !activeController.signal.aborted
          pendingTick = false
          if (shouldRerun) void tick()
        }
      }

      function start(options: { silent?: boolean } = {}): void {
        if (state === 'running') return
        clearTimer()
        controller?.abort()
        controller = new AbortController()
        pendingTick = false
        // Clicking the Start button itself counts as user activity; avoid immediately stalling.
        lastActivityAt = 0
        ctx.storage.set(KEY_ENABLED, true)
        setState('running')
        if (!options.silent) {
          window.dispatchEvent(
            new CustomEvent('ld2:toast', {
              detail: { title: '自动阅读已开始', desc: '将自动滚动/切换话题' },
            })
          )
        }
        requestTick()
      }

      function pauseOrResume(): void {
        if (state === 'idle') return
        if (state === 'paused') {
          setState('running')
          lastActivityAt = 0
          pendingTick = false
          window.dispatchEvent(
            new CustomEvent('ld2:toast', { detail: { title: '自动阅读已继续' } })
          )
          requestTick()
          return
        }
        setState('paused')
        clearTimer()
        window.dispatchEvent(new CustomEvent('ld2:toast', { detail: { title: '自动阅读已暂停' } }))
      }

      function stop(options: { silent?: boolean } = {}): void {
        clearTimer()
        controller?.abort()
        controller = null
        pendingTick = false
        clearPendingAutoLike()
        disconnectTopicDomObserver()
        invalidateTopicDomSnapshot()
        ctx.storage.set(KEY_ENABLED, false)
        setState('idle')
        if (!options.silent) {
          window.dispatchEvent(
            new CustomEvent('ld2:toast', { detail: { title: '自动阅读已停止' } })
          )
        }
      }

      const routeSub = ctx.router.onChange(() => {
        refreshLikeInfo(readConfig())
        if (state === 'idle') {
          disconnectTopicDomObserver()
          invalidateTopicDomSnapshot()
          return
        }
        syncTopicDomObserver()
        invalidateTopicDomSnapshot()
        // Ensure no stale timers keep running across route switches.
        clearTimer()
        if (state === 'running') requestTick()
      })

      const onStart = () => start()
      const onPause = () => pauseOrResume()
      const onStop = () => stop()
      const onStartEvent = () => start()
      const onToggleEvent = () => pauseOrResume()
      const onStopEvent = () => stop()

      const onVis = () => {
        if (document.visibilityState === 'hidden') {
          if (state === 'running') {
            const cfg = readConfig()
            if (!cfg.continueWhenHidden) {
              clearTimer()
              setStatus('运行中（页面不可见，等待返回…）')
            }
          }
          return
        }

        if (document.visibilityState === 'visible') {
          if (state === 'running') {
            requestTick()
          }
        }
      }

      startBtn.addEventListener('click', onStart)
      pauseBtn.addEventListener('click', onPause)
      stopBtn.addEventListener('click', onStop)

      const syncLikeAdvanced = () => {
        const enabled = likeCb.checked
        likeProbabilityInput.disabled = !enabled
        likeDailyLimitInput.disabled = !enabled
        likeLimitPerTopicCb.disabled = !enabled
      }

      const onLikeToggle = () => {
        const cfg = readConfig()
        const wasEnabled = cfg.autoLikeEnabled
        cfg.autoLikeEnabled = likeCb.checked
        writeConfig(cfg)
        if (!wasEnabled && cfg.autoLikeEnabled) {
          rearmCurrentTopicAutoLike(cfg)
        } else if (!cfg.autoLikeEnabled) {
          clearAutoLikePlan()
        }
        syncLikeAdvanced()
        refreshLikeInfo(cfg)
      }
      likeCb.addEventListener('change', onLikeToggle)

      const onCfgChanged = () => {
        const cfg = readConfig()
        const prevLikeProbability = cfg.autoLikeProbability
        const prevLikeDailyLimit = cfg.autoLikeDailyLimit
        const prevLikeLimitPerTopic = cfg.autoLikeLimitPerTopic
        cfg.stepMin = Number.parseInt(stepMinInput.value, 10) || cfg.stepMin
        cfg.stepMax = Number.parseInt(stepMaxInput.value, 10) || cfg.stepMax
        cfg.delayMinMs = Number.parseInt(delayMinInput.value, 10) || cfg.delayMinMs
        cfg.delayMaxMs = Number.parseInt(delayMaxInput.value, 10) || cfg.delayMaxMs
        {
          const v = Number.parseInt(userActivityPauseInput.value, 10)
          if (Number.isFinite(v)) cfg.userActivityPauseMs = v
        }
        cfg.continueWhenHidden = continueWhenHiddenCb.checked
        {
          const v = Number.parseInt(commentLimitInput.value, 10)
          if (Number.isFinite(v)) cfg.commentLimit = v
        }
        {
          const v = Number.parseInt(topicListLimitInput.value, 10)
          if (Number.isFinite(v)) cfg.topicListLimit = v
        }
        {
          const v = Number.parseInt(queueThrottleMinInput.value, 10)
          if (Number.isFinite(v)) cfg.queueThrottleMinMs = v
        }
        {
          const v = Number.parseInt(queueThrottleMaxInput.value, 10)
          if (Number.isFinite(v)) cfg.queueThrottleMaxMs = v
        }
        cfg.fallbackTopicUrl = String(fallbackTopicInput.value || '').trim()
        {
          const v = Number.parseInt(minStayInput.value, 10)
          if (Number.isFinite(v)) cfg.minTopicStayMs = v
        }
        {
          const v = Number.parseInt(bottomPauseMinInput.value, 10)
          if (Number.isFinite(v)) cfg.bottomPauseMinMs = v
        }
        {
          const v = Number.parseInt(bottomPauseMaxInput.value, 10)
          if (Number.isFinite(v)) cfg.bottomPauseMaxMs = v
        }
        {
          const v = Number.parseFloat(likeProbabilityInput.value)
          if (Number.isFinite(v)) cfg.autoLikeProbability = v
        }
        {
          const v = Number.parseInt(likeDailyLimitInput.value, 10)
          if (Number.isFinite(v)) cfg.autoLikeDailyLimit = v
        }
        cfg.autoLikeLimitPerTopic = likeLimitPerTopicCb.checked
        writeConfig(cfg)
        if (
          cfg.autoLikeEnabled &&
          (prevLikeProbability !== cfg.autoLikeProbability ||
            prevLikeDailyLimit !== cfg.autoLikeDailyLimit ||
            prevLikeLimitPerTopic !== cfg.autoLikeLimitPerTopic)
        ) {
          rearmCurrentTopicAutoLike(cfg)
          return
        }
        refreshLikeInfo(cfg)
      }
      stepMinInput.addEventListener('change', onCfgChanged)
      stepMaxInput.addEventListener('change', onCfgChanged)
      delayMinInput.addEventListener('change', onCfgChanged)
      delayMaxInput.addEventListener('change', onCfgChanged)
      userActivityPauseInput.addEventListener('change', onCfgChanged)
      continueWhenHiddenCb.addEventListener('change', onCfgChanged)
      commentLimitInput.addEventListener('change', onCfgChanged)
      topicListLimitInput.addEventListener('change', onCfgChanged)
      queueThrottleMinInput.addEventListener('change', onCfgChanged)
      queueThrottleMaxInput.addEventListener('change', onCfgChanged)
      fallbackTopicInput.addEventListener('change', onCfgChanged)
      minStayInput.addEventListener('change', onCfgChanged)
      bottomPauseMinInput.addEventListener('change', onCfgChanged)
      bottomPauseMaxInput.addEventListener('change', onCfgChanged)
      likeProbabilityInput.addEventListener('change', onCfgChanged)
      likeDailyLimitInput.addEventListener('change', onCfgChanged)
      likeLimitPerTopicCb.addEventListener('change', onCfgChanged)

      const cfg0 = readConfig()
      likeCb.checked = cfg0.autoLikeEnabled
      stepMinInput.value = String(cfg0.stepMin)
      stepMaxInput.value = String(cfg0.stepMax)
      delayMinInput.value = String(cfg0.delayMinMs)
      delayMaxInput.value = String(cfg0.delayMaxMs)
      userActivityPauseInput.value = String(cfg0.userActivityPauseMs)
      continueWhenHiddenCb.checked = cfg0.continueWhenHidden
      commentLimitInput.value = String(cfg0.commentLimit)
      topicListLimitInput.value = String(cfg0.topicListLimit)
      queueThrottleMinInput.value = String(cfg0.queueThrottleMinMs)
      queueThrottleMaxInput.value = String(cfg0.queueThrottleMaxMs)
      fallbackTopicInput.value = cfg0.fallbackTopicUrl
      minStayInput.value = String(cfg0.minTopicStayMs)
      bottomPauseMinInput.value = String(cfg0.bottomPauseMinMs)
      bottomPauseMaxInput.value = String(cfg0.bottomPauseMaxMs)
      likeProbabilityInput.value = String(cfg0.autoLikeProbability)
      likeDailyLimitInput.value = String(cfg0.autoLikeDailyLimit)
      likeLimitPerTopicCb.checked = cfg0.autoLikeLimitPerTopic
      syncLikeAdvanced()
      refreshLikeInfo(cfg0)
      renderPresetSelection(cfg0)

      const likeNetSub = installLikeNetworkObserver()

      const events = ['keydown', 'mousedown', 'wheel', 'touchstart', 'pointerdown']
      for (const ev of events)
        window.addEventListener(ev, markActivity, { capture: true, passive: true })
      document.addEventListener('visibilitychange', onVis)
      window.addEventListener(AUTO_READ_START_EVENT, onStartEvent)
      window.addEventListener(AUTO_READ_TOGGLE_EVENT, onToggleEvent)
      window.addEventListener(AUTO_READ_STOP_EVENT, onStopEvent)

      const normalizeState = (v: unknown): AutoReadState | null =>
        v === 'idle' || v === 'running' || v === 'paused' ? (v as AutoReadState) : null

      const storedState = normalizeState(
        ctx.storage.get(KEY_STATE, null as unknown as AutoReadState | null)
      )
      const legacyEnabled = !!ctx.storage.get(KEY_ENABLED, false)
      const initialState = storedState ?? (legacyEnabled ? 'paused' : 'idle')

      if (initialState === 'running') start({ silent: true })
      else setState(initialState)

      return combineDisposables(
        routeSub,
        likeNetSub,
        toDisposable(() => {
          stop({ silent: true })
          disconnectTopicDomObserver()
          for (const ev of events) window.removeEventListener(ev, markActivity, true)
          document.removeEventListener('visibilitychange', onVis)
          startBtn.removeEventListener('click', onStart)
          pauseBtn.removeEventListener('click', onPause)
          stopBtn.removeEventListener('click', onStop)
          window.removeEventListener(AUTO_READ_START_EVENT, onStartEvent)
          window.removeEventListener(AUTO_READ_TOGGLE_EVENT, onToggleEvent)
          window.removeEventListener(AUTO_READ_STOP_EVENT, onStopEvent)
          likeCb.removeEventListener('change', onLikeToggle)
          stepMinInput.removeEventListener('change', onCfgChanged)
          stepMaxInput.removeEventListener('change', onCfgChanged)
          delayMinInput.removeEventListener('change', onCfgChanged)
          delayMaxInput.removeEventListener('change', onCfgChanged)
          userActivityPauseInput.removeEventListener('change', onCfgChanged)
          continueWhenHiddenCb.removeEventListener('change', onCfgChanged)
          commentLimitInput.removeEventListener('change', onCfgChanged)
          topicListLimitInput.removeEventListener('change', onCfgChanged)
          queueThrottleMinInput.removeEventListener('change', onCfgChanged)
          queueThrottleMaxInput.removeEventListener('change', onCfgChanged)
          fallbackTopicInput.removeEventListener('change', onCfgChanged)
          minStayInput.removeEventListener('change', onCfgChanged)
          bottomPauseMinInput.removeEventListener('change', onCfgChanged)
            bottomPauseMaxInput.removeEventListener('change', onCfgChanged)
            likeProbabilityInput.removeEventListener('change', onCfgChanged)
            likeDailyLimitInput.removeEventListener('change', onCfgChanged)
            likeLimitPerTopicCb.removeEventListener('change', onCfgChanged)
            controls.innerHTML = ''
          })
        )
      },
  }
}

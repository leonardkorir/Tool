import type { Disposable } from '../../shared/disposable'
import { toDisposable } from '../../shared/disposable'

export type TopicPostOuterHtmlCache = Map<number, string>
export type UserActivityOuterHtmlCache = Map<string, { html: string; time: number }>

type ActiveTopicCache = {
  topicId: number
  posts: TopicPostOuterHtmlCache
  hardLimitReached: boolean
}

type ActiveUserActivityCache = {
  username: string | null
  items: UserActivityOuterHtmlCache
  hardLimitReached: boolean
}

const TOPIC_POST_CACHE_HARD_LIMIT = 6000
const USER_ACTIVITY_CACHE_HARD_LIMIT = 6000
const COLLECT_THROTTLE_MS = 120
const TOPIC_POST_SELECTOR = '.topic-post[data-post-number], article[data-post-number]'
const USER_ACTIVITY_ITEM_SELECTOR = '.post-list-item.user-stream-item'

let activeTopicCache: ActiveTopicCache | null = null
let activeUserActivityCache: ActiveUserActivityCache | null = null

function toast(title: string, desc: string): void {
  try {
    window.dispatchEvent(new CustomEvent('ld2:toast', { detail: { title, desc, ttlMs: 5200 } }))
  } catch {
    /* ignore */
  }
}

function collectTopicPostElementInto(cache: ActiveTopicCache, el: HTMLElement): boolean {
  if (cache.hardLimitReached) return false
  if (el.classList.contains('post-stream--cloaked')) return false

  const postNumRaw = el.getAttribute('data-post-number') || ''
  const postNumber = Number.parseInt(postNumRaw, 10)
  if (!Number.isFinite(postNumber) || postNumber <= 0) return false
  if (cache.posts.has(postNumber)) return false

  const article = el.tagName === 'ARTICLE' ? el : el.querySelector<HTMLElement>('article[data-post-id]')
  if (!article) return false

  const postIdRaw = article.getAttribute('data-post-id') || ''
  const postId = Number.parseInt(postIdRaw, 10)
  if (!Number.isFinite(postId) || postId <= 0) return false

  const cooked = article.querySelector<HTMLElement>('.cooked')
  if (!cooked) return false
  if (!String(cooked.innerHTML || '').trim()) return false

  cache.posts.set(postNumber, el.tagName === 'ARTICLE' ? article.outerHTML : el.outerHTML)
  if (cache.posts.size >= TOPIC_POST_CACHE_HARD_LIMIT) {
    cache.hardLimitReached = true
    toast(
      '缓存达到上限',
      `已缓存 ${cache.posts.size} 楼（上限 ${TOPIC_POST_CACHE_HARD_LIMIT}），建议分段导出或刷新页面释放内存`
    )
  }
  return true
}

function collectUserActivityItemInto(cache: ActiveUserActivityCache, item: HTMLElement): boolean {
  if (cache.hardLimitReached) return false

  const excerpt = item.querySelector<HTMLElement>('.excerpt[data-post-id]')
  if (!excerpt) return false
  const postId = excerpt.getAttribute('data-post-id') || ''
  if (!postId) return false
  if (cache.items.has(postId)) return false

  const timeEl = item.querySelector<HTMLElement>('.relative-date[data-time]')
  const time = timeEl ? Number.parseInt(timeEl.getAttribute('data-time') || '', 10) : 0
  cache.items.set(postId, { html: item.outerHTML, time: Number.isFinite(time) ? time : 0 })
  if (cache.items.size >= USER_ACTIVITY_CACHE_HARD_LIMIT) {
    cache.hardLimitReached = true
    toast(
      '缓存达到上限',
      `已缓存 ${cache.items.size} 条活动（上限 ${USER_ACTIVITY_CACHE_HARD_LIMIT}），建议导出后刷新页面释放内存`
    )
  }
  return true
}

function collectTopicPostFromAddedNode(cache: ActiveTopicCache, node: Node): number {
  if (!(node instanceof Element)) return 0
  if (cache.hardLimitReached) return 0
  let added = 0

  if (node.matches(TOPIC_POST_SELECTOR) && collectTopicPostElementInto(cache, node as HTMLElement)) {
    added += 1
  }
  if (cache.hardLimitReached) return added

  const descendants = node.querySelectorAll<HTMLElement>(TOPIC_POST_SELECTOR)
  for (const el of descendants) {
    if (collectTopicPostElementInto(cache, el)) added += 1
    if (cache.hardLimitReached) break
  }

  return added
}

function collectUserActivityFromAddedNode(cache: ActiveUserActivityCache, node: Node): number {
  if (!(node instanceof Element)) return 0
  if (cache.hardLimitReached) return 0
  let added = 0

  if (
    node.matches(USER_ACTIVITY_ITEM_SELECTOR) &&
    collectUserActivityItemInto(cache, node as HTMLElement)
  ) {
    added += 1
  }
  if (cache.hardLimitReached) return added

  const descendants = node.querySelectorAll<HTMLElement>(USER_ACTIVITY_ITEM_SELECTOR)
  for (const item of descendants) {
    if (collectUserActivityItemInto(cache, item)) added += 1
    if (cache.hardLimitReached) break
  }

  return added
}

function collectTopicPostFromMutations(cache: ActiveTopicCache, records: MutationRecord[]): number {
  if (cache.hardLimitReached) return 0
  let added = 0
  for (const record of records) {
    if (record.type === 'attributes' && record.target instanceof HTMLElement) {
      added += collectTopicPostFromAddedNode(cache, record.target)
      if (cache.hardLimitReached) break
      continue
    }
    if (record.type !== 'childList') continue
    for (const node of Array.from(record.addedNodes)) {
      added += collectTopicPostFromAddedNode(cache, node)
      if (cache.hardLimitReached) break
    }
    if (cache.hardLimitReached) break
  }
  return added
}

function collectUserActivityFromMutations(
  cache: ActiveUserActivityCache,
  records: MutationRecord[]
): number {
  if (cache.hardLimitReached) return 0
  let added = 0
  for (const record of records) {
    if (record.type === 'attributes' && record.target instanceof HTMLElement) {
      added += collectUserActivityFromAddedNode(cache, record.target)
      if (cache.hardLimitReached) break
      continue
    }
    if (record.type !== 'childList') continue
    for (const node of Array.from(record.addedNodes)) {
      added += collectUserActivityFromAddedNode(cache, node)
      if (cache.hardLimitReached) break
    }
    if (cache.hardLimitReached) break
  }
  return added
}

function collectTopicPostOuterHtmlInto(cache: ActiveTopicCache): number {
  if (cache.hardLimitReached) return 0

  const root =
    document.querySelector<HTMLElement>('div.post-stream') ??
    document.querySelector<HTMLElement>('#post-stream') ??
    document

  const nodes = Array.from(root.querySelectorAll<HTMLElement>(TOPIC_POST_SELECTOR))
  let added = 0

  for (const el of nodes) {
    if (collectTopicPostElementInto(cache, el)) added += 1
    if (cache.hardLimitReached) break
  }

  return added
}

function collectUserActivityOuterHtmlInto(cache: ActiveUserActivityCache): number {
  if (cache.hardLimitReached) return 0

  const userStream = document.querySelector<HTMLElement>('.user-stream')
  if (!userStream) return 0

  const items = Array.from(
    userStream.querySelectorAll<HTMLElement>(USER_ACTIVITY_ITEM_SELECTOR)
  )
  let added = 0

  for (const item of items) {
    if (collectUserActivityItemInto(cache, item)) added += 1
    if (cache.hardLimitReached) break
  }

  return added
}

export function getPassiveTopicPostOuterHtmlCache(topicId: number): TopicPostOuterHtmlCache | null {
  if (!activeTopicCache) return null
  if (activeTopicCache.topicId !== topicId) return null
  return activeTopicCache.posts
}

export function getPassiveUserActivityOuterHtmlCache(
  username: string | null
): UserActivityOuterHtmlCache | null {
  if (!activeUserActivityCache) return null
  if ((activeUserActivityCache.username || null) !== (username || null)) return null
  return activeUserActivityCache.items
}

export function startPassiveTopicPostCache(options: { topicId: number }): Disposable {
  const { topicId } = options

  // reset other cache (avoid accumulating memory across routes)
  activeUserActivityCache?.items.clear()
  activeUserActivityCache = null

  activeTopicCache?.posts.clear()
  activeTopicCache = { topicId, posts: new Map(), hardLimitReached: false }

  let disposed = false
  let timer: number | null = null
  let observedRoot: Node | null = null
  let observer: MutationObserver | null = null

  const collectNow = () => {
    if (disposed) return
    if (!activeTopicCache || activeTopicCache.topicId !== topicId) return
    collectTopicPostOuterHtmlInto(activeTopicCache)
  }

  const getObserverRoot = () =>
    document.querySelector<HTMLElement>('div.post-stream') ??
    document.querySelector<HTMLElement>('#post-stream') ??
    document.body ??
    document.documentElement

  const observeCurrentRoot = () => {
    if (disposed) return
    const nextRoot = getObserverRoot()
    if (!nextRoot) return
    if (observer && observedRoot === nextRoot) return
    observer?.disconnect()
    observedRoot = nextRoot
    observer = new MutationObserver((records) => {
      if (disposed) return
      observeCurrentRoot()
      const cache = activeTopicCache
      if (!cache || cache.topicId !== topicId) return
      const added = collectTopicPostFromMutations(cache, records)
      if (added === 0) scheduleCollect()
    })
    observer.observe(nextRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-post-number', 'data-post-id'],
    })
  }

  const scheduleCollect = () => {
    if (disposed) return
    if (timer != null) return
    timer = window.setTimeout(() => {
      timer = null
      observeCurrentRoot()
      collectNow()
    }, COLLECT_THROTTLE_MS)
  }

  const onScroll = () => {
    observeCurrentRoot()
    scheduleCollect()
  }
  window.addEventListener('scroll', onScroll, { passive: true })

  observeCurrentRoot()
  scheduleCollect()

  return toDisposable(() => {
    disposed = true
    if (timer != null) window.clearTimeout(timer)
    window.removeEventListener('scroll', onScroll)
    observer?.disconnect()
    observer = null
    observedRoot = null
    const cache = activeTopicCache
    if (cache && cache.topicId === topicId) {
      cache.posts.clear()
      if (activeTopicCache === cache) activeTopicCache = null
    }
  })
}

export function startPassiveUserActivityCache(options: { username: string | null }): Disposable {
  const { username } = options

  // reset other cache (avoid accumulating memory across routes)
  activeTopicCache?.posts.clear()
  activeTopicCache = null

  activeUserActivityCache?.items.clear()
  activeUserActivityCache = {
    username: username || null,
    items: new Map(),
    hardLimitReached: false,
  }

  let disposed = false
  let timer: number | null = null
  let observedRoot: Node | null = null
  let observer: MutationObserver | null = null

  const collectNow = () => {
    if (disposed) return
    if (
      !activeUserActivityCache ||
      (activeUserActivityCache.username || null) !== (username || null)
    )
      return
    collectUserActivityOuterHtmlInto(activeUserActivityCache)
  }

  const getObserverRoot = () =>
    document.querySelector<HTMLElement>('.user-stream') ??
    document.body ??
    document.documentElement

  const observeCurrentRoot = () => {
    if (disposed) return
    const nextRoot = getObserverRoot()
    if (!nextRoot) return
    if (observer && observedRoot === nextRoot) return
    observer?.disconnect()
    observedRoot = nextRoot
    observer = new MutationObserver((records) => {
      if (disposed) return
      observeCurrentRoot()
      const cache = activeUserActivityCache
      if (!cache || (cache.username || null) !== (username || null)) return
      const added = collectUserActivityFromMutations(cache, records)
      if (added === 0) scheduleCollect()
    })
    observer.observe(nextRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-post-id', 'data-time'],
    })
  }

  const scheduleCollect = () => {
    if (disposed) return
    if (timer != null) return
    timer = window.setTimeout(() => {
      timer = null
      observeCurrentRoot()
      collectNow()
    }, COLLECT_THROTTLE_MS)
  }

  const onScroll = () => {
    observeCurrentRoot()
    scheduleCollect()
  }
  window.addEventListener('scroll', onScroll, { passive: true })

  observeCurrentRoot()
  scheduleCollect()

  return toDisposable(() => {
    disposed = true
    if (timer != null) window.clearTimeout(timer)
    window.removeEventListener('scroll', onScroll)
    observer?.disconnect()
    observer = null
    observedRoot = null
    const cache = activeUserActivityCache
    if (cache && (cache.username || null) === (username || null)) {
      cache.items.clear()
      if (activeUserActivityCache === cache) activeUserActivityCache = null
    }
  })
}

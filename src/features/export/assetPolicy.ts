import type { NormalizedPost, TopicData } from './types'
import { gmRequest } from '../../platform/tampermonkey/http'
import { cleanUrlParamU, hasUrlParamU } from '../../shared/url'

export type AssetPolicy = 'none' | 'images' | 'all'

export type AssetInlineOptions = {
  policy: AssetPolicy
  concurrency: number
  delayMs: number
  cacheOnly: boolean
}

export type AssetInlineMetrics = {
  discovered: number
  inlined: number
  failed: number
  cacheOnlyHits: number
  cacheOnlyMisses: number
  netOk: number
  netFail: number
  gmOk: number
  gmFail: number
}

export type AssetInlineFailure = {
  url: string
  reason: string
}

function isInlineableUrl(url: string): boolean {
  if (!url) return false
  if (url.startsWith('data:')) return false
  if (url.startsWith('blob:')) return false
  if (url.startsWith('#')) return false
  return url.startsWith('http://') || url.startsWith('https://')
}

function isDiscourseUploadUrl(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith('/uploads/')
  } catch {
    return false
  }
}

function isAttachmentLink(a: HTMLAnchorElement): boolean {
  if (a.classList.contains('attachment')) return true
  if (a.hasAttribute('download')) return true
  const href = String(a.getAttribute('href') || '').trim()
  if (!href) return false
  const cleaned = hasUrlParamU(href) ? cleanUrlParamU(href, window.location.origin) : href
  if (!isInlineableUrl(cleaned)) return false
  return isDiscourseUploadUrl(cleaned)
}

function collectAssetUrlsFromHtml(html: string, policy: AssetPolicy): string[] {
  const container = document.createElement('div')
  container.innerHTML = html

  const urls: string[] = []
  const push = (v: string | null) => {
    if (!v) return
    const raw = String(v).trim()
    if (!raw) return
    const cleaned = hasUrlParamU(raw) ? cleanUrlParamU(raw, window.location.origin) : raw
    if (cleaned && isInlineableUrl(cleaned)) urls.push(cleaned)
  }

  if (policy === 'images' || policy === 'all') {
    // Prefer inlining the "lightbox original" URLs as well, otherwise offline preview may be blurry
    // because <img src> is often an optimized thumbnail.
    for (const a of Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a.lightbox[href], .lightbox-wrapper a[href]')
    )) {
      push(a.getAttribute('href'))
      push(a.getAttribute('data-download-href'))
    }

    for (const img of Array.from(container.querySelectorAll('img'))) {
      push(img.getAttribute('src'))
      push(img.getAttribute('data-src'))
    }

    // Inline uploaded attachments (pdf/zip/...) for true offline reading.
    for (const a of Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      if (a.matches('a.lightbox[href], .lightbox-wrapper a[href]')) continue
      if (!isAttachmentLink(a)) continue
      push(a.getAttribute('href'))
    }
  }

  if (policy === 'all') {
    for (const el of Array.from(container.querySelectorAll('[src]'))) {
      push(el.getAttribute('src'))
    }
    for (const video of Array.from(container.querySelectorAll('video'))) {
      push(video.getAttribute('poster'))
    }
  }

  return urls
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('FileReader error'))
    r.onload = () => resolve(String(r.result ?? ''))
    r.readAsDataURL(blob)
  })
}

function isSameOriginUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.origin === window.location.origin
  } catch {
    return false
  }
}

class HttpStatusError extends Error {
  readonly status: number
  readonly retryAfterMs: number | null

  constructor(message: string, options: { status: number; retryAfterMs?: number | null }) {
    super(message)
    this.name = 'HttpStatusError'
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs ?? null
  }
}

function parseRetryAfterMs(value: string | undefined): number | null {
  const v = String(value || '').trim()
  if (!v) return null
  const sec = Number.parseInt(v, 10)
  if (Number.isFinite(sec) && sec >= 0) return sec * 1000
  const when = new Date(v)
  const ts = when.getTime()
  if (Number.isFinite(ts)) return Math.max(0, ts - Date.now())
  return null
}

async function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'))
    const t = setTimeout(resolve, ms)
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

async function waitForCooldown(options: {
  signal: AbortSignal
  getUntil: () => number
}): Promise<void> {
  const until = options.getUntil()
  const waitMs = until - Date.now()
  if (waitMs <= 0) return
  await sleepWithSignal(waitMs, options.signal)
}

async function fetchAsDataUrlOnce(options: {
  url: string
  signal: AbortSignal
  metrics: AssetInlineMetrics
  cacheOnly: boolean
  getCooldownUntil: () => number
  setCooldownUntil: (ts: number) => void
}): Promise<{ dataUrl: string | null; source: 'cache' | 'net' | 'gm' | 'skip' }> {
  const { url, signal, metrics, cacheOnly } = options

  // Cache-first: only-if-cached is only allowed for same-origin requests.
  if (isSameOriginUrl(url)) {
    try {
      const res = await fetch(url, {
        signal,
        credentials: 'include',
        cache: 'only-if-cached',
        mode: 'same-origin',
      })
      if (res.ok) {
        const blob = await res.blob()
        metrics.cacheOnlyHits += 1
        return { dataUrl: await blobToDataUrl(blob), source: 'cache' }
      }
    } catch {
      // cache miss
    }
    metrics.cacheOnlyMisses += 1
  }

  if (cacheOnly) return { dataUrl: null, source: 'skip' }

  await waitForCooldown({ signal, getUntil: options.getCooldownUntil })

  const same = isSameOriginUrl(url)
  try {
    const res = await fetch(url, {
      signal,
      credentials: same ? 'include' : 'omit',
      cache: 'force-cache',
    })
    if (!res.ok) {
      const retryAfterMs =
        res.status === 429 ? parseRetryAfterMs(res.headers.get('retry-after') || undefined) : null
      if (res.status === 429) {
        const base = retryAfterMs ?? 2500 + Math.floor(Math.random() * 500)
        options.setCooldownUntil(Math.max(options.getCooldownUntil(), Date.now() + base))
      }
      metrics.netFail += 1
      throw new HttpStatusError(`http ${res.status}`, { status: res.status, retryAfterMs })
    }
    const blob = await res.blob()
    metrics.netOk += 1
    return { dataUrl: await blobToDataUrl(blob), source: 'net' }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    if (err instanceof HttpStatusError) throw err
    metrics.netFail += 1
  }

  await waitForCooldown({ signal, getUntil: options.getCooldownUntil })

  try {
    const res = await gmRequest<Blob>({
      url,
      method: 'GET',
      responseType: 'blob',
      anonymous: !same,
      signal,
    })
    if (res.status < 200 || res.status >= 300) {
      const retryAfterMs = res.status === 429 ? parseRetryAfterMs(res.headers['retry-after']) : null
      if (res.status === 429) {
        const base = retryAfterMs ?? 2500 + Math.floor(Math.random() * 500)
        options.setCooldownUntil(Math.max(options.getCooldownUntil(), Date.now() + base))
      }
      metrics.gmFail += 1
      throw new HttpStatusError(`http ${res.status}`, { status: res.status, retryAfterMs })
    }
    const dataUrl = await blobToDataUrl(res.response)
    metrics.gmOk += 1
    return { dataUrl, source: 'gm' }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    if (err instanceof HttpStatusError) throw err
    metrics.gmFail += 1
    throw err
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (index < items.length) {
      const current = items[index++]
      await worker(current)
    }
  })
  await Promise.all(runners)
}

function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve()
  return new Promise((r) => setTimeout(r, ms))
}

function replaceAssetsInPost(
  post: NormalizedPost,
  policy: AssetPolicy,
  mapping: Map<string, string>
): NormalizedPost {
  if (policy === 'none') return post

  const container = document.createElement('div')
  container.innerHTML = post.cookedHtml

  const apply = (el: Element, attr: string) => {
    const v = el.getAttribute(attr)
    if (!v) return
    const cleaned = hasUrlParamU(v) ? cleanUrlParamU(v, window.location.origin) : v
    if (cleaned !== v) el.setAttribute(attr, cleaned)
    const next = mapping.get(cleaned)
    if (!next) return
    el.setAttribute(attr, next)
  }

  if (policy === 'images' || policy === 'all') {
    for (const img of Array.from(container.querySelectorAll('img'))) {
      apply(img, 'src')
      apply(img, 'data-src')
      img.removeAttribute('srcset')
      img.removeAttribute('data-srcset')
    }

    // Discourse lightbox uses:
    // <a class="lightbox" href="(online original)" data-download-href="(online)" ...><img src="(often optimized thumb)" ...></a>.
    //
    // When inlining, prefer keeping the original (href/data-download-href) for both:
    // - offline preview in <img> (avoid blurry upscaled thumbnails)
    // - offline lightbox open (use the best available source)
    for (const a of Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a.lightbox[href], .lightbox-wrapper a[href]')
    )) {
      apply(a, 'href')
      apply(a, 'data-download-href')

      const img = a.querySelector<HTMLImageElement>('img')
      const href = a.getAttribute('href') ?? ''
      const downloadHref = a.getAttribute('data-download-href') ?? ''
      const imgSrc = img?.getAttribute('src') ?? ''
      const bestDataUrl = href.startsWith('data:')
        ? href
        : downloadHref.startsWith('data:')
          ? downloadHref
          : imgSrc.startsWith('data:')
            ? imgSrc
            : null

      if (bestDataUrl) {
        a.setAttribute('href', bestDataUrl)
        if (img) {
          img.setAttribute('src', bestDataUrl)
          img.removeAttribute('data-src')
        }
      }

      a.removeAttribute('data-download-href')
    }

    for (const meta of Array.from(container.querySelectorAll('.lightbox-wrapper .meta')))
      meta.remove()

    for (const a of Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      if (a.matches('a.lightbox[href], .lightbox-wrapper a[href]')) continue
      if (!isAttachmentLink(a)) continue
      apply(a, 'href')
    }
  }

  if (policy === 'all') {
    for (const el of Array.from(container.querySelectorAll('[src]'))) apply(el, 'src')
    for (const video of Array.from(container.querySelectorAll('video'))) apply(video, 'poster')
  }

  return { ...post, cookedHtml: container.innerHTML }
}

export async function inlineAssets(
  data: TopicData,
  options: AssetInlineOptions & { signal: AbortSignal }
): Promise<{ data: TopicData; metrics: AssetInlineMetrics; failures: AssetInlineFailure[] }> {
  if (options.policy === 'none') {
    return {
      data,
      metrics: {
        discovered: 0,
        inlined: 0,
        failed: 0,
        cacheOnlyHits: 0,
        cacheOnlyMisses: 0,
        netOk: 0,
        netFail: 0,
        gmOk: 0,
        gmFail: 0,
      },
      failures: [],
    }
  }

  const allUrls = data.posts.flatMap((p) => collectAssetUrlsFromHtml(p.cookedHtml, options.policy))

  if (options.policy === 'images' || options.policy === 'all') {
    for (const p of data.posts) {
      const raw = String(p.avatarUrl || '').trim()
      if (!raw) continue
      const cleaned = hasUrlParamU(raw) ? cleanUrlParamU(raw, window.location.origin) : raw
      if (cleaned && isInlineableUrl(cleaned)) allUrls.push(cleaned)
    }
  }
  const uniqueUrls = Array.from(new Set(allUrls))

  const mapping = new Map<string, string>()
  let cooldownUntil = 0
  const metrics: AssetInlineMetrics = {
    discovered: uniqueUrls.length,
    inlined: 0,
    failed: 0,
    cacheOnlyHits: 0,
    cacheOnlyMisses: 0,
    netOk: 0,
    netFail: 0,
    gmOk: 0,
    gmFail: 0,
  }
  const failures: AssetInlineFailure[] = []

  await runWithConcurrency(uniqueUrls, options.concurrency, async (url) => {
    if (options.signal.aborted) throw new DOMException('aborted', 'AbortError')
    if (mapping.has(url)) return
    let source: 'cache' | 'net' | 'gm' | 'skip' | null = null
    try {
      const maxAttempts = 2
      let lastErr: unknown = null
      let dataUrl: string | null = null
      for (let i = 0; i < maxAttempts; i += 1) {
        try {
          const res = await fetchAsDataUrlOnce({
            url,
            signal: options.signal,
            metrics,
            cacheOnly: options.cacheOnly,
            getCooldownUntil: () => cooldownUntil,
            setCooldownUntil: (ts) => {
              cooldownUntil = Math.max(cooldownUntil, ts)
            },
          })
          dataUrl = res.dataUrl
          source = res.source
          break
        } catch (err) {
          lastErr = err
          if (err instanceof HttpStatusError && err.status === 429 && i < maxAttempts - 1) {
            const waitMs = err.retryAfterMs ?? Math.max(1200, Math.min(8000, options.delayMs * 3))
            await sleepWithSignal(waitMs, options.signal)
            continue
          }
          throw err
        }
      }
      if (!dataUrl) {
        if (source === 'skip') return
        throw lastErr ?? new Error('inline failed')
      }
      mapping.set(url, dataUrl)
      metrics.inlined += 1
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      metrics.failed += 1
      failures.push({
        url,
        reason: err instanceof Error && err.message ? err.message : 'inline failed',
      })
    } finally {
      if (!options.signal.aborted) {
        // Throttle only when we had to hit network/GM (cache hits should stay fast).
        await sleep(source === 'cache' || source === 'skip' ? 0 : options.delayMs)
      }
    }
  })

  const posts = data.posts.map((p) => {
    const next = replaceAssetsInPost(p, options.policy, mapping)
    if ((options.policy === 'images' || options.policy === 'all') && next.avatarUrl) {
      const raw = String(next.avatarUrl || '').trim()
      const cleaned = hasUrlParamU(raw) ? cleanUrlParamU(raw, window.location.origin) : raw
      const mapped = mapping.get(cleaned)
      if (mapped) return { ...next, avatarUrl: mapped }
      if (cleaned !== raw) return { ...next, avatarUrl: cleaned }
    }
    return next
  })

  return {
    data: { ...data, posts },
    metrics,
    failures,
  }
}

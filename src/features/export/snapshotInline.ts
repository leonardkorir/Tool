import { gmRequest } from '../../platform/tampermonkey/http'
import { cleanUrlParamU, hasUrlParamU } from '../../shared/url'

export type SnapshotInlinePolicy = 'none' | 'images' | 'all'

export type SnapshotInlineOptions = {
  origin: string
  policy: SnapshotInlinePolicy
  delayMs: number
  concurrency: number
  cacheOnly: boolean
  signal: AbortSignal
  onProgress?: (message: string) => void
}

export type SnapshotInlineMetrics = {
  cssLinksTotal: number
  cssLinksInlined: number
  cssUrlDiscovered: number
  cssUrlInlined: number
  imgTotal: number
  imgInlined: number
  fileTotal: number
  fileInlined: number
  cacheOnlyHits: number
  cacheOnlyMisses: number
  netOk: number
  netFail: number
  gmOk: number
  gmFail: number
}

function isInlineableUrl(url: string): boolean {
  if (!url) return false
  const v = url.trim()
  if (!v) return false
  if (v.startsWith('data:')) return false
  if (v.startsWith('blob:')) return false
  if (v.startsWith('#')) return false
  if (v.startsWith('about:')) return false
  if (/^(javascript:|mailto:|tel:)/i.test(v)) return false
  if (v.startsWith('//')) return true
  if (v.startsWith('http://') || v.startsWith('https://')) return true
  // Allow relative URLs like "/uploads/..." or "./x.png".
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)
}

function toAbsoluteUrl(rawUrl: string, base: string): string | null {
  const v = String(rawUrl || '').trim()
  if (!v) return null
  try {
    const abs = new URL(v, base).href
    return hasUrlParamU(abs) ? cleanUrlParamU(abs, base) : abs
  } catch {
    return null
  }
}

function isSameOriginUrl(url: string): boolean {
  try {
    return new URL(url).origin === window.location.origin
  } catch {
    return false
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('FileReader error'))
    r.onload = () => resolve(String(r.result ?? ''))
    r.readAsDataURL(blob)
  })
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
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

function parseSrcsetFirstUrl(srcset: string | null): string {
  if (!srcset) return ''
  const first = String(srcset).split(',')[0]?.trim()
  if (!first) return ''
  return first.split(/\s+/)[0] || ''
}

function getBestImgSrc(img: HTMLImageElement): string {
  const candidates = [
    'data-src',
    'data-original',
    'data-orig-src',
    'data-lazy-src',
    'data-cfsrc',
    'src',
  ]
  for (const attr of candidates) {
    const v = img.getAttribute(attr)
    if (v && String(v).trim()) return String(v).trim()
  }
  const fromSrcset = parseSrcsetFirstUrl(img.getAttribute('srcset'))
  if (fromSrcset) return fromSrcset
  return ''
}

type InlineContext = {
  options: SnapshotInlineOptions
  metrics: SnapshotInlineMetrics
  textCache: Map<string, string>
  dataUrlCache: Map<string, string>
  dataUrlPromiseCache: Map<string, Promise<FetchResult<string>>>
  cooldownUntil: number
}

type FetchResult<T> = { value: T | null; source: 'cache' | 'net' | 'gm' | 'skip' }

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

async function waitForCooldown(ctx: InlineContext): Promise<void> {
  const until = ctx.cooldownUntil
  const waitMs = until - Date.now()
  if (waitMs <= 0) return
  await sleep(waitMs, ctx.options.signal)
}

async function fetchTextCacheFirst(
  ctx: InlineContext,
  absUrl: string
): Promise<FetchResult<string>> {
  const cached = ctx.textCache.get(absUrl)
  if (cached != null) return { value: cached, source: 'cache' }

  const { signal } = ctx.options
  const same = isSameOriginUrl(absUrl)

  if (same) {
    try {
      const res = await fetch(absUrl, {
        signal,
        credentials: 'include',
        cache: 'only-if-cached',
        mode: 'same-origin',
      })
      if (res.ok) {
        const text = await res.text()
        ctx.textCache.set(absUrl, text)
        ctx.metrics.cacheOnlyHits += 1
        return { value: text, source: 'cache' }
      }
    } catch {
      // cache miss
    }
    ctx.metrics.cacheOnlyMisses += 1
  }

  if (ctx.options.cacheOnly) return { value: null, source: 'skip' }

  await waitForCooldown(ctx)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(absUrl, {
        signal,
        credentials: same ? 'include' : 'omit',
        cache: 'force-cache',
      })
      if (!res.ok) {
        if (res.status === 429 && attempt < 1) {
          const retryAfterMs =
            parseRetryAfterMs(res.headers.get('retry-after') || undefined) ??
            2500 + Math.floor(Math.random() * 500)
          ctx.cooldownUntil = Math.max(ctx.cooldownUntil, Date.now() + retryAfterMs)
          ctx.metrics.netFail += 1
          await waitForCooldown(ctx)
          continue
        }
        throw new Error(`http ${res.status}`)
      }
      const text = await res.text()
      ctx.textCache.set(absUrl, text)
      ctx.metrics.netOk += 1
      return { value: text, source: 'net' }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      ctx.metrics.netFail += 1
      break
    }
  }

  try {
    const res = await gmRequest<string>({
      url: absUrl,
      method: 'GET',
      responseType: 'text',
      anonymous: !same,
      signal,
    })
    if (res.status < 200 || res.status >= 300) {
      if (res.status === 429) {
        const retryAfterMs =
          parseRetryAfterMs(res.headers['retry-after']) ?? 2500 + Math.floor(Math.random() * 500)
        ctx.cooldownUntil = Math.max(ctx.cooldownUntil, Date.now() + retryAfterMs)
      }
      throw new Error(`http ${res.status}`)
    }
    const text = res.responseText || String(res.response ?? '')
    ctx.textCache.set(absUrl, text)
    ctx.metrics.gmOk += 1
    return { value: text, source: 'gm' }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      ctx.metrics.gmFail += 1
    }

  return { value: null, source: 'net' }
}

async function fetchDataUrlCacheFirst(
  ctx: InlineContext,
  absUrl: string
): Promise<FetchResult<string>> {
  const cached = ctx.dataUrlCache.get(absUrl)
  if (cached != null) {
    ctx.metrics.cacheOnlyHits += 1
    return { value: cached, source: 'cache' }
  }

  const existingPromise = ctx.dataUrlPromiseCache.get(absUrl)
  if (existingPromise) return await existingPromise

  const p = (async () => {
    const { signal } = ctx.options
    const same = isSameOriginUrl(absUrl)

    if (same) {
      try {
        const res = await fetch(absUrl, {
          signal,
          credentials: 'include',
          cache: 'only-if-cached',
          mode: 'same-origin',
        })
        if (res.ok) {
          const blob = await res.blob()
          const dataUrl = await blobToDataUrl(blob)
          ctx.dataUrlCache.set(absUrl, dataUrl)
          ctx.metrics.cacheOnlyHits += 1
          return { value: dataUrl, source: 'cache' } satisfies FetchResult<string>
        }
      } catch {
        // cache miss
      }
      ctx.metrics.cacheOnlyMisses += 1
    }

    if (ctx.options.cacheOnly) {
      return { value: null, source: 'skip' } satisfies FetchResult<string>
    }

    await waitForCooldown(ctx)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch(absUrl, {
          signal,
          credentials: same ? 'include' : 'omit',
          cache: 'force-cache',
        })
        if (!res.ok) {
          if (res.status === 429 && attempt < 1) {
            const retryAfterMs =
              parseRetryAfterMs(res.headers.get('retry-after') || undefined) ??
              2500 + Math.floor(Math.random() * 500)
            ctx.cooldownUntil = Math.max(ctx.cooldownUntil, Date.now() + retryAfterMs)
            ctx.metrics.netFail += 1
            await waitForCooldown(ctx)
            continue
          }
          throw new Error(`http ${res.status}`)
        }
        const blob = await res.blob()
        const dataUrl = await blobToDataUrl(blob)
        ctx.dataUrlCache.set(absUrl, dataUrl)
        ctx.metrics.netOk += 1
        return { value: dataUrl, source: 'net' } satisfies FetchResult<string>
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err
        ctx.metrics.netFail += 1
        break
      }
    }

    try {
      const res = await gmRequest<Blob>({
        url: absUrl,
        method: 'GET',
        responseType: 'blob',
        anonymous: !same,
        signal,
      })
      if (res.status < 200 || res.status >= 300) {
        if (res.status === 429) {
          const retryAfterMs =
            parseRetryAfterMs(res.headers['retry-after']) ?? 2500 + Math.floor(Math.random() * 500)
          ctx.cooldownUntil = Math.max(ctx.cooldownUntil, Date.now() + retryAfterMs)
        }
        throw new Error(`http ${res.status}`)
      }
      const blob = res.response
      const dataUrl = await blobToDataUrl(blob)
      ctx.dataUrlCache.set(absUrl, dataUrl)
      ctx.metrics.gmOk += 1
      return { value: dataUrl, source: 'gm' } satisfies FetchResult<string>
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      ctx.metrics.gmFail += 1
    }

    return { value: null, source: 'net' } satisfies FetchResult<string>
  })()

  ctx.dataUrlPromiseCache.set(absUrl, p)
  try {
    return await p
  } finally {
    ctx.dataUrlPromiseCache.delete(absUrl)
  }
}

async function inlineCssImports(
  ctx: InlineContext,
  cssText: string,
  baseUrl: string,
  depth: number
): Promise<string> {
  if (depth >= 3) return cssText

  const importRe = /@import\s+(?:url\(\s*)?(?:["']?)([^"')\s]+)(?:["']?)\s*\)?\s*;/gi
  const imports: string[] = []
  cssText.replace(importRe, (_m, url: string) => {
    const u = String(url || '').trim()
    if (u) imports.push(u)
    return ''
  })
  if (imports.length === 0) return cssText

  const resolved = new Map<string, string>()
  await runWithConcurrency(imports, Math.min(3, ctx.options.concurrency), async (raw) => {
    if (ctx.options.signal.aborted) throw new DOMException('aborted', 'AbortError')
    const abs = toAbsoluteUrl(raw, baseUrl)
    if (!abs) return
    const res = await fetchTextCacheFirst(ctx, abs)
    if (!res.value) return
    const expanded = await inlineCssImports(ctx, res.value, abs, depth + 1)
    resolved.set(raw, expanded)
    await sleep(
      res.source === 'cache' || res.source === 'skip' ? 0 : ctx.options.delayMs,
      ctx.options.signal
    )
  })

  return cssText.replace(importRe, (m, url: string) => {
    const key = String(url || '').trim()
    const inlined = resolved.get(key)
    if (!inlined) return m
    const abs = toAbsoluteUrl(key, baseUrl) ?? key
    return `/* @import ${abs} */\n${inlined}\n/* end @import */`
  })
}

async function rewriteCssUrls(
  ctx: InlineContext,
  cssText: string,
  baseUrl: string
): Promise<string> {
  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi
  const rawUrls: string[] = []
  cssText.replace(urlRe, (_m, _q: string, url: string) => {
    const raw = String(url || '').trim()
    if (!raw) return ''
    if (!isInlineableUrl(raw)) return ''
    rawUrls.push(raw)
    return ''
  })

  const absUrls = Array.from(
    new Set(
      rawUrls
        .map((u) => toAbsoluteUrl(u, baseUrl))
        .filter((u): u is string => typeof u === 'string' && u.length > 0)
    )
  )

  ctx.metrics.cssUrlDiscovered += absUrls.length

  const mapping = new Map<string, string>()
  if (ctx.options.policy === 'all') {
    await runWithConcurrency(absUrls, ctx.options.concurrency, async (abs) => {
      if (ctx.options.signal.aborted) throw new DOMException('aborted', 'AbortError')
      const res = await fetchDataUrlCacheFirst(ctx, abs)
      if (res.value) {
        mapping.set(abs, res.value)
        ctx.metrics.cssUrlInlined += 1
      }
      await sleep(
        res.source === 'cache' || res.source === 'skip' ? 0 : ctx.options.delayMs,
        ctx.options.signal
      )
    })
  }

  return cssText.replace(urlRe, (m, q: string, url: string) => {
    const raw = String(url || '').trim()
    if (!raw) return m
    if (!isInlineableUrl(raw)) return m
    const abs = toAbsoluteUrl(raw, baseUrl)
    if (!abs) return m
    const dataUrl = mapping.get(abs)
    if (dataUrl) return `url("${dataUrl}")`
    // keep absolute URLs so online viewing still works even when base href is present
    return q ? `url("${abs}")` : `url(${abs})`
  })
}

async function inlineStylesheets(ctx: InlineContext, root: ParentNode): Promise<void> {
  const links = Array.from(root.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'))
  ctx.metrics.cssLinksTotal = links.length

  if (links.length === 0) return

  // Fetch CSS first (concurrent), then replace DOM sequentially to keep ordering stable.
  const items = links
    .map((link) => {
      const href = link.getAttribute('href') || ''
      const abs = toAbsoluteUrl(href, ctx.options.origin)
      const media = link.getAttribute('media')
      return { link, abs, media }
    })
    .filter((it) => it.abs)

  const cssTexts = new Map<string, string>()
  let fetched = 0
  ctx.options.onProgress?.(`资源内联：CSS 获取 0/${items.length}`)
  await runWithConcurrency(items, Math.min(3, ctx.options.concurrency), async (it) => {
    if (ctx.options.signal.aborted) throw new DOMException('aborted', 'AbortError')
    const res = it.abs ? await fetchTextCacheFirst(ctx, it.abs) : null
    if (it.abs && res?.value) cssTexts.set(it.abs, res.value)
    fetched += 1
    ctx.options.onProgress?.(
      `资源内联：CSS 获取 ${Math.min(fetched, items.length)}/${items.length}`
    )
    await sleep(
      res?.source === 'cache' || res?.source === 'skip' ? 0 : ctx.options.delayMs,
      ctx.options.signal
    )
  })

  let inlined = 0
  let processed = 0
  ctx.options.onProgress?.(`资源内联：CSS 内联 0/${items.length}`)
  for (const it of items) {
    processed += 1
    if (ctx.options.signal.aborted) throw new DOMException('aborted', 'AbortError')
    if (!it.abs) {
      ctx.options.onProgress?.(
        `资源内联：CSS 内联 ${Math.min(processed, items.length)}/${items.length}`
      )
      continue
    }

    const raw = cssTexts.get(it.abs)
    if (!raw) {
      ctx.options.onProgress?.(
        `资源内联：CSS 内联 ${Math.min(processed, items.length)}/${items.length}`
      )
      continue
    }

    let css = await inlineCssImports(ctx, raw, it.abs, 0)
    css = await rewriteCssUrls(ctx, css, it.abs)

    const style = document.createElement('style')
    style.setAttribute('data-ld2-inline', 'stylesheet')
    style.setAttribute('data-ld2-src', it.abs)
    if (it.media) style.setAttribute('media', it.media)
    style.textContent = css

    it.link.insertAdjacentElement('afterend', style)
    it.link.remove()
    inlined += 1
    ctx.metrics.cssLinksInlined = inlined
    ctx.options.onProgress?.(
      `资源内联：CSS 内联 ${Math.min(processed, items.length)}/${items.length}`
    )
  }
}

async function inlineStyleAttributes(ctx: InlineContext, root: ParentNode): Promise<void> {
  // Do NOT use `[style*="url(\"]`-style selectors: they are invalid in some browsers and will throw.
  // Scan `[style]` and filter in JS instead (v1 approach).
  const els = Array.from(root.querySelectorAll<HTMLElement>('[style]')).filter((el) =>
    /url\(/i.test(el.getAttribute('style') || '')
  )
  if (els.length === 0) return

  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi

  let processed = 0
  ctx.options.onProgress?.(`资源内联：BG 处理 0/${els.length}`)
  for (const el of els) {
    processed += 1
    if (ctx.options.signal.aborted) throw new DOMException('aborted', 'AbortError')
    const style = el.getAttribute('style') || ''
    if (!/url\(/i.test(style)) {
      ctx.options.onProgress?.(`资源内联：BG 处理 ${Math.min(processed, els.length)}/${els.length}`)
      continue
    }

    const matches: string[] = []
    style.replace(urlRe, (_m, _q: string, url: string) => {
      const raw = String(url || '').trim()
      if (!raw) return ''
      if (!isInlineableUrl(raw)) return ''
      matches.push(raw)
      return ''
    })

    const absUrls = Array.from(
      new Set(
        matches
          .map((u) => toAbsoluteUrl(u, ctx.options.origin))
          .filter((u): u is string => typeof u === 'string' && u.length > 0)
      )
    )
    const mapping = new Map<string, string>()
    await runWithConcurrency(absUrls, Math.min(2, ctx.options.concurrency), async (abs) => {
      const res = await fetchDataUrlCacheFirst(ctx, abs)
      if (res.value) mapping.set(abs, res.value)
      await sleep(
        res.source === 'cache' || res.source === 'skip' ? 0 : ctx.options.delayMs,
        ctx.options.signal
      )
    })

    const next = style.replace(urlRe, (m, _q: string, url: string) => {
      const raw = String(url || '').trim()
      if (!raw) return m
      if (!isInlineableUrl(raw)) return m
      const abs = toAbsoluteUrl(raw, ctx.options.origin)
      if (!abs) return m
      const dataUrl = mapping.get(abs)
      if (dataUrl) return `url("${dataUrl}")`
      return `url("${abs}")`
    })
    el.setAttribute('style', next)
    ctx.options.onProgress?.(`资源内联：BG 处理 ${Math.min(processed, els.length)}/${els.length}`)
  }
}

async function inlineImages(ctx: InlineContext, root: ParentNode): Promise<void> {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img'))
  ctx.metrics.imgTotal = imgs.length
  if (ctx.options.policy === 'none' || imgs.length === 0) return

  let processed = 0
  let inlined = 0
  ctx.options.onProgress?.(`资源内联：IMG 0/${imgs.length}`)
  for (const img of imgs) {
    processed += 1
    if (ctx.options.signal.aborted) throw new DOMException('aborted', 'AbortError')

    const raw = getBestImgSrc(img)
    if (!raw || !isInlineableUrl(raw)) {
      ctx.options.onProgress?.(`资源内联：IMG ${Math.min(processed, imgs.length)}/${imgs.length}`)
      continue
    }

    const abs = toAbsoluteUrl(raw, ctx.options.origin)
    if (!abs) {
      ctx.options.onProgress?.(`资源内联：IMG ${Math.min(processed, imgs.length)}/${imgs.length}`)
      continue
    }

    const res = await fetchDataUrlCacheFirst(ctx, abs)
    if (res.value) {
      img.setAttribute('src', res.value)
      img.removeAttribute('srcset')
      img.removeAttribute('sizes')
      img.removeAttribute('data-src')
      img.removeAttribute('data-original')
      img.removeAttribute('data-orig-src')
      img.removeAttribute('data-lazy-src')
      img.removeAttribute('data-cfsrc')
      inlined += 1
      ctx.metrics.imgInlined = inlined
    } else {
      // normalize to absolute so online viewing still works
      img.setAttribute('src', abs)
    }

    ctx.options.onProgress?.(`资源内联：IMG ${Math.min(processed, imgs.length)}/${imgs.length}`)
    await sleep(
      res.source === 'cache' || res.source === 'skip' ? 0 : ctx.options.delayMs,
      ctx.options.signal
    )
  }

  // Prefer setting lightbox href to inlined data URL when available.
  for (const a of Array.from(
    root.querySelectorAll<HTMLAnchorElement>('a.lightbox[href], .lightbox-wrapper a[href]')
  )) {
    if (ctx.options.signal.aborted) throw new DOMException('aborted', 'AbortError')
    const hrefRaw = (a.getAttribute('href') || '').trim()
    const hrefAbs =
      hrefRaw && isInlineableUrl(hrefRaw) ? toAbsoluteUrl(hrefRaw, ctx.options.origin) : null
    const dlRaw = (a.getAttribute('data-download-href') || '').trim()
    const dlAbs = dlRaw && isInlineableUrl(dlRaw) ? toAbsoluteUrl(dlRaw, ctx.options.origin) : null

    const best = dlAbs || hrefAbs
    if (!best) continue
    const res = await fetchDataUrlCacheFirst(ctx, best)
    if (res.value) {
      a.setAttribute('href', res.value)
      a.removeAttribute('data-download-href')
      const img = a.querySelector<HTMLImageElement>('img')
      if (img) {
        img.setAttribute('src', res.value)
        img.removeAttribute('data-src')
        img.removeAttribute('srcset')
        img.removeAttribute('sizes')
      }
    } else if (hrefAbs) {
      a.setAttribute('href', hrefAbs)
    }
  }
}

function isDiscourseUploadUrl(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith('/uploads/')
  } catch {
    return false
  }
}

async function inlineFileLinks(ctx: InlineContext, root: ParentNode): Promise<void> {
  if (ctx.options.policy !== 'all') return

  const anchors = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]')).filter((a) => {
    if (a.matches('a.lightbox[href], .lightbox-wrapper a[href]')) return false

    const raw = String(a.getAttribute('href') || '').trim()
    if (!raw) return false
    if (raw.startsWith('#')) return false
    if (raw.startsWith('data:')) return false
    if (raw.startsWith('blob:')) return false
    if (/^(javascript:|mailto:|tel:)/i.test(raw)) return false

    const abs = toAbsoluteUrl(raw, ctx.options.origin)
    if (!abs) return false

    if (a.classList.contains('attachment')) return true
    if (a.hasAttribute('download')) return true
    return isDiscourseUploadUrl(abs)
  })

  ctx.metrics.fileTotal = anchors.length
  if (anchors.length === 0) return

  let processed = 0
  let inlined = 0
  ctx.options.onProgress?.(`资源内联：文件 0/${anchors.length}`)

  for (const a of anchors) {
    processed += 1
    if (ctx.options.signal.aborted) throw new DOMException('aborted', 'AbortError')

    const raw = String(a.getAttribute('href') || '').trim()
    const abs = toAbsoluteUrl(raw, ctx.options.origin)
    if (!abs) {
      ctx.options.onProgress?.(
        `资源内联：文件 ${Math.min(processed, anchors.length)}/${anchors.length}`
      )
      continue
    }

    const res = await fetchDataUrlCacheFirst(ctx, abs)
    if (res.value) {
      a.setAttribute('href', res.value)
      inlined += 1
      ctx.metrics.fileInlined = inlined
    } else {
      a.setAttribute('href', abs)
    }

    ctx.options.onProgress?.(
      `资源内联：文件 ${Math.min(processed, anchors.length)}/${anchors.length}`
    )
    await sleep(
      res.source === 'cache' || res.source === 'skip' ? 0 : ctx.options.delayMs,
      ctx.options.signal
    )
  }
}

export async function inlineSnapshotAssets(
  root: ParentNode,
  options: SnapshotInlineOptions
): Promise<SnapshotInlineMetrics> {
  const metrics: SnapshotInlineMetrics = {
    cssLinksTotal: 0,
    cssLinksInlined: 0,
    cssUrlDiscovered: 0,
    cssUrlInlined: 0,
    imgTotal: 0,
    imgInlined: 0,
    fileTotal: 0,
    fileInlined: 0,
    cacheOnlyHits: 0,
    cacheOnlyMisses: 0,
    netOk: 0,
    netFail: 0,
    gmOk: 0,
    gmFail: 0,
  }

  if (options.policy === 'none') return metrics

  const ctx: InlineContext = {
    options,
    metrics,
    textCache: new Map(),
    dataUrlCache: new Map(),
    dataUrlPromiseCache: new Map(),
    cooldownUntil: 0,
  }

  options.onProgress?.('资源内联：开始…')

  await inlineStylesheets(ctx, root)
  await inlineStyleAttributes(ctx, root)

  if (options.policy === 'images' || options.policy === 'all') {
    await inlineImages(ctx, root)
  }

  await inlineFileLinks(ctx, root)

  options.onProgress?.(
    `资源内联：CSS ${metrics.cssLinksInlined}/${metrics.cssLinksTotal}，IMG ${metrics.imgInlined}/${metrics.imgTotal}，文件 ${metrics.fileInlined}/${metrics.fileTotal}` +
      ''
  )

  return metrics
}

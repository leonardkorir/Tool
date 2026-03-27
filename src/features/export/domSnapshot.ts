import { sanitizeFilename } from '../../shared/filename'
import { tryGetTopicJsonFromDataPreloaded } from '../../platform/discourse/preloaded'
import type { SnapshotInlinePolicy } from './snapshotInline'
import type { SnapshotInlineMetrics } from './snapshotInline'
import { inlineSnapshotAssets } from './snapshotInline'
import { cleanUrlParamU, hasUrlParamU } from '../../shared/url'
import {
  getPassiveTopicPostOuterHtmlCache,
  getPassiveUserActivityOuterHtmlCache,
} from './domPassiveCache'

export type DomSnapshotMode = 'visible' | 'scroll'

export type DomSnapshotScrollConfig = {
  stepPx: number
  delayMs: number
  stableThreshold: number
  maxScrollCount: number
  collectIntervalMs: number
  scrollToTop: boolean
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  const n = Math.floor(value)
  return Math.min(max, Math.max(min, n))
}

function getDocumentScrollHeight(): number {
  const b = document.body?.scrollHeight ?? 0
  const d = document.documentElement?.scrollHeight ?? 0
  return Math.max(b, d)
}

function isVisibleElement(el: Element | null): boolean {
  if (!el) return false
  if (!(el instanceof HTMLElement)) return true
  const style = window.getComputedStyle(el)
  if (style.display === 'none') return false
  if (style.visibility === 'hidden') return false
  if (style.opacity === '0') return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function isNearViewport(el: Element, marginPx = 240): boolean {
  try {
    const rect = el.getBoundingClientRect()
    // Some Discourse spinners exist in DOM but are far away from viewport.
    // Treat off-screen indicators as "not active" to avoid false positives.
    return rect.bottom >= -marginPx && rect.top <= window.innerHeight + marginPx
  } catch {
    return true
  }
}

function hasVisibleMatch(selector: string, root: ParentNode = document): boolean {
  try {
    const nodes = Array.from(root.querySelectorAll(selector))
    for (const el of nodes) if (isVisibleElement(el) && isNearViewport(el)) return true
    return false
  } catch {
    return false
  }
}

function nowTimestampForFilename(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  try {
    const y = d.getFullYear()
    const mo = pad(d.getMonth() + 1)
    const da = pad(d.getDate())
    const hh = pad(d.getHours())
    const mm = pad(d.getMinutes())
    const ss = pad(d.getSeconds())
    return `${y}-${mo}-${da}_${hh}_${mm}_${ss}`
  } catch {
    return new Date().toISOString().slice(0, 19).replace(/[T:]/g, '_')
  }
}

function parsePostNumberFromHref(href: string, origin: string, topicId: number): number | null {
  const raw = String(href || '').trim()
  if (!raw) return null

  const hash = raw.match(/^#post[_-](\d+)\b/i)
  if (hash) {
    const n = Number.parseInt(hash[1], 10)
    return Number.isFinite(n) && n > 0 ? n : null
  }

  let u: URL
  try {
    u = new URL(raw, origin)
  } catch {
    return null
  }

  const parts = u.pathname.split('/').filter(Boolean)
  if (parts[0] !== 't') return null
  const numeric = parts.slice(1).filter((p) => /^\d+$/.test(p))
  if (numeric.length < 2) return null
  const tid = Number.parseInt(numeric[0], 10)
  const postNo = Number.parseInt(numeric[1], 10)
  if (!Number.isFinite(tid) || !Number.isFinite(postNo)) return null
  if (tid !== topicId) return null
  if (postNo <= 0) return null
  return postNo
}

function tryGetExpectedTopicPostCount(topicId: number): number | null {
  let max: number | null = null
  const els = document.querySelectorAll<HTMLElement>(
    '.topic-post-count, [data-post-count], #topic-progress-wrapper, .topic-progress'
  )
  for (const el of Array.from(els)) {
    const candidates: string[] = []
    const attr = el.getAttribute('data-post-count')
    if (attr) candidates.push(attr)
    if (el.textContent) candidates.push(el.textContent)
    for (const c of candidates) {
      const matches = String(c).match(/\d+/g)
      if (!matches) continue
      for (const m of matches) {
        const n = Number.parseInt(m, 10)
        if (!Number.isFinite(n) || n <= 0) continue
        max = max == null ? n : Math.max(max, n)
      }
    }
  }

  const preloaded = tryGetTopicJsonFromDataPreloaded(topicId)
  if (preloaded) {
    const candidates: number[] = []
    if (Number.isFinite(preloaded.posts_count) && preloaded.posts_count > 0)
      candidates.push(preloaded.posts_count)
    const streamLen = Array.isArray(preloaded.post_stream?.stream)
      ? preloaded.post_stream.stream.length
      : 0
    if (Number.isFinite(streamLen) && streamLen > 0) candidates.push(streamLen)
    if (candidates.length > 0) {
      const expected = Math.max(...candidates)
      max = max == null ? expected : Math.max(max, expected)
    }
  }

  return max && max > 0 ? max : null
}

function setAbsoluteTimeText(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.relative-date'))) {
    const title = el.getAttribute('title')
    if (title) {
      el.textContent = title
      continue
    }
    const dataTime = el.getAttribute('data-time')
    if (!dataTime) continue
    const ts = Number.parseInt(dataTime, 10)
    if (!Number.isFinite(ts) || ts <= 0) continue
    try {
      const d = new Date(ts)
      el.textContent = d.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      /* ignore */
    }
  }
}

function expandDetails(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll<HTMLDetailsElement>('details:not([open])')))
    el.setAttribute('open', '')
}

function removeAllScripts(root: ParentNode): void {
  for (const s of Array.from(root.querySelectorAll('script'))) s.remove()
}

function removeBySelectors(root: ParentNode, selectors: string[]): void {
  for (const sel of selectors) {
    try {
      for (const el of Array.from(root.querySelectorAll(sel))) el.remove()
    } catch {
      /* ignore */
    }
  }
}

function stripNonceAttrs(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[nonce],[data-nonce]'))) {
    try {
      el.removeAttribute('nonce')
    } catch {
      /* ignore */
    }
    try {
      el.removeAttribute('data-nonce')
    } catch {
      /* ignore */
    }
  }
}

function sanitizeUrlParams(root: ParentNode, origin: string): void {
  const attrs = ['href', 'src', 'data-src', 'data-download-href']
  const selector = attrs.map((a) => `[${a}]`).join(',')
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    for (const attr of attrs) {
      if (!el.hasAttribute(attr)) continue
      const raw = el.getAttribute(attr) || ''
      if (!raw || !hasUrlParamU(raw)) continue
      try {
        el.setAttribute(attr, cleanUrlParamU(raw, origin))
      } catch {
        /* ignore */
      }
    }
  }
}

function removeBaseTag(root: ParentNode): void {
  try {
    for (const el of Array.from(root.querySelectorAll('base'))) el.remove()
  } catch {
    /* ignore */
  }
}

function absolutizeUrlAttributes(root: ParentNode, origin: string): void {
  const proto = (() => {
    try {
      return new URL(origin).protocol || 'https:'
    } catch {
      return 'https:'
    }
  })()

  const attrs = ['href', 'src', 'data-src', 'data-download-href']
  const selector = attrs.map((a) => `[${a}]`).join(',')
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    for (const attr of attrs) {
      if (!el.hasAttribute(attr)) continue
      const raw = String(el.getAttribute(attr) || '').trim()
      if (!raw) continue
      if (raw.startsWith('#')) continue
      if (raw.startsWith('data:')) continue
      if (raw.startsWith('blob:')) continue
      if (raw.startsWith('about:')) continue
      if (/^(javascript:|mailto:|tel:)/i.test(raw)) continue
      if (raw.startsWith('//')) {
        try {
          el.setAttribute(attr, `${proto}${raw}`)
        } catch {
          /* ignore */
        }
        continue
      }
      if (/^https?:\/\//i.test(raw)) continue
      if (raw.startsWith('/')) {
        try {
          el.setAttribute(attr, `${origin}${raw}`)
        } catch {
          /* ignore */
        }
        continue
      }
      try {
        el.setAttribute(attr, new URL(raw, origin).href)
      } catch {
        /* ignore */
      }
    }
  }
}

function injectBaseHref(docClone: HTMLElement, origin: string): void {
  const head = docClone.querySelector('head')
  if (!head) return
  head.querySelectorAll('base').forEach((b) => {
    b.remove()
  })
  const base = document.createElement('base')
  base.href = origin.endsWith('/') ? origin : `${origin}/`
  head.insertBefore(base, head.firstChild)
}

function patchTopicAnchorsForOffline(
  docClone: HTMLElement,
  options: { origin: string; topicId: number; hrefForPostNumber?: (postNo: number) => string }
): void {
  const { origin, topicId } = options
  const hasUnderscore = (n: number) => docClone.querySelector(`#post_${n}`) != null
  const anchorFor = (n: number) => (hasUnderscore(n) ? `#post_${n}` : `#post-${n}`)
  const hrefFor = options.hrefForPostNumber ?? anchorFor

  // Quote blocks: set their "back" links to offline anchors.
  for (const aside of Array.from(
    docClone.querySelectorAll<HTMLElement>('aside.quote[data-post]')
  )) {
    const postNo = Number.parseInt(aside.getAttribute('data-post') || '', 10)
    if (!Number.isFinite(postNo) || postNo <= 0) continue
    const href = hrefFor(postNo)
    for (const a of Array.from(
      aside.querySelectorAll<HTMLAnchorElement>('a.back, a[data-can-navigate-to-post]')
    )) {
      a.setAttribute('href', href)
    }
  }

  // reply-to tab: rewrite to offline anchors.
  for (const a of Array.from(
    docClone.querySelectorAll<HTMLAnchorElement>('a.reply-to-tab[href]')
  )) {
    const target = parsePostNumberFromHref(a.getAttribute('href') || a.href, origin, topicId)
    if (!target) continue
    a.setAttribute('href', hrefFor(target))
    a.setAttribute('data-ld2-reply-to', String(target))
  }

  // General same-topic post links: rewrite to offline anchors (important when <base> is used).
  for (const a of Array.from(docClone.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const hrefAttr = a.getAttribute('href') || ''
    if (hrefAttr.startsWith('#post_') || hrefAttr.startsWith('#post-')) continue
    const target = parsePostNumberFromHref(hrefAttr, origin, topicId)
    if (!target) continue
    a.setAttribute('href', hrefFor(target))
  }
}

export function injectOfflineInteractions(docClone: HTMLElement): void {
  const head = docClone.querySelector('head')
  const body = docClone.querySelector('body')
  if (!head || !body) return
  const doc = docClone.ownerDocument ?? document

  if (!head.querySelector('#ld2-offline-style')) {
    const style = doc.createElement('style')
    style.id = 'ld2-offline-style'
    style.textContent = `.cooked .spoiled.spoiler-blurred,.cooked .spoiled[data-spoiler-state=blurred]{filter:blur(6px);cursor:pointer;transition:filter .16s ease}.cooked .spoiled.spoiler-blurred:hover{filter:blur(5px)}html.ld2-lightbox-open{overflow:hidden}.ld2-lightbox{position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;padding:16px;background:#000000b8;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}.ld2-lightbox[data-open=true]{display:flex;animation:ld2-lb-in .16s ease-out}@keyframes ld2-lb-in{0%{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}.ld2-lightbox__inner{width:min(1120px,96vw);max-height:92vh;display:flex;flex-direction:column;gap:10px}.ld2-lightbox__img{width:100%;max-height:82vh;object-fit:contain;border-radius:14px;border:1px solid rgba(255,255,255,.16);background:#ffffff0f;box-shadow:0 16px 60px #00000073}.ld2-lightbox__caption{font-size:12px;line-height:1.45;text-align:center;color:#ffffffe0;word-break:break-word}.ld2-lightbox__close{position:absolute;top:10px;right:10px;width:42px;height:42px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:#00000052;color:#ffffffeb;font-size:26px;line-height:1;cursor:pointer;display:grid;place-items:center}.ld2-lightbox__close:hover{background:#0000007a}.ld2-reply-preview{position:fixed;z-index:2147483646;display:none;width:min(420px,calc(100vw - 24px));max-height:min(240px,calc(100vh - 24px));overflow:auto;padding:10px;border:1px solid rgba(0,0,0,.14);border-radius:14px;background:#fffffff5;box-shadow:0 24px 60px #0000002e}@media(prefers-color-scheme:dark){.ld2-reply-preview{border-color:#ffffff24;background:#111111eb;color:#ffffffeb}}.ld2-reply-preview[data-open=true]{display:block}.ld2-reply-preview__meta{font-size:12px;opacity:.75;margin-bottom:6px}.ld2-reply-preview__text{font-size:13px;line-height:1.55;white-space:pre-wrap}@media(prefers-reduced-motion:reduce){.ld2-lightbox[data-open=true]{animation:none!important}}`
    head.appendChild(style)
  }

  if (!body.querySelector('#ld2-reply-preview')) {
    const preview = doc.createElement('div')
    preview.id = 'ld2-reply-preview'
    preview.className = 'ld2-reply-preview'
    preview.setAttribute('role', 'dialog')
    preview.setAttribute('aria-hidden', 'true')
    preview.innerHTML = `<div class="ld2-reply-preview__meta"></div><div class="ld2-reply-preview__text"></div>`
    body.appendChild(preview)
  }

  if (!body.querySelector('#ld2-lightbox')) {
    const overlay = doc.createElement('div')
    overlay.id = 'ld2-lightbox'
    overlay.className = 'ld2-lightbox'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-hidden', 'true')
    overlay.innerHTML = `<button type="button" class="ld2-lightbox__close" aria-label="关闭">×</button>
<div class="ld2-lightbox__inner">
<img class="ld2-lightbox__img" alt="" />
<div class="ld2-lightbox__caption"></div>
</div>`
    body.appendChild(overlay)
  }

  if (!body.querySelector('#ld2-offline-script')) {
    const script = doc.createElement('script')
    script.id = 'ld2-offline-script'
    script.textContent = `(()=>{const S='.spoiled.spoiler-blurred, .spoiled[data-spoiler-state="blurred"]';function T(t){try{t.classList.remove("spoiler-blurred")}catch{}try{t.setAttribute("data-spoiler-state","revealed")}catch{}try{t.setAttribute("aria-expanded","true")}catch{}}document.addEventListener("click",t=>{const e=t.target;if(!(e instanceof Element))return;const n=e.closest(S);n instanceof HTMLElement&&(e.closest("a[href]")||(t.preventDefault(),t.stopPropagation(),T(n)))},!0),document.addEventListener("keydown",t=>{if(t.key!=="Enter"&&t.key!==" ")return;const e=document.activeElement;e instanceof Element&&e.matches(S)&&(t.preventDefault(),t.stopPropagation(),T(e))},!0);const r=document.getElementById("ld2-lightbox"),p=r&&r.querySelector("img"),h=r&&r.querySelector(".ld2-lightbox__caption"),y=r&&r.querySelector("button");if(!(r instanceof HTMLElement)||!(p instanceof HTMLImageElement)||!(h instanceof HTMLElement)||!(y instanceof HTMLButtonElement))return;function v(){r.removeAttribute("data-open"),r.setAttribute("aria-hidden","true"),document.documentElement.classList.remove("ld2-lightbox-open");try{p.removeAttribute("src")}catch{}try{h.textContent=""}catch{}}function M(t,e){const n=String(t||"").trim();if(!(!n||n.startsWith("#"))){p.src=n,p.alt=String(e||""),h.textContent=String(e||""),r.setAttribute("data-open","true"),r.setAttribute("aria-hidden","false"),document.documentElement.classList.add("ld2-lightbox-open");try{y.focus()}catch{}}}y.addEventListener("click",t=>{t.preventDefault(),t.stopPropagation(),v()},!0),r.addEventListener("click",t=>{t.target===r&&(t.preventDefault(),t.stopPropagation(),v())},!0),document.addEventListener("keydown",t=>{t.key==="Escape"&&v()},!0);const H="a.lightbox[href], .lightbox-wrapper a[href]";document.addEventListener("click",t=>{if(t&&(t.metaKey||t.ctrlKey||t.shiftKey||t.altKey))return;if(typeof t.button==="number"&&t.button!==0)return;const e=t.target;if(!(e instanceof Element)||r.getAttribute("data-open")==="true")return;const n=e.closest(H);if(n instanceof HTMLAnchorElement){const g=String(n.getAttribute("href")||"").trim(),w=String(n.getAttribute("data-download-href")||"").trim(),d=n.querySelector("img")||(e.tagName==="IMG"?e:null),E=d instanceof HTMLImageElement&&(d.getAttribute("alt")||d.getAttribute("title"))||"",f=w||g;if(!f)return;t.preventDefault(),t.stopPropagation(),M(f,E);return}const o=e.closest(".cooked img");if(!(o instanceof HTMLImageElement)||o.classList.contains("emoji")||o.classList.contains("avatar"))return;const s=o.closest("a[href]");if(s&&!(s instanceof HTMLAnchorElement&&s.matches(H)))return;const l=String(o.currentSrc||o.getAttribute("src")||"").trim();!l||l.startsWith("#")||(t.preventDefault(),t.stopPropagation(),M(l,o.getAttribute("alt")||o.getAttribute("title")||""))},!0);const i=document.getElementById("ld2-reply-preview"),b=i&&i.querySelector(".ld2-reply-preview__meta"),L=i&&i.querySelector(".ld2-reply-preview__text"),u=i instanceof HTMLElement&&b instanceof HTMLElement&&L instanceof HTMLElement;let a=!1,c=null;function I(t){return document.getElementById("post-"+t)||document.getElementById("post_"+t)||document.querySelector('[data-post-number="'+t+'"]')}function x(){u&&(a=!1,i.removeAttribute("data-open"),i.setAttribute("aria-hidden","true"),b.textContent="",L.textContent="")}function k(t,e){if(!u)return;const n=parseInt(String(e||""),10);if(!Number.isFinite(n)||n<=0)return;const o=I(n);if(!(o instanceof HTMLElement))return;const s=o.querySelector(".cooked"),l=o.querySelector(".author, .username"),g=o.querySelector("time"),w=s&&s.textContent||"",d=String(w||"").replace(/\\\\s+/g," ").trim().slice(0,240),E=String(l&&l.textContent||"").trim(),f=String(g&&g.textContent||"").trim();b.textContent="\\u9884\\u89C8\\uFF1A#"+n+(E?" \\xB7 "+E:"")+(f?" \\xB7 "+f:""),L.textContent=d||"\\uFF08\\u65E0\\u53EF\\u9884\\u89C8\\u5185\\u5BB9\\uFF09";const P=t.getBoundingClientRect(),m=12,C=Math.min(420,window.innerWidth-m*2),q=Math.max(m,Math.min(window.innerWidth-C-m,P.left)),_=Math.max(m,Math.min(window.innerHeight-240-m,P.bottom+10));i.style.width=C+"px",i.style.left=q+"px",i.style.top=_+"px",i.setAttribute("data-open","true"),i.setAttribute("aria-hidden","false")}function A(t){const e=t.closest("a.reply-to-tab[data-ld2-reply-to]");if(e instanceof HTMLAnchorElement)return{el:e,n:e.getAttribute("data-ld2-reply-to")};const n=t.closest("a.replyto[data-reply-to]");return n instanceof HTMLAnchorElement?{el:n,n:n.getAttribute("data-reply-to")}:null}document.addEventListener("mouseover",t=>{if(!u||a)return;const e=t.target;if(!(e instanceof Element))return;const n=A(e);n&&(c&&(clearTimeout(c),c=null),k(n.el,n.n))},!0),document.addEventListener("mouseout",t=>{if(!u||a)return;const e=t.target;!(e instanceof Element)||!A(e)||(c&&clearTimeout(c),c=setTimeout(()=>x(),120))},!0),document.addEventListener("click",t=>{if(!u)return;const e=t.target;if(!(e instanceof Element))return;const n=A(e);if(n&&!(t&&(t.metaKey||t.ctrlKey||t.shiftKey||t.altKey))){if(t.preventDefault(),t.stopPropagation(),a=!a,!a){x();return}k(n.el,n.n)}},!0),document.addEventListener("keydown",t=>{t.key==="Escape"&&x()},!0)})();`
    body.appendChild(script)
  }
}

function collectVisibleTopicPostOuterHtml(): Map<number, string> {
  const cache = new Map<number, string>()
  const root =
    document.querySelector<HTMLElement>('div.post-stream') ??
    document.querySelector<HTMLElement>('#post-stream') ??
    document

  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>('.topic-post[data-post-number], article[data-post-number]')
  )
  for (const el of nodes) {
    if (el.classList.contains('post-stream--cloaked')) continue

    const postNumRaw = el.getAttribute('data-post-number') || ''
    const postNumber = Number.parseInt(postNumRaw, 10)
    if (!Number.isFinite(postNumber) || postNumber <= 0) continue
    if (cache.has(postNumber)) continue

    const article =
      el.tagName === 'ARTICLE' ? el : el.querySelector<HTMLElement>('article[data-post-id]')
    if (!article) continue
    if (!isVisibleElement(el) && !isVisibleElement(article)) continue

    const cooked = article.querySelector<HTMLElement>('.cooked')
    if (!cooked) continue
    if (!String(cooked.innerHTML || '').trim()) continue

    cache.set(postNumber, el.tagName === 'ARTICLE' ? article.outerHTML : el.outerHTML)
  }

  return cache
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

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return
  return await new Promise((resolve, reject) => {
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

async function collectByScrolling<K, T>(options: {
  signal: AbortSignal
  config?: Partial<DomSnapshotScrollConfig>
  collectOnce: () => Map<K, T>
  onProgress?: (info: { done: number; message: string }) => void
  shouldStop?: (info: {
    merged: Map<K, T>
    stable: number
    stableThreshold: number
    isAtBottom: boolean
    hasSpinner: boolean
  }) => boolean
}): Promise<Map<K, T>> {
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

  const merged = new Map<K, T>()
  const merge = (m: Map<K, T>) => {
    for (const [k, v] of m) if (!merged.has(k)) merged.set(k, v)
  }

  const isAtBottom = () => window.innerHeight + window.scrollY >= getDocumentScrollHeight() - 220
  const hasSpinner = () => {
    if (hasVisibleMatch('.loading-container .spinner')) return true
    if (hasVisibleMatch('.topic-timeline .spinner')) return true

    const postStream =
      document.querySelector<HTMLElement>('div.post-stream') ??
      document.querySelector<HTMLElement>('#post-stream')
    if (postStream && hasVisibleMatch('.spinner', postStream)) return true

    const userStream = document.querySelector<HTMLElement>('.user-stream')
    if (userStream && hasVisibleMatch('.spinner', userStream)) return true

    return false
  }

  try {
    if (cfg.scrollToTop) {
      window.scrollTo(startX, 0)
      await sleep(240, options.signal)
    }

    let stable = 0
    const baseStepPx = cfg.stepPx
    const baseDelayMs = cfg.delayMs
    let stepPx = cfg.stepPx
    let delayMs = cfg.delayMs
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

      const shouldStop = options.shouldStop
        ? options.shouldStop({
            merged,
            stable,
            stableThreshold: cfg.stableThreshold,
            isAtBottom: atBottom,
            hasSpinner: spinner,
          })
        : stable >= cfg.stableThreshold && atBottom && !spinner
      const shouldForceStop =
        // If we cannot scroll further and nothing new appears, stop to avoid infinite scanning.
        (scrollStable >= cfg.stableThreshold && sizeStable >= cfg.stableThreshold && !spinner) ||
        // Sometimes a spinner can get "stuck" or be falsely detected; if we're at bottom and nothing changes for long enough, stop anyway.
        (atBottom && sizeStable >= cfg.stableThreshold && spinnerStable >= cfg.stableThreshold * 2)
      if (shouldStop || shouldForceStop) break

      if (spinner) {
        delayMs = clampInt(Math.max(delayMs, baseDelayMs) + 450, 0, 60_000, baseDelayMs)
        stepPx = clampInt(Math.floor(stepPx * 0.88), 50, 5000, baseStepPx)
      } else {
        delayMs = clampInt(Math.floor(delayMs * 0.92), baseDelayMs, 60_000, baseDelayMs)
        const bump = sizeStable > 0 ? 1.07 : 1.03
        stepPx = clampInt(Math.floor(stepPx * bump), 50, 5000, baseStepPx)
      }

      window.scrollBy(0, stepPx)
      if (cfg.collectIntervalMs > 0) await sleep(cfg.collectIntervalMs, options.signal)
      merge(options.collectOnce())
      const remaining = Math.max(0, delayMs - cfg.collectIntervalMs)
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

export async function exportTopicDomSnapshot(options: {
  origin: string
  topicId: number
  mode: DomSnapshotMode
  signal: AbortSignal
  scrollConfig?: Partial<DomSnapshotScrollConfig>
  inline?: {
    policy: SnapshotInlinePolicy
    delayMs: number
    concurrency: number
    cacheOnly: boolean
  }
  onProgress?: (message: string) => void
}): Promise<{
  filenameBase: string
  html: string
  collected: number
  inlineMetrics: SnapshotInlineMetrics | null
}> {
  const { origin, topicId, signal } = options

  const expected = tryGetExpectedTopicPostCount(topicId)
  const passive = getPassiveTopicPostOuterHtmlCache(topicId)
  const collectCachedOnce = (): Map<number, string> => {
    const visible = collectVisibleTopicPostOuterHtml()
    if (!passive || passive.size === 0) return visible
    const merged = new Map<number, string>(passive)
    for (const [k, v] of visible) merged.set(k, v)
    return merged
  }
  const getCloakedCount = (): number => {
    const stream =
      document.querySelector<HTMLElement>('div.post-stream') ??
      document.querySelector<HTMLElement>('#post-stream') ??
      document
    try {
      return stream.querySelectorAll('.post-stream--cloaked').length
    } catch {
      return 0
    }
  }

  const cachedFirst = collectCachedOnce()
  const collected =
    options.mode === 'scroll'
      ? expected && cachedFirst.size >= expected
        ? cachedFirst
        : await collectByScrolling({
            signal,
            // v1 parity: full export should always start from top (we restore scroll position afterwards).
            config: { ...options.scrollConfig, scrollToTop: true },
            collectOnce: collectVisibleTopicPostOuterHtml,
            onProgress: (p) => {
              const cloaked = getCloakedCount()
              const cloakedLabel = cloaked > 0 ? `（cloaked ${cloaked}）` : ''
              options.onProgress?.(
                expected
                  ? `DOM 滚动收集… 已收集 ${p.done}/${expected} 楼${cloakedLabel}`
                  : `DOM 滚动收集… 已收集 ${p.done} 楼${cloakedLabel}`
              )
            },
            shouldStop: ({ merged, stable, stableThreshold, isAtBottom, hasSpinner }) => {
              if (hasSpinner) return false
              if (expected && merged.size >= expected) return true
              const cloaked = getCloakedCount()
              return stable >= stableThreshold && (isAtBottom || cloaked === 0)
            },
          })
      : cachedFirst

  if (signal.aborted) throw new DOMException('aborted', 'AbortError')

  options.onProgress?.('DOM：克隆页面…')
  const docClone = document.documentElement.cloneNode(true) as HTMLElement

  options.onProgress?.('DOM：重建帖子流…')
  // Rebuild post stream using cached HTML to avoid virtual-scroll placeholders.
  const clonedPostStream =
    docClone.querySelector<HTMLElement>('div.post-stream') ??
    docClone.querySelector<HTMLElement>('#post-stream')
  if (clonedPostStream && collected.size > 0) {
    const nums = Array.from(collected.keys())
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b)
    clonedPostStream.innerHTML = nums
      .map((n) => collected.get(n))
      .filter(Boolean)
      .join('')
  } else {
    docClone.querySelectorAll('.post-stream--cloaked').forEach((el) => {
      el.remove()
    })
  }

  options.onProgress?.('DOM：清理页面…')
  removeAllScripts(docClone)
  stripNonceAttrs(docClone)
  removeBySelectors(docClone, [
    '#ld2-panel',
    '#ld2-fab',
    '#ld2-fab-home',
    '#ld2-fab-export',
    '#ld2-toast',
    'style#ld-tool-styles',
    'style#current-user-mention-css',
    '#current-user',
    '#data-preloaded',
    'meta[name="csrf-token"]',
    'meta[name="csrf-param"]',
    'meta#data-google-tag-manager',
    '.d-header',
    '.modal',
    '.composer',
    '.topic-navigation',
    '.timeline-container',
    '.topic-timeline',
    '.topic-map',
    '#topic-footer-buttons',
    '.topic-footer-main-buttons',
    '.suggested-topics',
    '.suggested-topics-wrapper',
    '.more-topics__container',
    '.related-topics',
    '.sidebar-wrapper',
    '#d-sidebar',
    '.ld2-blocked-post-placeholder',
  ])

  for (const el of Array.from(
    docClone.querySelectorAll<HTMLElement>('[data-ld2-blocked-post-hidden]')
  )) {
    el.style.removeProperty('display')
    el.removeAttribute('data-ld2-blocked-post-hidden')
  }

  sanitizeUrlParams(docClone, origin)
  injectBaseHref(docClone, origin)
  setAbsoluteTimeText(docClone)
  expandDetails(docClone)
  patchTopicAnchorsForOffline(docClone, { origin, topicId })

  let inlineMetrics: SnapshotInlineMetrics | null = null
  const inline = options.inline
  if (inline && inline.policy !== 'none') {
    inlineMetrics = await inlineSnapshotAssets(docClone, {
      origin,
      policy: inline.policy,
      delayMs: inline.delayMs,
      concurrency: inline.concurrency,
      cacheOnly: inline.cacheOnly,
      signal,
      onProgress: options.onProgress,
    })
  }

  // Offline enhancements: lightbox/spoiler/reply preview.
  injectOfflineInteractions(docClone)

  const baseTitle = sanitizeFilename(document.title || `topic_${topicId}`, { maxLength: 80 })
  const filenameBase = `${baseTitle}_${nowTimestampForFilename()}_snapshot`
  return {
    filenameBase,
    html: `<!DOCTYPE html>\n${docClone.outerHTML}`,
    collected: collected.size,
    inlineMetrics,
  }
}

export type DomSnapshotSplitSegment = {
  fileName: string
  startPostNumber: number
  endPostNumber: number
  count: number
}

export async function prepareTopicDomSnapshotSplit(options: {
  origin: string
  topicId: number
  mode: DomSnapshotMode
  signal: AbortSignal
  splitSize: number
  scrollConfig?: Partial<DomSnapshotScrollConfig>
  inline?: {
    policy: SnapshotInlinePolicy
    delayMs: number
    concurrency: number
    cacheOnly: boolean
  }
  onProgress?: (message: string) => void
}): Promise<{
  baseFileName: string
  indexFileName: string
  segments: DomSnapshotSplitSegment[]
  collected: number
  baseInlineMetrics: SnapshotInlineMetrics | null
  renderSegment: (
    segment: DomSnapshotSplitSegment,
    meta: { partNo: number; partTotal: number }
  ) => Promise<{
    html: string
    inlineMetrics: SnapshotInlineMetrics | null
  }>
}> {
  const { origin, topicId, signal } = options

  const expected = tryGetExpectedTopicPostCount(topicId)
  const passive = getPassiveTopicPostOuterHtmlCache(topicId)
  const collectCachedOnce = (): Map<number, string> => {
    const visible = collectVisibleTopicPostOuterHtml()
    if (!passive || passive.size === 0) return visible
    const merged = new Map<number, string>(passive)
    for (const [k, v] of visible) merged.set(k, v)
    return merged
  }
  const getCloakedCount = (): number => {
    const stream =
      document.querySelector<HTMLElement>('div.post-stream') ??
      document.querySelector<HTMLElement>('#post-stream') ??
      document
    try {
      return stream.querySelectorAll('.post-stream--cloaked').length
    } catch {
      return 0
    }
  }

  const cachedFirst = collectCachedOnce()
  const collected =
    options.mode === 'scroll'
      ? expected && cachedFirst.size >= expected
        ? cachedFirst
        : await collectByScrolling({
            signal,
            // v1 parity: full export should always start from top (we restore scroll position afterwards).
            config: { ...options.scrollConfig, scrollToTop: true },
            collectOnce: collectVisibleTopicPostOuterHtml,
            onProgress: (p) => {
              const cloaked = getCloakedCount()
              const cloakedLabel = cloaked > 0 ? `（cloaked ${cloaked}）` : ''
              options.onProgress?.(
                expected
                  ? `DOM 滚动收集… 已收集 ${p.done}/${expected} 楼${cloakedLabel}`
                  : `DOM 滚动收集… 已收集 ${p.done} 楼${cloakedLabel}`
              )
            },
            shouldStop: ({ merged, stable, stableThreshold, isAtBottom, hasSpinner }) => {
              if (hasSpinner) return false
              if (expected && merged.size >= expected) return true
              const cloaked = getCloakedCount()
              return stable >= stableThreshold && (isAtBottom || cloaked === 0)
            },
          })
      : cachedFirst

  if (signal.aborted) throw new DOMException('aborted', 'AbortError')

  const computeAdaptiveSize = (m: Map<number, string>, base: number): number => {
    const desired = clampInt(base, 50, 5000, 500)
    const count = m.size
    if (count <= 0) return desired
    let total = 0
    for (const v of m.values()) total += String(v || '').length
    const avg = total / Math.max(1, count)
    const estPerPost = Math.max(1100, avg + 320)
    const target = 1_800_000
    const recommended = clampInt(Math.floor((target - 30_000) / estPerPost), 50, 5000, 500)
    return desired > recommended ? recommended : desired
  }

  const size = computeAdaptiveSize(collected, options.splitSize)
  const nums = Array.from(collected.keys())
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b)

  const baseTitle = sanitizeFilename(document.title || `topic_${topicId}`, { maxLength: 80 })
  const baseFileName = `${baseTitle}_${nowTimestampForFilename()}_snapshot`
  const base = sanitizeFilename(baseFileName)
  const indexFileName = `${base}_index.html`

  const segmentPosts = new Map<string, number[]>()
  const postToFile = new Map<number, string>()
  const buckets = new Map<number, number[]>()
  for (const n of nums) {
    const idx = Math.floor((n - 1) / size)
    const arr = buckets.get(idx) ?? []
    arr.push(n)
    buckets.set(idx, arr)
  }

  const segments: DomSnapshotSplitSegment[] = []
  const sortedIdx = Array.from(buckets.keys()).sort((a, b) => a - b)
  for (const idx of sortedIdx) {
    const list = (buckets.get(idx) ?? []).sort((a, b) => a - b)
    if (list.length === 0) continue
    const start = idx * size + 1
    const end = start + size - 1
    const fileName = `${base}_p${String(start).padStart(4, '0')}-${String(end).padStart(4, '0')}.html`
    segments.push({ fileName, startPostNumber: start, endPostNumber: end, count: list.length })
    segmentPosts.set(fileName, list)
    for (const postNo of list) postToFile.set(postNo, fileName)
  }

  options.onProgress?.('DOM：构建导出骨架…')
  const baseDoc = document.documentElement.cloneNode(true) as HTMLElement

  const clonedPostStream =
    baseDoc.querySelector<HTMLElement>('div.post-stream') ??
    baseDoc.querySelector<HTMLElement>('#post-stream')
  if (clonedPostStream) {
    clonedPostStream.innerHTML = ''
    try {
      for (const el of Array.from(clonedPostStream.querySelectorAll('.post-stream--cloaked')))
        el.remove()
    } catch {
      /* ignore */
    }
  }

  removeAllScripts(baseDoc)
  stripNonceAttrs(baseDoc)
  removeBySelectors(baseDoc, [
    '#ld2-panel',
    '#ld2-fab',
    '#ld2-fab-home',
    '#ld2-fab-export',
    '#ld2-toast',
    'style#ld-tool-styles',
    'style#current-user-mention-css',
    '#current-user',
    '#data-preloaded',
    'meta[name="csrf-token"]',
    'meta[name="csrf-param"]',
    'meta#data-google-tag-manager',
    '.d-header',
    '.modal',
    '.composer',
    '.topic-navigation',
    '.timeline-container',
    '.topic-timeline',
    '.topic-map',
    '#topic-footer-buttons',
    '.topic-footer-main-buttons',
    '.suggested-topics',
    '.suggested-topics-wrapper',
    '.more-topics__container',
    '.related-topics',
    '.sidebar-wrapper',
    '#d-sidebar',
    '.ld2-blocked-post-placeholder',
  ])

  for (const el of Array.from(
    baseDoc.querySelectorAll<HTMLElement>('[data-ld2-blocked-post-hidden]')
  )) {
    el.style.removeProperty('display')
    el.removeAttribute('data-ld2-blocked-post-hidden')
  }

  sanitizeUrlParams(baseDoc, origin)
  removeBaseTag(baseDoc)
  absolutizeUrlAttributes(baseDoc, origin)
  setAbsoluteTimeText(baseDoc)
  expandDetails(baseDoc)

  let baseInlineMetrics: SnapshotInlineMetrics | null = null
  const inline = options.inline
  if (inline && inline.policy !== 'none') {
    baseInlineMetrics = await inlineSnapshotAssets(baseDoc, {
      origin,
      policy: inline.policy,
      delayMs: inline.delayMs,
      concurrency: inline.concurrency,
      cacheOnly: inline.cacheOnly,
      signal,
      onProgress: options.onProgress,
    })
  }

  injectOfflineInteractions(baseDoc)

  const detectAnchor = (): ((n: number) => string) => {
    for (const html of collected.values()) {
      const m = String(html || '').match(/\bid=["']post([_-])\d+/i)
      if (m && (m[1] === '_' || m[1] === '-')) {
        const style = m[1] as '_' | '-'
        return (n: number) => (style === '_' ? `#post_${n}` : `#post-${n}`)
      }
    }
    return (n: number) => `#post_${n}`
  }
  const anchorFor = detectAnchor()

  return {
    baseFileName: base,
    indexFileName,
    segments,
    collected: collected.size,
    baseInlineMetrics,
    renderSegment: async (segment, meta) => {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      const docClone = baseDoc.cloneNode(true) as HTMLElement
      const stream =
        docClone.querySelector<HTMLElement>('div.post-stream') ??
        docClone.querySelector<HTMLElement>('#post-stream')
      const list = segmentPosts.get(segment.fileName) ?? []
      if (stream && list.length > 0) {
        stream.innerHTML = list
          .map((n) => collected.get(n))
          .filter(Boolean)
          .join('')
      }

      // Apply URL sanitization/absolutization AFTER inserting posts (base skeleton was empty).
      sanitizeUrlParams(docClone, origin)
      absolutizeUrlAttributes(docClone, origin)

      const hrefFor = (postNo: number) => {
        const file = postToFile.get(postNo)
        const anchor = anchorFor(postNo)
        if (!file) return anchor
        return file === segment.fileName ? anchor : `${file}${anchor}`
      }
      patchTopicAnchorsForOffline(docClone, { origin, topicId, hrefForPostNumber: hrefFor })

      let inlineMetrics: SnapshotInlineMetrics | null = null
      if (inline && inline.policy !== 'none') {
        inlineMetrics = await inlineSnapshotAssets(docClone, {
          origin,
          policy: inline.policy,
          delayMs: inline.delayMs,
          concurrency: inline.concurrency,
          cacheOnly: inline.cacheOnly,
          signal,
          onProgress: options.onProgress,
        })
      }

      const titleEl = docClone.querySelector('title')
      if (titleEl) {
        const suffix = `（分段 ${meta.partNo}/${meta.partTotal} · ${segment.startPostNumber}-${segment.endPostNumber}）`
        titleEl.textContent = `${String(titleEl.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()}${suffix}`
      }

      return { html: `<!DOCTYPE html>\n${docClone.outerHTML}`, inlineMetrics }
    },
  }
}

export async function exportUserActivityDomSnapshot(options: {
  origin: string
  username: string | null
  mode: DomSnapshotMode
  signal: AbortSignal
  scrollConfig?: Partial<DomSnapshotScrollConfig>
  inline?: {
    policy: SnapshotInlinePolicy
    delayMs: number
    concurrency: number
    cacheOnly: boolean
  }
  onProgress?: (message: string) => void
}): Promise<{
  filenameBase: string
  html: string
  collected: number
  inlineMetrics: SnapshotInlineMetrics | null
}> {
  const { origin, signal } = options

  const passive = getPassiveUserActivityOuterHtmlCache(options.username)
  const collectCachedOnce = (): Map<string, { html: string; time: number }> => {
    const visible = collectVisibleUserActivityOuterHtml()
    if (!passive || passive.size === 0) return visible
    const merged = new Map<string, { html: string; time: number }>(passive)
    for (const [k, v] of visible) merged.set(k, v)
    return merged
  }
  const cachedFirst = collectCachedOnce()
  const collected =
    options.mode === 'scroll'
      ? await collectByScrolling({
          signal,
          // v1 parity: full export should always start from top (we restore scroll position afterwards).
          config: { ...options.scrollConfig, scrollToTop: true },
          collectOnce: collectVisibleUserActivityOuterHtml,
          onProgress: (p) => options.onProgress?.(`${p.message} 条`),
        })
      : cachedFirst

  if (signal.aborted) throw new DOMException('aborted', 'AbortError')

  const docClone = document.documentElement.cloneNode(true) as HTMLElement
  const clonedStream = docClone.querySelector<HTMLElement>('.user-stream')
  if (clonedStream && collected.size > 0) {
    const items = Array.from(collected.values()).sort((a, b) => (b.time || 0) - (a.time || 0))
    clonedStream.innerHTML = items.map((it) => it.html).join('')
  } else {
    docClone.querySelectorAll('.user-stream .spinner, .load-more-sentinel').forEach((el) => {
      el.remove()
    })
  }

  removeAllScripts(docClone)
  stripNonceAttrs(docClone)
  removeBySelectors(docClone, [
    '#ld2-panel',
    '#ld2-fab',
    '#ld2-fab-home',
    '#ld2-fab-export',
    '#ld2-toast',
    'style#ld-tool-styles',
    'style#current-user-mention-css',
    '#current-user',
    '#data-preloaded',
    'meta[name="csrf-token"]',
    'meta[name="csrf-param"]',
    'meta#data-google-tag-manager',
    '.d-header',
    '.modal',
    '.composer',
    '.sidebar-wrapper',
    '#d-sidebar',
    '.ld2-blocked-post-placeholder',
  ])

  for (const el of Array.from(
    docClone.querySelectorAll<HTMLElement>('[data-ld2-blocked-post-hidden]')
  )) {
    el.style.removeProperty('display')
    el.removeAttribute('data-ld2-blocked-post-hidden')
  }

  sanitizeUrlParams(docClone, origin)
  injectBaseHref(docClone, origin)
  setAbsoluteTimeText(docClone)
  expandDetails(docClone)

  let inlineMetrics: SnapshotInlineMetrics | null = null
  const inline = options.inline
  if (inline && inline.policy !== 'none') {
    inlineMetrics = await inlineSnapshotAssets(docClone, {
      origin,
      policy: inline.policy,
      delayMs: inline.delayMs,
      concurrency: inline.concurrency,
      cacheOnly: inline.cacheOnly,
      signal,
      onProgress: options.onProgress,
    })
  }

  // Offline enhancements: lightbox/spoiler/reply preview (best-effort).
  injectOfflineInteractions(docClone)

  const who = options.username ? `_${options.username}` : ''
  const filenameBase = sanitizeFilename(
    `user_activity${who}_${nowTimestampForFilename()}_snapshot`,
    { maxLength: 120 }
  )
  return {
    filenameBase,
    html: `<!DOCTYPE html>\n${docClone.outerHTML}`,
    collected: collected.size,
    inlineMetrics,
  }
}

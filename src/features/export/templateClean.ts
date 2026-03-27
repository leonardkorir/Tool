import { escapeHtml } from '../../shared/html'
import type { TopicData } from './types'

function formatIsoLocal(iso: string): string {
  try {
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return iso
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

function getAvatarFallbackText(input: string): string {
  const s = String(input || '').trim()
  if (!s) return '?'
  const m = s.match(/[A-Za-z0-9]/)
  if (m?.[0]) return m[0].toUpperCase()
  return s.slice(0, 1)
}

type PartMeta = {
  partNo: number
  partTotal: number
  rangeLabel: string
  indexFileName: string
  prevFileName?: string | null
  nextFileName?: string | null
}

function rewriteTopicPostHref(options: {
  href: string
  origin: string
  topicId: number
  linkForPostNumber: (postNumber: number) => string
}): string {
  const rawHref = options.href.trim()
  if (!rawHref) return options.href

  const hashMatch = rawHref.match(/^#post[_-](\d+)\b/i)
  if (hashMatch) {
    const n = Number.parseInt(hashMatch[1], 10)
    if (Number.isFinite(n) && n > 0) return options.linkForPostNumber(n)
    return options.href
  }

  let u: URL
  try {
    u = new URL(rawHref, options.origin)
  } catch {
    return options.href
  }

  // Match common Discourse patterns:
  // - /t/<slug>/<topicId>/<postNumber>
  // - /t/topic/<topicId>/<postNumber>
  // - /t/<topicId>/<postNumber>
  const parts = u.pathname.split('/').filter(Boolean)
  if (parts[0] !== 't') return options.href
  const numeric = parts.slice(1).filter((p) => /^\d+$/.test(p))
  if (numeric.length < 2) return options.href
  const topicId = Number.parseInt(numeric[0], 10)
  const postNumber = Number.parseInt(numeric[1], 10)
  if (!Number.isFinite(topicId) || !Number.isFinite(postNumber)) return options.href
  if (topicId !== options.topicId) return options.href
  if (postNumber <= 0) return options.href

  return options.linkForPostNumber(postNumber)
}

function patchCookedHtmlForOffline(options: {
  cookedHtml: string
  origin: string
  topicId: number
  linkForPostNumber: (postNumber: number) => string
}): string {
  const html = options.cookedHtml
  if (!html) return html
  if (!html.includes('href=')) return html
  if (!html.includes('/t/') && !html.includes('#post') && !html.includes('#post_')) return html

  const apply = (href: string) =>
    rewriteTopicPostHref({
      href,
      origin: options.origin,
      topicId: options.topicId,
      linkForPostNumber: options.linkForPostNumber,
    })

  // Keep this conservative: only rewrite href values.
  let out = html
  out = out.replace(/\bhref="([^"]+)"/g, (_m, href: string) => `href="${apply(href)}"`)
  out = out.replace(/\bhref='([^']+)'/g, (_m, href: string) => `href='${apply(href)}'`)
  return out
}

export function renderCleanHtml(
  data: TopicData,
  options?: {
    exportedAt?: string
    linkForPostNumber?: (postNumber: number) => string
    partMeta?: PartMeta
  }
): string {
  const exportedAt = options?.exportedAt ?? new Date().toISOString()
  const linkForPostNumber =
    options?.linkForPostNumber ?? ((postNumber: number) => `#post-${postNumber}`)
  const title = escapeHtml(data.topic.title)
  const topicUrl = escapeHtml(
    data.topic.url || `${data.topic.origin}/t/${data.topic.slug}/${data.topic.id}`
  )
  const partMeta = options?.partMeta

  const opUsername = data.posts.find((p) => p.postNumber === 1)?.username ?? null
  const opPost = data.posts.find((p) => p.postNumber === 1) ?? null
  const opDisplayName = opPost ? opPost.name || opPost.username : null
  const opUserUrl = opPost
    ? escapeHtml(`${data.topic.origin}/u/${encodeURIComponent(opPost.username)}`)
    : null

  const metaPieces: string[] = []
  if (opUserUrl && opDisplayName) {
    metaPieces.push(
      `作者 <a href="${opUserUrl}" target="_blank" rel="noreferrer"><strong>${escapeHtml(opDisplayName)}</strong></a>`
    )
  }
  metaPieces.push(
    `导出于 <time datetime="${escapeHtml(exportedAt)}">${escapeHtml(formatIsoLocal(exportedAt))}</time>`
  )
  metaPieces.push(`共 ${data.posts.length} 楼`)
  const metaHtml = metaPieces.join('<span class="sep">·</span>')

  const postsHtml = data.posts
    .map((p) => {
      const displayName = p.name || p.username
      const userUrl = escapeHtml(`${data.topic.origin}/u/${encodeURIComponent(p.username)}`)
      const author = escapeHtml(displayName)
      const createdAt = escapeHtml(formatIsoLocal(p.createdAt))
      const avatarUrl = p.avatarUrl ? escapeHtml(p.avatarUrl) : ''
      const avatarAlt = escapeHtml(`${displayName} 的头像`)
      const avatarFallback = escapeHtml(getAvatarFallbackText(displayName))
      const avatarInner = avatarUrl
        ? `<img class="post-avatar-img" src="${avatarUrl}" alt="${avatarAlt}" loading="lazy" decoding="async" />`
        : `<div class="post-avatar-fallback" aria-hidden="true">${avatarFallback}</div>`
      const avatar = `<a class="avatar-link" href="${userUrl}" target="_blank" rel="noreferrer" aria-label="${avatarAlt}">${avatarInner}</a>`

      const isOp = opUsername != null && p.username === opUsername

      const cooked = patchCookedHtmlForOffline({
        cookedHtml: p.cookedHtml,
        origin: data.topic.origin,
        topicId: data.topic.id,
        linkForPostNumber,
      })
      const replyTo =
        p.replyToPostNumber != null
          ? `<a class="replyto" data-reply-to="${p.replyToPostNumber}" href="${escapeHtml(
              linkForPostNumber(p.replyToPostNumber)
            )}">↩︎ 回复 #${p.replyToPostNumber}</a>`
          : ''

      const onlinePostUrl = escapeHtml(
        p.onlineUrl || `${data.topic.origin}/t/${data.topic.slug}/${data.topic.id}/${p.postNumber}`
      )

      return `
      <article class="post" id="post-${p.postNumber}" data-post-number="${p.postNumber}" data-post-id="${p.id}">
        <div class="post-shell">
          <div class="post-avatar">${avatar}</div>
          <div class="post-main">
            <header class="post-head">
              <div class="post-who">
                <a class="author" href="${userUrl}" target="_blank" rel="noreferrer">${author}</a>
                ${isOp ? `<span class="post-badge op" title="楼主">OP</span>` : ''}
              </div>
              <div class="post-meta">
                <a class="post-no" href="#post-${p.postNumber}" aria-label="锚点 #${p.postNumber}">#${p.postNumber}</a>
                <time class="time" datetime="${escapeHtml(p.createdAt)}">${createdAt}</time>
                ${replyTo}
                <a class="post-open" href="${onlinePostUrl}" target="_blank" rel="noreferrer">在线</a>
              </div>
            </header>
            <div class="cooked">${cooked}</div>
          </div>
        </div>
      </article>
    `
    })
    .join('')

  const partNav =
    partMeta && Number.isFinite(partMeta.partNo) && Number.isFinite(partMeta.partTotal)
      ? `
          <span class="pill">分段：${partMeta.partNo}/${partMeta.partTotal}（${escapeHtml(partMeta.rangeLabel)}）</span>
          <span class="pill"><a href="${escapeHtml(partMeta.indexFileName)}">目录</a></span>
          ${partMeta.prevFileName ? `<span class="pill"><a href="${escapeHtml(partMeta.prevFileName)}">上一段</a></span>` : ''}
          ${partMeta.nextFileName ? `<span class="pill"><a href="${escapeHtml(partMeta.nextFileName)}">下一段</a></span>` : ''}
        `
      : ''

  const partNavRow = partNav ? `<div class="actions-row">${partNav}</div>` : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>${title}</title>
<style>:root{color-scheme:light dark;--bg: #ffffff;--bg-hover: #f8fafc;--fg: #0f172a;--fg-muted: rgba(15,23,42,.62);--border: #e2e8f0;--radius: 8px;--shadow: 0 4px 6px -1px rgba(0,0,0,.1);--code-bg: #f4f4f5;--code-fg: var(--fg);--ld2-head-offset: 16px;--surface: var(--bg);--surface2: var(--bg-hover);--text: var(--fg);--muted: var(--fg-muted);--focus: rgba(15,23,42,.22);--accent: var(--fg);--target: var(--bg-hover)}:root[data-theme=dark]{--bg: #111111;--bg-hover: #18181b;--fg: #f8fafc;--fg-muted: rgba(248,250,252,.7);--border: #27272a;--focus: rgba(248,250,252,.22);--code-bg: #18181b}@media(prefers-color-scheme:dark){:root:not([data-theme]){--bg: #111111;--bg-hover: #18181b;--fg: #f8fafc;--fg-muted: rgba(248,250,252,.7);--border: #27272a;--focus: rgba(248,250,252,.22);--code-bg: #18181b}}*{box-sizing:border-box}html,body{height:100%}html{scroll-padding-top:var(--ld2-head-offset, 16px)}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}a{color:inherit;text-decoration:underline;text-underline-offset:2px}a:hover{opacity:.92}a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--focus);outline-offset:2px}.muted{color:var(--muted)}.wrap{max-width:700px;margin:0 auto;padding:28px 16px 72px}.head{padding:8px 0 16px;border-bottom:1px solid var(--border);background:transparent}.head-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.head-actions{display:flex;align-items:center;gap:8px;flex:0 0 auto}.icon-btn{appearance:none;border:1px solid var(--border);background:transparent;color:var(--fg);width:32px;height:32px;border-radius:var(--radius);display:grid;place-items:center;cursor:pointer;transition:background .14s ease,border-color .14s ease,color .14s ease}.icon-btn:hover,.icon-btn:active{background:var(--bg-hover)}.icon-btn .icon{width:18px;height:18px;display:block}#ld2-theme-toggle .i-sun{display:none}:root[data-theme=dark] #ld2-theme-toggle .i-sun{display:block}:root[data-theme=dark] #ld2-theme-toggle .i-moon{display:none}@media(prefers-color-scheme:dark){:root:not([data-theme]) #ld2-theme-toggle .i-sun{display:block}:root:not([data-theme]) #ld2-theme-toggle .i-moon{display:none}}h1{font-size:32px;margin:0;letter-spacing:-.01em;line-height:1.2}.topic-title{color:var(--fg);text-decoration:none}.topic-title:hover{text-decoration:underline;opacity:1}.meta{margin-top:8px;font-size:13px;line-height:1.45;color:var(--fg-muted)}.meta strong{color:var(--fg);font-weight:600}.meta .sep{margin:0 6px}.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);background:var(--bg-hover);color:var(--fg);border-radius:var(--radius);padding:6px 10px;font-size:12px;line-height:1}.pill a{color:inherit;text-decoration:none}.pill a:hover{text-decoration:underline;opacity:1}.actions-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}.posts{margin-top:18px}.post{background:transparent;border:0;border-bottom:1px solid var(--border);border-radius:0;padding:24px 0;margin:0;box-shadow:none;scroll-margin-top:var(--ld2-head-offset, 16px)}.post:last-child{border-bottom:0}.post:target{background:var(--bg-hover);border-radius:var(--radius);margin:0 -12px;padding:24px 12px}.post-shell{display:flex;gap:12px;align-items:flex-start}.post-avatar{flex:0 0 auto}.avatar-link{display:block;text-decoration:none}.post-avatar-img,.post-avatar-fallback{width:32px;height:32px;border-radius:999px;border:1px solid var(--border);background:var(--bg-hover);display:grid;place-items:center;overflow:hidden;box-shadow:none}.post-avatar-img{object-fit:cover}.post-avatar-fallback{font-weight:700;letter-spacing:-.01em;color:var(--fg);background:var(--bg-hover)}.post-main{min-width:0;flex:1 1 auto}.post-head{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;justify-content:space-between;margin-bottom:10px}.post-who{display:flex;align-items:center;gap:8px;min-width:0}.author{color:var(--fg);font-weight:700;letter-spacing:-.005em;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:min(520px,62vw)}.author:hover{text-decoration:underline}.post-badge{display:inline-flex;align-items:center;justify-content:center;border-radius:6px;padding:2px 6px;font-size:11px;font-weight:650;border:1px solid var(--border);background:var(--bg-hover);color:var(--fg)}.post-badge.op{background:var(--bg-hover);border-color:color-mix(in srgb,var(--fg) 22%,var(--border))}.post-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-end;font-size:12px;color:var(--muted)}.post-no,.replyto{display:inline-flex;align-items:center;gap:6px;color:var(--fg-muted);border-bottom:1px solid transparent;padding:0;font-weight:650;text-decoration:none}.post-no:hover,.replyto:hover{border-bottom-color:currentColor;opacity:1}time.time{white-space:nowrap}.post-open{color:inherit;text-decoration:none;opacity:.92;border-bottom:1px solid transparent}.post-open:hover{opacity:1;text-decoration:none;border-bottom-color:currentColor}@media(max-width:520px){h1{font-size:28px}.post{padding:20px 0}.post:target{margin:0 -8px;padding:20px 8px}.post-shell{gap:10px}.post-avatar-img,.post-avatar-fallback{width:32px;height:32px}.author{max-width:100%}.post-head{flex-direction:column;align-items:flex-start}.post-meta{justify-content:flex-start}}.cooked{word-break:break-word}.cooked p{margin:10px 0}.cooked h2{font-size:16px;margin:16px 0 8px}.cooked h3{font-size:14px;margin:14px 0 8px}.cooked ul,.cooked ol{padding-left:20px;margin:10px 0}.cooked li{margin:6px 0}.cooked hr{border:0;border-top:1px solid var(--border);margin:16px 0}.cooked img:not(.emoji):not(.avatar){max-width:100%;height:auto;border-radius:var(--radius);border:1px solid var(--border);background:var(--bg-hover)}.cooked img.emoji{width:1.25em;height:1.25em;vertical-align:-.18em;border:0!important;background:transparent!important;border-radius:0!important}.lightbox-wrapper{margin:10px 0}.lightbox-wrapper a.lightbox{display:inline-block}.cooked a.lightbox img{cursor:zoom-in}.lightbox-wrapper .meta,.d-icon,.svg-icon{display:none!important}.cooked a.mention,.cooked .mention{display:inline-flex;align-items:center;gap:6px;padding:1px 6px;border-radius:6px;border:1px solid var(--border);background:var(--bg-hover);color:var(--fg);font-weight:650;font-size:.92em;text-decoration:none}.cooked a.mention:hover,.cooked .mention:hover{text-decoration:underline}.cooked details{border:1px solid var(--border);background:var(--bg-hover);border-radius:var(--radius);padding:10px;margin:10px 0;overflow:hidden}.cooked summary{list-style:none;cursor:pointer;user-select:none;font-weight:650;display:flex;align-items:center;justify-content:space-between;gap:10px}.cooked summary::-webkit-details-marker{display:none}.cooked summary:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:var(--radius)}.cooked details[open]>summary{border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:10px}html.ld2-lightbox-open{overflow:hidden}.ld2-lightbox{position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;padding:16px;background:#000c}.ld2-lightbox[data-open=true]{display:flex;animation:ld2-lb-in .16s ease-out}@keyframes ld2-lb-in{0%{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}.ld2-lightbox__inner{width:min(1120px,96vw);max-height:92vh;display:flex;flex-direction:column;gap:10px}.ld2-lightbox__img{width:100%;max-height:82vh;object-fit:contain;border-radius:var(--radius);border:1px solid rgba(255,255,255,.14);background:#ffffff0a;box-shadow:none}.ld2-lightbox__caption{font-size:12px;line-height:1.45;text-align:center;color:#ffffffe0;word-break:break-word}.ld2-lightbox__close{position:absolute;top:10px;right:10px;width:36px;height:36px;border:1px solid rgba(255,255,255,.14);border-radius:var(--radius);background:#ffffff0f;color:#ffffffeb;font-size:24px;line-height:1;cursor:pointer;display:grid;place-items:center;transition:background .14s ease}.ld2-lightbox__close:hover,.ld2-lightbox__close:active{background:#ffffff1a}.ld2-lightbox__close:focus-visible{outline:2px solid rgba(255,255,255,.35);outline-offset:2px}.ld2-reply-preview{position:fixed;z-index:2147483646;display:none;width:min(420px,calc(100vw - 24px));max-height:min(240px,calc(100vh - 24px));overflow:auto;padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);box-shadow:var(--shadow)}.ld2-reply-preview[data-open=true]{display:block}.ld2-reply-preview__meta{font-size:12px;color:var(--muted);margin-bottom:6px}.ld2-reply-preview__text{font-size:13px;line-height:1.55;white-space:pre-wrap}.cooked aside.quote{border:1px solid var(--border);background:var(--bg-hover);border-radius:var(--radius);padding:10px;margin:10px 0}.cooked aside.quote .quote-controls{display:none!important}.cooked aside.quote .title{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);margin:0 0 8px}.cooked aside.quote .title img.avatar{width:18px;height:18px;border-radius:999px;border:1px solid var(--border);background:var(--bg);flex:0 0 auto}.cooked aside.quote blockquote{margin:0}.cooked aside.onebox{border:1px solid var(--border);background:var(--bg-hover);border-radius:var(--radius);padding:10px;margin:10px 0}.cooked aside.onebox .onebox-metadata:empty{display:none!important}.cooked aside.onebox .onebox-body{margin:0}.cooked aside.onebox .aspect-image{float:none!important;margin:0 0 10px}.cooked aside.onebox img.thumbnail{width:100%;height:auto;border-radius:var(--radius);border:1px solid var(--border);background:var(--bg);display:block}.cooked aside.onebox h3{font-size:14px;margin:0 0 6px}.cooked aside.onebox p{margin:6px 0 0;color:var(--muted);font-size:12px}.cooked .spoiled.spoiler-blurred,.cooked .spoiled[data-spoiler-state=blurred]{cursor:pointer;border-radius:4px;border:1px solid var(--border);background:var(--bg-hover);color:transparent!important;box-decoration-break:clone;-webkit-box-decoration-break:clone}pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace}code{font-size:13px;border:1px solid var(--border);background:var(--bg-hover);border-radius:6px;padding:2px 6px}pre{overflow:auto;padding:12px;border-radius:var(--radius);background:var(--code-bg);color:var(--fg);border:1px solid var(--border);font-size:13px;position:relative}pre code{background:transparent;border:0;padding:0;color:inherit}.code-copy{position:absolute;top:8px;right:8px;border:1px solid var(--border);background:var(--bg);color:var(--fg-muted);padding:4px 8px;border-radius:6px;font-size:12px;font-weight:650;cursor:pointer;opacity:0;transition:opacity .14s ease,background .14s ease}pre:hover .code-copy,pre:focus-within .code-copy{opacity:1}.code-copy:hover,.code-copy:active{background:var(--bg-hover)}blockquote{border-left:4px solid var(--border);margin:12px 0;padding:2px 12px;color:var(--fg-muted)}table{width:100%;border-collapse:collapse;margin:10px 0;display:block;overflow:auto}th,td{border:1px solid var(--border);padding:8px;vertical-align:top}th{background:var(--bg-hover)}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}.ld2-lightbox[data-open=true]{animation:none!important}.ld2-lightbox__close{transition:none!important}}</style>
</head>
<body>
<div class="wrap">
<div class="head">
<div class="head-top">
<h1><a class="topic-title" href="${topicUrl}" target="_blank" rel="noreferrer">${title}</a></h1>
<div class="head-actions">
<button id="ld2-theme-toggle" class="icon-btn" type="button" aria-label="切换主题" title="跟随系统（点击：切换主题）" aria-pressed="false">
<span class="i-moon" aria-hidden="true">
<svg class="icon" viewBox="0 0 24 24" fill="none">
<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a7 7 0 1 0 11 11Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
</svg>
</span>
<span class="i-sun" aria-hidden="true">
<svg class="icon" viewBox="0 0 24 24" fill="none">
<path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z" stroke="currentColor" stroke-width="2"/>
<path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
</span>
</button>
</div>
</div>
<div class="meta">${metaHtml}</div>
${partNavRow}
</div>
<div class="posts">
${postsHtml}
</div>
</div>
<script>(()=>{const d=document.documentElement,m=document.getElementById("ld2-theme-toggle"),f=window.matchMedia?window.matchMedia("(prefers-color-scheme: dark)"):null,k=()=>!!f&&f.matches,E=()=>{if(!(m instanceof HTMLButtonElement))return;const t=d.getAttribute("data-theme"),n=k(),e=t==="dark"||!t&&n;m.setAttribute("aria-pressed",e?"true":"false");const r=t?"已自定义":"跟随系统",i=t?"点击：跟随系统":"点击：切换主题";m.title=r+"（"+i+"）"};if(E(),m instanceof HTMLButtonElement){m.addEventListener("click",n=>{if(n.preventDefault(),d.getAttribute("data-theme")){try{d.removeAttribute("data-theme")}catch{}E();return}const r=k()?"light":"dark";try{d.setAttribute("data-theme",r)}catch{}E()},!0);const t=()=>{try{d.removeAttribute("data-theme")}catch{}E()};if(f)try{f.addEventListener("change",t)}catch{try{f.addListener(t)}catch{}}}async function K(t){const n=String(t||"");if(!n)return!1;try{if(navigator.clipboard&&window.isSecureContext)return await navigator.clipboard.writeText(n),!0}catch{}try{const e=document.createElement("textarea");e.value=n,e.setAttribute("readonly",""),e.style.position="fixed",e.style.top="-9999px",e.style.left="-9999px",document.body.appendChild(e),e.select();const r=document.execCommand&&document.execCommand("copy");return e.remove(),!!r}catch{return!1}}for(const t of Array.from(document.querySelectorAll(".cooked pre"))){if(!(t instanceof HTMLElement)||t.querySelector("button.code-copy"))continue;const n=t.querySelector("code"),e=(n?n.textContent:t.textContent)||"",r=document.createElement("button");r.type="button",r.className="code-copy",r.textContent="复制",r.setAttribute("aria-label","复制代码"),r.dataset.copyText=e,r.addEventListener("click",async i=>{i.preventDefault(),i.stopPropagation();const c=r.dataset.copyText||"",l=await K(c);r.textContent=l?"已复制":"复制失败",window.setTimeout(()=>{r.textContent="复制"},1200)},!0),t.appendChild(r)}})();</script>
</body>
</html>`
}

import { escapeHtml } from '../../shared/html'

export type UserActivityCard = {
  id: string
  topicTitle: string
  topicHref: string | null
  categoryName: string | null
  timeLabel: string
  cookedHtml: string
}

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

function safeDomId(id: string): string {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'item'
}

export function renderUserActivityCleanHtml(options: {
  title: string
  origin: string
  pageUrl: string
  exportedAt: string
  username: string | null
  items: UserActivityCard[]
}): string {
  const title = escapeHtml(options.title)
  const origin = escapeHtml(options.origin)
  const exportedAtLabel = escapeHtml(formatIsoLocal(options.exportedAt))
  const pageUrl = escapeHtml(options.pageUrl)
  const username = escapeHtml(options.username ? `@${options.username}` : '')
  const usernamePill = username ? `<span class="pill">${username}</span>` : ''

  const itemsHtml = options.items
    .map((it) => {
      const id = safeDomId(it.id)
      const topicTitle = escapeHtml(it.topicTitle || it.topicHref || '话题')
      const categoryName = escapeHtml(it.categoryName || '')
      const timeLabel = escapeHtml(it.timeLabel || '')
      const topicHref = it.topicHref ? escapeHtml(it.topicHref) : ''

      const metaParts = [
        categoryName ? `<span class="badge">${categoryName}</span>` : '',
        timeLabel ? `<span class="muted">${timeLabel}</span>` : '',
      ]
        .filter(Boolean)
        .join('')

      const titleHtml = topicHref
        ? `<a href="${topicHref}" target="_blank" rel="noreferrer">${topicTitle}</a>`
        : topicTitle

      return `<article class="act" id="act-${id}"><div class="act-top"><h2 class="act-title">${titleHtml}</h2><div class="act-meta">${metaParts}</div></div><div class="act-body"><div class="cooked">${it.cookedHtml || '<em class="muted">（该条未缓存到正文内容）</em>'}</div></div></article>`
    })
    .join('')

  const baseHref = options.origin.endsWith('/') ? origin : `${origin}/`

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<base href="${baseHref}" />
<title>${title}</title>
<style>:root{color-scheme:light dark;--bg: #f6f7fb;--surface: rgba(255,255,255,.96);--surface2: rgba(23,23,23,.04);--text: #0f172a;--muted: rgba(15,23,42,.62);--border: rgba(15,23,42,.1);--shadow: 0 18px 48px rgba(0,0,0,.1);--accent: #b8892e;--focus: rgba(184,137,46,.45);--code-bg: #0b0b0b;--code-fg: #e5e7eb}@media(prefers-color-scheme:dark){:root{--bg: #0b0b0b;--surface: rgba(17,17,17,.92);--surface2: rgba(255,255,255,.06);--text: rgba(255,255,255,.92);--muted: rgba(255,255,255,.62);--border: rgba(255,255,255,.14);--shadow: 0 22px 60px rgba(0,0,0,.55);--accent: #f2c94c;--focus: rgba(242,201,76,.55);--code-bg: rgba(0,0,0,.42);--code-fg: rgba(255,255,255,.92)}}*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:radial-gradient(1200px 600px at 10% -10%,rgba(212,175,55,.14),transparent 60%),radial-gradient(900px 500px at 90% 10%,rgba(23,23,23,.06),transparent 55%),var(--bg);color:var(--text);font:16px/1.72 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}a:focus-visible,button:focus-visible{outline:3px solid var(--focus);outline-offset:2px}.muted{color:var(--muted)}.wrap{max-width:980px;margin:0 auto;padding:20px 16px 72px}.card{background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);overflow:hidden}.head{padding:16px 16px 12px;border-bottom:1px solid var(--border)}h1{font-size:20px;margin:0 0 8px;letter-spacing:-.01em}.meta-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);background:var(--surface2);color:var(--text);border-radius:999px;padding:6px 10px;font-size:12px;line-height:1}.pill a{color:inherit}.list{padding:12px 12px 18px}.act{border:1px solid var(--border);background:#fff0;border-radius:14px;box-shadow:0 1px 2px #0000000f;overflow:hidden;margin-top:10px;scroll-margin-top:14px}@media(prefers-color-scheme:dark){.act{box-shadow:0 1px 2px #00000059}}.act-top{padding:12px 12px 10px;border-bottom:1px solid var(--border);background:var(--surface2)}.act-title{margin:0 0 8px;font-size:16px;font-weight:850;letter-spacing:-.01em;line-height:1.35}.act-meta{display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:12px}.badge{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:999px;padding:2px 8px;background:#d4af371a;color:var(--text);font-weight:750}@media(prefers-color-scheme:dark){.badge{background:#f2c94c1f}}.act-body{padding:12px}.cooked{word-break:break-word}.cooked p{margin:10px 0}.cooked h2{font-size:16px;margin:16px 0 8px}.cooked h3{font-size:14px;margin:14px 0 8px}.cooked ul,.cooked ol{padding-left:20px;margin:10px 0}.cooked li{margin:6px 0}.cooked hr{border:0;border-top:1px solid var(--border);margin:16px 0}.cooked img{max-width:100%;height:auto;border-radius:12px;border:1px solid var(--border);background:var(--surface2)}.lightbox-wrapper{margin:10px 0}.lightbox-wrapper a.lightbox{display:inline-block}.cooked a.lightbox img{cursor:zoom-in}.lightbox-wrapper .meta,.d-icon,.svg-icon{display:none!important}html.ld2-lightbox-open{overflow:hidden}.ld2-lightbox{position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;padding:16px;background:#000000b8;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}.ld2-lightbox[data-open=true]{display:flex;animation:ld2-lb-in .16s ease-out}@keyframes ld2-lb-in{0%{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}.ld2-lightbox__inner{width:min(1120px,96vw);max-height:92vh;display:flex;flex-direction:column;gap:10px}.ld2-lightbox__img{width:100%;max-height:82vh;object-fit:contain;border-radius:14px;border:1px solid rgba(255,255,255,.16);background:#ffffff0f;box-shadow:0 16px 60px #00000073}.ld2-lightbox__caption{font-size:12px;line-height:1.45;text-align:center;color:#ffffffe0;word-break:break-word}.ld2-lightbox__close{position:absolute;top:10px;right:10px;width:42px;height:42px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:#00000052;color:#ffffffeb;font-size:26px;line-height:1;cursor:pointer;display:grid;place-items:center}.ld2-lightbox__close:hover{background:#0000007a}.ld2-lightbox__close:active{transform:translateY(1px)}.ld2-lightbox__close:focus-visible{outline:3px solid var(--focus);outline-offset:2px}@media(prefers-reduced-motion:reduce){.ld2-lightbox[data-open=true]{animation:none!important}}</style>
</head>
<body>
<div class="wrap">
<div class="card">
<div class="head">
<h1>${title}</h1>
<div class="meta-row">
${usernamePill}
<span class="pill">条目：${options.items.length}</span>
<span class="pill">导出时间：${exportedAtLabel}</span>
<span class="pill"><a href="${pageUrl}" target="_blank" rel="noreferrer">打开在线活动页</a></span>
</div>
</div>
<div class="list">
${itemsHtml}
</div>
</div>
</div>
</body>
</html>`
}

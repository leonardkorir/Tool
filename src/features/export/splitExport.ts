import { sanitizeFilename } from '../../shared/filename'
import { escapeHtml } from '../../shared/html'
import type { NormalizedPost, TopicData } from './types'

export type SplitOptions = {
  enabled: boolean
  size: number
  includeIndex: boolean
}

export type SplitSegment = {
  fileName: string
  startPostNumber: number
  endPostNumber: number
  posts: NormalizedPost[]
}

export type SplitIndexSegment = {
  fileName: string
  startPostNumber: number
  endPostNumber: number
  count: number
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  const n = Math.floor(value)
  return Math.min(max, Math.max(min, n))
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

export function splitTopicData(
  data: TopicData,
  options: SplitOptions & { baseFileName: string }
): { segments: SplitSegment[]; postToFile: Map<number, string>; indexFileName: string } {
  const size = clampInt(options.size, 50, 5000, 500)
  const base = sanitizeFilename(options.baseFileName)
  const indexFileName = `${base}_index.html`

  if (!options.enabled) {
    const map = new Map<number, string>()
    for (const p of data.posts) map.set(p.postNumber, `${base}.html`)
    return {
      segments: [
        {
          fileName: `${base}.html`,
          startPostNumber: data.posts[0]?.postNumber ?? 1,
          endPostNumber: data.posts.length > 0 ? data.posts[data.posts.length - 1].postNumber : 1,
          posts: data.posts,
        },
      ],
      postToFile: map,
      indexFileName,
    }
  }

  const buckets = new Map<number, NormalizedPost[]>()
  for (const p of data.posts) {
    const idx = Math.floor((p.postNumber - 1) / size)
    const arr = buckets.get(idx) ?? []
    arr.push(p)
    buckets.set(idx, arr)
  }

  const segments: SplitSegment[] = []
  const postToFile = new Map<number, string>()
  const sortedIdx = Array.from(buckets.keys()).sort((a, b) => a - b)

  for (const idx of sortedIdx) {
    const posts = (buckets.get(idx) ?? []).sort((a, b) => a.postNumber - b.postNumber)
    if (posts.length === 0) continue
    const start = idx * size + 1
    const end = start + size - 1
    const fileName = `${base}_p${String(start).padStart(4, '0')}-${String(end).padStart(4, '0')}.html`
    segments.push({ fileName, startPostNumber: start, endPostNumber: end, posts })
    for (const p of posts) postToFile.set(p.postNumber, fileName)
  }

  return { segments, postToFile, indexFileName }
}

export function renderSplitIndexHtml(options: {
  title: string
  exportedAt: string
  origin: string
  segments: Array<SplitSegment | SplitIndexSegment>
}): string {
  const safeTitle = escapeHtml(sanitizeFilename(options.title, { maxLength: 120 }))
  const exportedAt = formatIsoLocal(options.exportedAt)
  const origin = escapeHtml(options.origin)
  const items = options.segments
    .map((s) => {
      const count = 'count' in s ? s.count : s.posts.length
      return `<li><a class="item" href="${s.fileName}"><span class="range">${s.startPostNumber}-${s.endPostNumber}</span><span class="count">${count} 楼</span></a></li>`
    })
    .join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}（目录）</title>
<style>
:root{
color-scheme: light dark;
--bg: #f6f7fb;
--surface: rgba(255,255,255,0.96);
--surface2: rgba(15,23,42,0.04);
--text: #0f172a;
--muted: rgba(15,23,42,0.62);
--border: rgba(15,23,42,0.10);
--shadow: 0 18px 48px rgba(0,0,0,0.10);
--accent: #b8892e;
}
@media (prefers-color-scheme: dark){
:root{
--bg: #0b0b0b;
--surface: rgba(17,17,17,0.92);
--surface2: rgba(255,255,255,0.06);
--text: rgba(255,255,255,0.92);
--muted: rgba(255,255,255,0.62);
--border: rgba(255,255,255,0.14);
--shadow: 0 22px 60px rgba(0,0,0,0.55);
--accent: #f2c94c;
}
}
html, body{ height: 100%; }
body{
margin:0;
background: radial-gradient(1200px 600px at 10% -10%, rgba(212,175,55,0.14), transparent 60%),
radial-gradient(900px 500px at 90% 10%, rgba(23,23,23,0.06), transparent 55%),
var(--bg);
color: var(--text);
font: 15px/1.72 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
}
a{ color: var(--accent); text-decoration:none;}
a:hover{ text-decoration:underline;}
a:focus-visible{
outline: 3px solid rgba(184,137,46,0.45);
outline-offset: 2px;
}
@media (prefers-color-scheme: dark){
a:focus-visible{ outline-color: rgba(242,201,76,0.55); }
}
.muted{ color: var(--muted); }
.wrap{ max-width: 920px; margin: 0 auto; padding: 20px 16px 72px; }
.card{
background: var(--surface);
border:1px solid var(--border);
border-radius: 16px;
box-shadow: var(--shadow);
padding: 16px;
}
h1{ font-size: 20px; margin: 0 0 8px; letter-spacing: -0.01em; }
.meta-row{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom: 10px; }
.pill{
display:inline-flex;
align-items:center;
border: 1px solid var(--border);
background: var(--surface2);
border-radius: 999px;
padding: 6px 10px;
font-size: 12px;
line-height: 1;
color: var(--text);
}
ol{ list-style:none; padding: 0; margin: 0; }
li{ margin: 8px 0; }
.item{
display:flex;
align-items:center;
justify-content: space-between;
gap: 10px;
padding: 10px 12px;
border: 1px solid var(--border);
border-radius: 14px;
background: var(--surface2);
}
.item:hover{
text-decoration:none;
border-color: rgba(184,137,46,0.35);
background: rgba(212,175,55,0.10);
}
@media (prefers-color-scheme: dark){
.item:hover{
border-color: rgba(242,201,76,0.35);
background: rgba(242,201,76,0.10);
}
}
.range{ font-weight: 800; letter-spacing: -0.01em; }
.count{ color: var(--muted); font-size: 12px; white-space: nowrap; }
</style>
</head>
<body>
<div class="wrap">
<div class="card">
<h1>${safeTitle}</h1>
<div class="meta-row">
<span class="pill">导出时间：${exportedAt}</span>
<span class="pill"><a href="${origin}" target="_blank" rel="noreferrer">原帖链接</a></span>
</div>
<hr style="border:0;border-top:1px solid var(--border);margin:16px 0;" />
<ol>${items}</ol>
</div>
</div>
</body>
</html>`
}

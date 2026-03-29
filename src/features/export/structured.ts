import type { TopicData } from './types'

export type ExportFileFormat = 'html' | 'markdown' | 'json'

export type ExportAssetFailure = {
  url: string
  reason: string
}

export type TopicExportJson = {
  version: 1
  kind: 'topic'
  exportedAt: string
  title: string
  sourceUrl: string
  topicId: number
  slug: string
  origin: string
  postCount: number
  assetFailures: ExportAssetFailure[]
  posts: Array<{
    id: number
    postNumber: number
    username: string
    name: string | null
    avatarUrl: string | null
    createdAt: string
    replyToPostNumber: number | null
    onlineUrl: string | null
    cookedHtml: string
  }>
}

function formatLocalTime(iso: string): string {
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

function escapeInlineMarkdown(text: string): string {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

function normalizeText(text: string): string {
  return String(text || '').replace(/\s+/g, ' ')
}

function isElementNode(node: Node): node is Element {
  return node.nodeType === 1
}

function renderInlineNode(node: Node): string {
  if (node.nodeType === node.TEXT_NODE) return normalizeText(node.textContent || '')
  if (!isElementNode(node)) return ''

  const tag = node.tagName.toLowerCase()
  if (tag === 'br') return '  \n'
  if (tag === 'code' && node.parentElement?.tagName.toLowerCase() !== 'pre') {
    return `\`${escapeInlineMarkdown(node.textContent || '')}\``
  }
  if (tag === 'strong' || tag === 'b') return `**${renderInlineChildren(node.childNodes)}**`
  if (tag === 'em' || tag === 'i') return `*${renderInlineChildren(node.childNodes)}*`
  if (tag === 'a') {
    const text = renderInlineChildren(node.childNodes).trim() || normalizeText(node.textContent || '')
    const href = String(node.getAttribute('href') || '').trim()
    if (!href) return text
    return `[${text || href}](${href})`
  }
  if (tag === 'img') {
    const alt = escapeInlineMarkdown(node.getAttribute('alt') || '')
    const src = String(node.getAttribute('src') || '').trim()
    return src ? `![${alt}](${src})` : alt
  }
  return renderInlineChildren(node.childNodes)
}

function renderInlineChildren(nodes: NodeListOf<ChildNode> | ChildNode[]): string {
  return Array.from(nodes)
    .map((node) => renderInlineNode(node))
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function indentLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
}

function renderBlockNode(node: Node): string {
  if (node.nodeType === node.TEXT_NODE) {
    const text = normalizeText(node.textContent || '').trim()
    return text ? `${text}\n\n` : ''
  }
  if (!isElementNode(node)) return ''

  const tag = node.tagName.toLowerCase()
  if (tag === 'pre') {
    const code = node.textContent || ''
    return `\`\`\`\n${code.replace(/\n+$/, '')}\n\`\`\`\n\n`
  }
  if (tag === 'p') {
    const text = renderInlineChildren(node.childNodes)
    return text ? `${text}\n\n` : ''
  }
  if (/^h[1-6]$/.test(tag)) {
    const level = Number.parseInt(tag[1] || '1', 10)
    const text = renderInlineChildren(node.childNodes)
    return `${'#'.repeat(Math.max(1, Math.min(6, level)))} ${text}\n\n`
  }
  if (tag === 'blockquote') {
    const body = renderChildren(node.childNodes).trim()
    return body ? `${indentLines(body, '> ')}\n\n` : ''
  }
  if (tag === 'ul' || tag === 'ol') {
    let index = 1
    const lines = Array.from(node.children)
      .filter((child) => child.tagName.toLowerCase() === 'li')
      .map((child) => {
        const body = renderChildren(child.childNodes).trim() || renderInlineChildren(child.childNodes)
        const marker = tag === 'ol' ? `${index++}. ` : '- '
        const [firstLine, ...rest] = body.split('\n')
        return `${marker}${firstLine}${rest.length > 0 ? `\n${indentLines(rest.join('\n'), '   ')}` : ''}`
      })
      .join('\n')
    return lines ? `${lines}\n\n` : ''
  }
  if (tag === 'hr') return '\n---\n\n'
  if (tag === 'details') {
    const summary = node.querySelector('summary')
    const summaryText = summary ? renderInlineChildren(summary.childNodes) : '详情'
    const content = Array.from(node.childNodes)
      .filter((child) => !(isElementNode(child) && child.tagName.toLowerCase() === 'summary'))
      .map((child) => renderBlockNode(child))
      .join('')
      .trim()
    const block = content ? `${content}\n` : ''
    return `> ${summaryText}\n>\n${indentLines(block || '>', '> ')}\n\n`
  }
  if (tag === 'table') {
    const text = normalizeText(node.textContent || '').trim()
    return text ? `${text}\n\n` : ''
  }
  return renderChildren(node.childNodes)
}

function renderChildren(nodes: NodeListOf<ChildNode> | ChildNode[]): string {
  return Array.from(nodes)
    .map((node) => renderBlockNode(node))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
}

function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild ?? doc.documentElement
  if (!root) return ''
  return renderChildren(root.childNodes).trim()
}

function topicSourceUrl(data: TopicData): string {
  return data.topic.url || `${data.topic.origin}/t/${data.topic.slug}/${data.topic.id}`
}

export function buildTopicExportJson(options: {
  data: TopicData
  exportedAt: string
  assetFailures?: ExportAssetFailure[]
}): TopicExportJson {
  const { data, exportedAt } = options
  return {
    version: 1,
    kind: 'topic',
    exportedAt,
    title: data.topic.title,
    sourceUrl: topicSourceUrl(data),
    topicId: data.topic.id,
    slug: data.topic.slug,
    origin: data.topic.origin,
    postCount: data.posts.length,
    assetFailures: options.assetFailures ?? [],
    posts: data.posts.map((post) => ({
      id: post.id,
      postNumber: post.postNumber,
      username: post.username,
      name: post.name,
      avatarUrl: post.avatarUrl,
      createdAt: post.createdAt,
      replyToPostNumber: post.replyToPostNumber,
      onlineUrl: post.onlineUrl ?? null,
      cookedHtml: post.cookedHtml,
    })),
  }
}

export function renderTopicMarkdown(options: {
  data: TopicData
  exportedAt: string
  assetFailures?: ExportAssetFailure[]
}): string {
  const { data, exportedAt } = options
  const lines: string[] = [
    `# ${data.topic.title}`,
    '',
    `- 导出时间：${formatLocalTime(exportedAt)}`,
    `- 原始链接：${topicSourceUrl(data)}`,
    `- 楼层数：${data.posts.length}`,
  ]
  if (options.assetFailures && options.assetFailures.length > 0) {
    lines.push(`- 资源内联失败：${options.assetFailures.length}`)
  }
  lines.push('')

  for (const post of data.posts) {
    const author = post.name || post.username
    lines.push(`## #${post.postNumber} · ${author}`)
    lines.push('')
    lines.push(`- 用户：@${post.username}`)
    lines.push(`- 时间：${formatLocalTime(post.createdAt)}`)
    if (post.replyToPostNumber != null) lines.push(`- 回复：#${post.replyToPostNumber}`)
    if (post.onlineUrl) lines.push(`- 在线：${post.onlineUrl}`)
    lines.push('')
    const content = htmlToMarkdown(post.cookedHtml)
    lines.push(content || '（无内容）')
    lines.push('')
  }

  if (options.assetFailures && options.assetFailures.length > 0) {
    lines.push('## 资源内联失败')
    lines.push('')
    for (const failure of options.assetFailures) {
      lines.push(`- ${failure.url}`)
      lines.push(`  - 原因：${failure.reason}`)
    }
    lines.push('')
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}

import type { DiscoursePost, DiscourseTopicJson } from '../../platform/discourse/api'
import type { NormalizedPost, TopicData } from './types'
import { cleanUrlParamU, hasUrlParamU } from '../../shared/url'

function absolutifyCookedHtml(html: string, origin: string): string {
  // Minimal + safe-enough: make root-relative URLs absolute for offline reading.
  const attrs = ['href', 'src', 'data-src', 'data-download-href']
  let out = html
  for (const attr of attrs) {
    out = out.replace(
      new RegExp(`\\b${attr}=\\"(\\/)(?!\\/)([^\\"]*)\\"`, 'g'),
      `${attr}="${origin}/$2"`
    )
  }
  return out
}

function sanitizeCookedHtmlUrlParams(html: string, origin: string): string {
  if (!hasUrlParamU(html)) return html
  const attrs = ['href', 'src', 'data-src', 'data-download-href']

  let out = html
  for (const attr of attrs) {
    out = out.replace(new RegExp(`\\b${attr}="([^"]+)"`, 'g'), (m, v: string) => {
      if (!v || !hasUrlParamU(v)) return m
      return `${attr}="${cleanUrlParamU(v, origin)}"`
    })
    out = out.replace(new RegExp(`\\b${attr}='([^']+)'`, 'g'), (m, v: string) => {
      if (!v || !hasUrlParamU(v)) return m
      return `${attr}='${cleanUrlParamU(v, origin)}'`
    })
  }

  return out
}

function buildAvatarUrl(
  avatarTemplate: string | null | undefined,
  origin: string,
  size: number
): string | null {
  const raw = String(avatarTemplate || '').trim()
  if (!raw) return null
  const replaced = raw.includes('{size}') ? raw.replace(/\{size\}/g, String(size)) : raw
  try {
    const abs = new URL(replaced, origin).toString()
    return hasUrlParamU(abs) ? cleanUrlParamU(abs, origin) : abs
  } catch {
    return null
  }
}

export function normalizeTopicData(options: {
  origin: string
  topicJson: DiscourseTopicJson
  posts: DiscoursePost[]
}): TopicData {
  const { origin, topicJson, posts } = options

  const avatarSize = 64
  const normalizedPosts: NormalizedPost[] = posts
    .map((p) => ({
      id: p.id,
      postNumber: p.post_number,
      username: p.username,
      name: p.name ?? null,
      avatarUrl: buildAvatarUrl(p.avatar_template, origin, avatarSize),
      createdAt: p.created_at,
      cookedHtml: sanitizeCookedHtmlUrlParams(absolutifyCookedHtml(p.cooked, origin), origin),
      replyToPostNumber: p.reply_to_post_number ?? null,
    }))
    .sort((a, b) => a.postNumber - b.postNumber)

  return {
    topic: {
      id: topicJson.id,
      title: topicJson.title,
      slug: topicJson.slug,
      origin,
    },
    posts: normalizedPosts,
  }
}

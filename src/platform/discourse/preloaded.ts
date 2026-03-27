import type { DiscourseTopicJson } from './api'

let htmlEntityDecoder: HTMLTextAreaElement | null = null

function decodeHtmlEntities(html: string): string {
  if (!htmlEntityDecoder) htmlEntityDecoder = document.createElement('textarea')
  htmlEntityDecoder.innerHTML = html
  return htmlEntityDecoder.value
}

function isTopicJsonLike(v: unknown): v is DiscourseTopicJson {
  if (!v || typeof v !== 'object') return false
  const obj = v as { id?: unknown; title?: unknown; slug?: unknown; post_stream?: unknown }
  if (typeof obj.id !== 'number') return false
  if (typeof obj.title !== 'string') return false
  if (typeof obj.slug !== 'string') return false
  if (!obj.post_stream || typeof obj.post_stream !== 'object') return false
  return true
}

export function tryGetTopicJsonFromDataPreloaded(topicId: number): DiscourseTopicJson | null {
  const el = document.getElementById('data-preloaded')
  if (!el) return null
  const raw = el.getAttribute('data-preloaded')
  if (!raw) return null

  // Discourse stores preloaded payload as HTML entities + JSON. topic_<id> is a JSON string.
  try {
    const decodedOuter = decodeHtmlEntities(raw)
    const outer = JSON.parse(decodedOuter) as Record<string, unknown>
    const topicKey = `topic_${topicId}`
    const topicStr = outer?.[topicKey]
    if (typeof topicStr !== 'string') return null
    const topic = JSON.parse(topicStr) as unknown
    return isTopicJsonLike(topic) ? topic : null
  } catch {
    return null
  }
}

import type { Taxonomy } from '../../platform/discourse/taxonomy'
import type { FilterConfig, Level, TopicMeta } from './rules'
import { shouldShowTopic } from './rules'
import { canonicalTagKey } from './tagTokens'

export type HomeSourceRequest =
  | {
      kind: 'category'
      key: string
      label: string
      url: string
      urls: string[]
      categoryId: number
    }
  | {
      kind: 'tag'
      key: string
      label: string
      url: string
      urls: string[]
      tagName: string
    }

export type HomeSourceTopic = {
  id: number
  slug: string
  title: string
  categoryId: number | null
  tags: string[]
  authorUsername: string | null
  createdAt: string | null
  bumpedAt: string | null
  likeCount: number
  replyCount: number
  views: number
  sourceKind: 'category' | 'tag'
  sourceKey: string
  sourceLabel: string
}

type TopicListUserJson = {
  id?: number
  username?: string
}

type TopicListTopicJson = {
  id?: number
  slug?: string
  title?: string
  unicode_title?: string
  fancy_title?: string
  category_id?: number
  tags?: Array<string | { name?: string }>
  posters?: Array<{ user_id?: number }>
  created_at?: string
  bumped_at?: string
  like_count?: number
  reply_count?: number
  views?: number
}

export type TopicListResponseJson = {
  users?: TopicListUserJson[]
  topic_list?: {
    topics?: TopicListTopicJson[]
    more_topics_url?: string | null
  }
}

function joinOrigin(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, '')}${path}`
}

function buildCategoryRequestUrls(options: {
  origin: string
  categoryId: number
  categorySlug: string | null
}): string[] {
  const { origin, categoryId } = options
  const categorySlug = String(options.categorySlug ?? '').trim()
  const urls = new Set<string>()

  if (categorySlug) {
    const slugPath = `/c/${encodeURIComponent(categorySlug)}/${categoryId}`
    urls.add(joinOrigin(origin, `${slugPath}/l/latest.json`))
    urls.add(joinOrigin(origin, `${slugPath}.json`))
  }

  const fallbackPath = `/c/${categoryId}`
  urls.add(joinOrigin(origin, `${fallbackPath}/l/latest.json`))
  urls.add(joinOrigin(origin, `${fallbackPath}.json`))

  return Array.from(urls)
}

function uniqFiniteNumbers(values: Iterable<number>): number[] {
  const out = new Set<number>()
  for (const raw of values) {
    const value = Number.parseInt(String(raw ?? ''), 10)
    if (!Number.isFinite(value) || value <= 0) continue
    out.add(value)
  }
  return Array.from(out).sort((a, b) => a - b)
}

function uniqTags(values: Iterable<string>): string[] {
  const out = new Map<string, string>()
  for (const raw of values) {
    const value = String(raw ?? '').trim()
    if (!value) continue
    const key = canonicalTagKey(value)
    if (!out.has(key)) out.set(key, value)
  }
  return Array.from(out.values())
}

function parseLevelFromCategoryNames(names: string[]): Level {
  const joined = names.join(' / ')
  if (/lv1/i.test(joined)) return 'lv1'
  if (/lv2/i.test(joined)) return 'lv2'
  if (/lv3/i.test(joined)) return 'lv3'
  return 'public'
}

function toComparableTime(raw: string | null): number {
  if (!raw) return 0
  const value = Date.parse(raw)
  return Number.isFinite(value) ? value : 0
}

function topicToMeta(topic: HomeSourceTopic, taxonomy: Taxonomy | null): TopicMeta {
  const category =
    topic.categoryId != null ? taxonomy?.categories.find((c) => c.id === topic.categoryId) : null
  const parent =
    category?.parent_category_id != null
      ? (taxonomy?.categories.find((c) => c.id === category.parent_category_id) ?? null)
      : null

  return {
    level: parseLevelFromCategoryNames(
      [parent?.name ?? '', category?.name ?? ''].map((part) => part.trim()).filter(Boolean)
    ),
    categoryId: topic.categoryId,
    parentCategoryId: parent?.id ?? category?.parent_category_id ?? null,
    tags: topic.tags,
    authorUsername: topic.authorUsername,
  }
}

function topicMatchesRequest(
  topic: HomeSourceTopic,
  request: HomeSourceRequest,
  taxonomy: Taxonomy | null
): boolean {
  if (request.kind === 'category') {
    if (topic.categoryId == null) return false
    if (topic.categoryId === request.categoryId) return true
    const category = taxonomy?.categories.find((entry) => entry.id === topic.categoryId) ?? null
    return category?.parent_category_id === request.categoryId
  }

  const requestedTag = canonicalTagKey(request.tagName)
  if (!requestedTag) return false
  return topic.tags.some((tag) => canonicalTagKey(tag) === requestedTag)
}

export function buildHomeSourceRequests(options: {
  origin: string
  taxonomy: Taxonomy | null
  categoryIds: number[]
  tagNames: string[]
}): HomeSourceRequest[] {
  const { origin, taxonomy } = options
  const categories = uniqFiniteNumbers(options.categoryIds)
  const tags = uniqTags(options.tagNames)
  const byCategoryId = new Map((taxonomy?.categories ?? []).map((c) => [c.id, c] as const))
  const requests: HomeSourceRequest[] = []

  for (const id of categories) {
    const category = byCategoryId.get(id)
    const label = category
      ? category.parent_category_id != null
        ? `${byCategoryId.get(category.parent_category_id)?.name ?? '上级分类'} / ${category.name}`
        : category.name
      : `分类 #${id}`
    const urls = buildCategoryRequestUrls({
      origin,
      categoryId: id,
      categorySlug: category?.slug ?? null,
    })
    const url = urls[0] ?? joinOrigin(origin, `/c/${id}/l/latest.json`)
    requests.push({
      kind: 'category',
      key: `category:${id}`,
      label,
      url,
      urls,
      categoryId: id,
    })
  }

  for (const tagName of tags) {
    const normalized = String(tagName ?? '').trim()
    if (!normalized) continue
    const url = `${origin}/tag/${encodeURIComponent(normalized)}.json`
    requests.push({
      kind: 'tag',
      key: `tag:${canonicalTagKey(normalized)}`,
      label: normalized,
      url,
      urls: [url],
      tagName: normalized,
    })
  }

  return requests
}

export function normalizeHomeSourceTopics(
  response: TopicListResponseJson,
  request: HomeSourceRequest
): HomeSourceTopic[] {
  const usersById = new Map<number, string>()
  for (const user of response.users ?? []) {
    const id = Number.parseInt(String(user.id ?? ''), 10)
    const username = String(user.username ?? '').trim()
    if (!Number.isFinite(id) || id <= 0 || !username) continue
    usersById.set(id, username)
  }

  const topics = response.topic_list?.topics ?? []
  const out: HomeSourceTopic[] = []
  for (const topic of topics) {
    const id = Number.parseInt(String(topic.id ?? ''), 10)
    if (!Number.isFinite(id) || id <= 0) continue
    const title = String(topic.unicode_title ?? topic.title ?? topic.fancy_title ?? '').trim()
    if (!title) continue
    const slug = String(topic.slug ?? 'topic').trim() || 'topic'
    const categoryIdRaw =
      topic.category_id != null ? Number.parseInt(String(topic.category_id), 10) : Number.NaN
    const categoryId = Number.isFinite(categoryIdRaw) ? categoryIdRaw : null
    const tags = uniqTags(
      (topic.tags ?? [])
        .map((tag) => (typeof tag === 'string' ? tag : String(tag?.name ?? '').trim()))
        .filter(Boolean)
    )
    const firstPosterId = Number.parseInt(String(topic.posters?.[0]?.user_id ?? ''), 10)
    const authorUsername =
      Number.isFinite(firstPosterId) && firstPosterId > 0
        ? (usersById.get(firstPosterId) ?? null)
        : null

    out.push({
      id,
      slug,
      title,
      categoryId,
      tags,
      authorUsername,
      createdAt: String(topic.created_at ?? '').trim() || null,
      bumpedAt: String(topic.bumped_at ?? '').trim() || null,
      likeCount: Number.parseInt(String(topic.like_count ?? 0), 10) || 0,
      replyCount: Number.parseInt(String(topic.reply_count ?? 0), 10) || 0,
      views: Number.parseInt(String(topic.views ?? 0), 10) || 0,
      sourceKind: request.kind,
      sourceKey: request.key,
      sourceLabel: request.label,
    })
  }

  return out
}

export function filterHomeSourceTopicsByRequest(options: {
  topics: HomeSourceTopic[]
  request: HomeSourceRequest
  taxonomy: Taxonomy | null
}): HomeSourceTopic[] {
  return options.topics.filter((topic) =>
    topicMatchesRequest(topic, options.request, options.taxonomy)
  )
}

export function selectHomeSourceTopics(options: {
  topics: HomeSourceTopic[]
  existingTopicIds: Iterable<number>
  cfg: FilterConfig
  taxonomy: Taxonomy | null
  limit?: number
}): HomeSourceTopic[] {
  const { cfg, taxonomy } = options
  const seen = new Set<number>()
  for (const id of options.existingTopicIds) {
    const topicId = Number.parseInt(String(id ?? ''), 10)
    if (!Number.isFinite(topicId) || topicId <= 0) continue
    seen.add(topicId)
  }

  const sorted = [...options.topics].sort((a, b) => {
    const diff =
      toComparableTime(b.bumpedAt || b.createdAt) - toComparableTime(a.bumpedAt || a.createdAt)
    if (diff !== 0) return diff
    return b.id - a.id
  })

  const limit =
    Number.isFinite(options.limit) && (options.limit ?? 0) > 0 ? Math.floor(options.limit ?? 0) : 24
  const out: HomeSourceTopic[] = []
  for (const topic of sorted) {
    if (seen.has(topic.id)) continue
    if (!shouldShowTopic(topicToMeta(topic, taxonomy), cfg)) continue
    seen.add(topic.id)
    out.push(topic)
    if (out.length >= limit) break
  }
  return out
}

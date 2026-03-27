import type { StorageService } from '../../app/types'

export type DiscourseCategory = {
  id: number
  name: string
  slug?: string
  parent_category_id?: number | null
}

export type DiscourseTag = {
  id?: number
  name: string
  count?: number
}

export type Taxonomy = {
  version: number
  updatedAt: number
  categories: DiscourseCategory[]
  tags: DiscourseTag[]
}

const TAXONOMY_VERSION = 1
const KEY_CATEGORIES = 'taxonomy.categories'
const KEY_TAGS = 'taxonomy.tags'
const KEY_UPDATED_AT = 'taxonomy.updatedAt'
const KEY_VERSION = 'taxonomy.version'

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, credentials: 'include' })
  if (!res.ok) throw new Error(`http ${res.status}`)
  return (await res.json()) as T
}

function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseTags(
  json:
    | { tags?: Array<{ id?: number; name?: string; text?: string; count?: number }> }
    | null
    | undefined
): DiscourseTag[] {
  return (
    json?.tags
      ?.map((t) => ({
        id: t.id,
        name: String(t.name ?? t.text ?? '').trim(),
        count: t.count,
      }))
      ?.filter((t) => t.name) ?? []
  )
}

async function fetchAllTags(options: {
  origin: string
  signal: AbortSignal
}): Promise<DiscourseTag[]> {
  const { origin, signal } = options
  const out = new Map<string, DiscourseTag>()

  // Discourse may paginate tags via `?page=` (or ignore it). We stop when no new tags appear.
  const MAX_PAGES = 10
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = page === 1 ? `${origin}/tags.json` : `${origin}/tags.json?page=${page}`
    const json = await fetchJson<{
      tags?: Array<{ id?: number; name?: string; text?: string; count?: number }>
    }>(url, signal)

    const tags = parseTags(json)
    let added = 0
    for (const t of tags) {
      const k = t.name.toLowerCase()
      if (out.has(k)) continue
      out.set(k, t)
      added += 1
    }

    if (tags.length === 0 || added === 0) break
    await sleep(120)
  }

  return Array.from(out.values())
}

export async function refreshTaxonomy(options: {
  storage: StorageService
  origin: string
  signal: AbortSignal
}): Promise<Taxonomy> {
  const { storage, origin, signal } = options

  const [categoriesJson, tags] = await Promise.all([
    fetchJson<{ category_list?: { categories?: DiscourseCategory[] } }>(
      `${origin}/categories.json`,
      signal
    ),
    fetchAllTags({ origin, signal }),
  ])

  const categories = categoriesJson.category_list?.categories ?? []

  const updatedAt = Date.now()
  const taxonomy: Taxonomy = { version: TAXONOMY_VERSION, updatedAt, categories, tags }

  storage.set(KEY_VERSION, taxonomy.version)
  storage.set(KEY_UPDATED_AT, taxonomy.updatedAt)
  storage.set(KEY_CATEGORIES, taxonomy.categories)
  storage.set(KEY_TAGS, taxonomy.tags)

  return taxonomy
}

export function loadCachedTaxonomy(storage: StorageService): Taxonomy | null {
  const version = storage.get<number>(KEY_VERSION, 0)
  if (version !== TAXONOMY_VERSION) return null
  const updatedAt = storage.get<number>(KEY_UPDATED_AT, 0)
  const categories = storage.get<DiscourseCategory[]>(KEY_CATEGORIES, [])
  const tags = storage.get<DiscourseTag[]>(KEY_TAGS, [])
  if (!Array.isArray(categories) || !Array.isArray(tags)) return null
  return { version: TAXONOMY_VERSION, updatedAt, categories, tags }
}

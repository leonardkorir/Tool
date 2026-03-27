export type Level = 'public' | 'lv1' | 'lv2' | 'lv3'
export type FilterMode = 'strict' | 'loose'

export type FilterConfig = {
  enabled: boolean
  mode: FilterMode
  levels: Level[]
  categoriesInclude: number[]
  categoriesExclude: number[]
  tagsInclude: string[]
  tagsExclude: string[]
  blockedUsers: string[]
  showBlockedPostsInTopic: boolean
  autoLoadMore: boolean
}

export type TopicMeta = {
  level: Level
  categoryId: number | null
  parentCategoryId: number | null
  tags: string[]
  authorUsername: string | null
}

function toSet<T>(values: T[]): Set<T> {
  return new Set(values)
}

function intersects<T>(a: T[], b: Set<T>): boolean {
  for (const x of a) if (b.has(x)) return true
  return false
}

function isNoTagToken(tag: string): boolean {
  const t = tag.trim().toLowerCase()
  return t === '无标签' || t === 'no_tag' || t === '__no_tag__'
}

export function shouldShowTopic(meta: TopicMeta, cfg: FilterConfig): boolean {
  const blockedUsers = toSet(cfg.blockedUsers.map((u) => u.trim().toLowerCase()).filter(Boolean))
  const authorUsername = meta.authorUsername?.trim().toLowerCase() ?? ''
  if (authorUsername && blockedUsers.has(authorUsername)) return false

  if (!cfg.enabled) return true

  const allowedLevels = toSet(cfg.levels)
  if (!allowedLevels.has(meta.level)) return false

  const catsEx = toSet(cfg.categoriesExclude)
  // v1 parity: treat parent category as the topic's category as well.
  const catCandidates = [meta.categoryId, meta.parentCategoryId].filter(
    (n): n is number => n != null
  )
  if (catCandidates.some((n) => catsEx.has(n))) return false

  const tagsLower = meta.tags.map((t) => t.toLowerCase())
  const noTags = meta.tags.length === 0
  const tagsExTokens = cfg.tagsExclude.map((t) => t.toLowerCase())
  const excludeNoTags = tagsExTokens.some(isNoTagToken)
  const tagsEx = toSet(tagsExTokens.filter((t) => !isNoTagToken(t)))
  if ((excludeNoTags && noTags) || intersects(tagsLower, tagsEx)) return false

  const catsInc = toSet(cfg.categoriesInclude)
  const tagsIncTokens = cfg.tagsInclude.map((t) => t.toLowerCase())
  const includeNoTags = tagsIncTokens.some(isNoTagToken)
  const tagsInc = toSet(tagsIncTokens.filter((t) => !isNoTagToken(t)))
  const hasCatInc = catsInc.size > 0
  const hasTagInc = tagsInc.size > 0 || includeNoTags

  if (!hasCatInc && !hasTagInc) return true

  const catOk = catCandidates.some((n) => catsInc.has(n))
  const tagOk = intersects(tagsLower, tagsInc) || (includeNoTags && noTags)

  if (cfg.mode === 'strict') {
    if (hasCatInc && !catOk) return false
    if (hasTagInc && !tagOk) return false
    return true
  }

  // loose: any include dimension matches.
  return (hasCatInc && catOk) || (hasTagInc && tagOk)
}

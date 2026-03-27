import type { AppContext, Feature } from '../../app/types'
import { combineDisposables, toDisposable } from '../../shared/disposable'
import { createButton, createCheckbox, createSelect, createTextInput } from '../ui/dom'
import {
  AUTO_READ_START_EVENT,
  AUTO_READ_STOP_EVENT,
  AUTO_READ_TOGGLE_EVENT,
  FILTER_BLOCK_TOPIC_AUTHOR_EVENT,
  UI_REFRESH_EVENT,
  emitUiRefresh,
} from '../ui/events'
import { loadCachedTaxonomy, refreshTaxonomy } from '../../platform/discourse/taxonomy'
import { tryGetTopicJsonFromDataPreloaded } from '../../platform/discourse/preloaded'
import type { FilterConfig, FilterMode, Level, TopicMeta } from './rules'
import { shouldShowTopic } from './rules'

const FEATURE_ID = 'ld2-filter'
const TAXONOMY_TTL_MS = 24 * 60 * 60 * 1000

const KEY_ENABLED = 'filter.enabled'
const KEY_MODE = 'filter.mode'
const KEY_LEVELS = 'filter.levels'
const KEY_CATS_INC = 'filter.categoriesInclude'
const KEY_CATS_EX = 'filter.categoriesExclude'
const KEY_TAGS_INC = 'filter.tagsInclude'
const KEY_TAGS_EX = 'filter.tagsExclude'
const KEY_CUSTOM_CATS = 'filter.customCategories'
const KEY_CUSTOM_TAGS = 'filter.customTags'
const KEY_BLOCKED_USERS = 'filter.blockedUsers'
const KEY_SHOW_BLOCKED_POSTS = 'filter.showBlockedPostsInTopic'
const KEY_AUTO_LOAD = 'filter.autoLoadMore'
const BLOCKED_POST_REVEAL_MS = 2 * 60_000

type TriState = 'neutral' | 'include' | 'exclude'

function uniqFiniteNumbers(values: number[]): number[] {
  const out = new Set<number>()
  for (const raw of values) {
    const value = Number.parseInt(String(raw ?? ''), 10)
    if (!Number.isFinite(value) || value <= 0) continue
    out.add(value)
  }
  return Array.from(out).sort((a, b) => a - b)
}

function uniqCaseInsensitive(values: string[]): string[] {
  const m = new Map<string, string>()
  for (const raw of values) {
    const v = String(raw ?? '').trim()
    if (!v) continue
    const k = v.toLowerCase()
    if (!m.has(k)) m.set(k, v)
  }
  return Array.from(m.values())
}

function normalizeUsername(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
}

function parseUsernameFromHref(rawHref: string): string | null {
  const href = String(rawHref || '').trim()
  if (!href) return null
  try {
    const url = new URL(href, window.location.origin)
    const match = url.pathname.match(/^\/u\/([^/]+)(?:\/|$)/)
    if (!match?.[1]) return null
    return decodeURIComponent(match[1]).trim() || null
  } catch {
    return null
  }
}

function normalizeBlockedUserInput(raw: string): string | null {
  const value = String(raw || '').trim()
  if (!value) return null
  const fromHref = parseUsernameFromHref(value)
  if (fromHref) return fromHref
  const normalized = value.replace(/^@+/, '').trim()
  return normalized || null
}

function toBlockedUserSet(users: string[]): Set<string> {
  return new Set(users.map((u) => normalizeUsername(u)).filter(Boolean))
}

function isNoTagToken(raw: string): boolean {
  const value = String(raw ?? '').trim().toLowerCase()
  return value === '无标签' || value === 'no_tag' || value === '__no_tag__'
}

function canonicalTagKey(raw: string): string {
  const value = String(raw ?? '').trim()
  if (!value) return ''
  return (isNoTagToken(value) ? '无标签' : value).trim().toLowerCase()
}

function canonicalTagName(raw: string): string {
  const value = String(raw ?? '').trim()
  if (!value) return ''
  return (isNoTagToken(value) ? '无标签' : value).trim()
}

function getListContainer(): HTMLElement | null {
  // Discourse main content is under #main-outlet. Scoping avoids accidentally picking up stale/hidden lists.
  const root = document.querySelector<HTMLElement>('#main-outlet') ?? document
  const tbody = root.querySelector<HTMLElement>('table.topic-list tbody')
  if (tbody) return tbody
  const body = root.querySelector<HTMLElement>('.topic-list-body')
  if (body) return body
  const list = root.querySelector<HTMLElement>('.topic-list')
  if (list) return list
  return null
}

function getTopicItems(container?: ParentNode | null): HTMLElement[] {
  const root = container ?? document
  return Array.from(root.querySelectorAll<HTMLElement>('.topic-list-item'))
}

function getTopicItemFromNode(node: Node | null): HTMLElement | null {
  if (!node) return null
  if (node instanceof HTMLElement) {
    if (node.classList.contains('topic-list-item')) return node
    return node.closest<HTMLElement>('.topic-list-item')
  }
  if (node instanceof Text) return node.parentElement?.closest<HTMLElement>('.topic-list-item') ?? null
  return null
}

function collectTopicItemsFromNode(node: Node, out: Set<HTMLElement>): void {
  if (node instanceof HTMLElement) {
    if (node.classList.contains('topic-list-item')) {
      out.add(node)
      return
    }
    for (const el of Array.from(node.querySelectorAll<HTMLElement>('.topic-list-item'))) out.add(el)
    return
  }
  const item = getTopicItemFromNode(node)
  if (item) out.add(item)
}

function getText(el: Element | null): string {
  return el?.textContent?.trim() ?? ''
}

function isUserPage(pathname: string): boolean {
  return /^\/u\//.test(pathname)
}

function parseLevelFromElement(el: HTMLElement): Level {
  const cls = el.className || ''
  const m = cls.match(/lv(\d)/i)
  if (m?.[1] === '1') return 'lv1'
  if (m?.[1] === '2') return 'lv2'
  if (m?.[1] === '3') return 'lv3'

  const catText = getText(el.querySelector('.topic-category, .category, .badge-category__wrapper'))
  if (/lv1/i.test(catText)) return 'lv1'
  if (/lv2/i.test(catText)) return 'lv2'
  if (/lv3/i.test(catText)) return 'lv3'
  return 'public'
}

function parseCategoryIdFromElement(el: HTMLElement): number | null {
  const badge = el.querySelector<HTMLElement>('[data-category-id]')
  const id = badge?.getAttribute('data-category-id')
  if (!id) return null
  const n = Number.parseInt(id, 10)
  return Number.isFinite(n) ? n : null
}

function parseParentCategoryIdFromElement(el: HTMLElement): number | null {
  const badge = el.querySelector<HTMLElement>('[data-parent-category-id]')
  const id = badge?.getAttribute('data-parent-category-id')
  if (!id) return null
  const n = Number.parseInt(id, 10)
  return Number.isFinite(n) ? n : null
}

function parseTagsFromElement(el: HTMLElement): string[] {
  const out = new Set<string>()

  // v1-compatible: Discourse topic rows usually carry `tag-xxx` classes.
  for (const cls of Array.from(el.classList)) {
    if (!cls.startsWith('tag-')) continue
    const encoded = cls.slice('tag-'.length)
    if (!encoded) continue
    let decoded = encoded
    try {
      decoded = decodeURIComponent(encoded)
    } catch {
      // ignore decode errors
    }
    const t = decoded.trim()
    if (t) out.add(t)
  }

  // Fallback: some views render actual tag links.
  for (const a of Array.from(el.querySelectorAll<HTMLElement>('a.discourse-tag'))) {
    const t = (a.getAttribute('data-tag-name') || a.textContent || '').trim()
    if (t) out.add(t)
  }

  return Array.from(out)
}

function parseTopicAuthorFromElement(el: HTMLElement): string | null {
  const postersLink = el.querySelector<HTMLAnchorElement>(
    'td.posters a[href*="/u/"], .posters a[href*="/u/"]'
  )
  const fromPosters = postersLink
    ? parseUsernameFromHref(postersLink.getAttribute('href') || postersLink.href)
    : null
  if (fromPosters) return fromPosters

  const fallbackLink = el.querySelector<HTMLAnchorElement>(
    'a[href*="/u/"][data-user-card], .topic-list-data a[href*="/u/"]'
  )
  return fallbackLink
    ? parseUsernameFromHref(fallbackLink.getAttribute('href') || fallbackLink.href)
    : null
}

function getTopicStreamContainer(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('div.post-stream') ??
    document.querySelector<HTMLElement>('#post-stream') ??
    null
  )
}

function getTopicPostItems(root?: ParentNode | null): HTMLElement[] {
  const base = root ?? document
  return Array.from(
    base.querySelectorAll<HTMLElement>('.topic-post[data-post-number], article[data-post-number]')
  )
}

function getTopicPostArticle(el: HTMLElement): HTMLElement | null {
  return el.tagName === 'ARTICLE' ? el : el.querySelector<HTMLElement>('article[data-post-id]')
}

function parseTopicPostUsername(article: ParentNode): string | null {
  const byUserCard = article
    .querySelector<HTMLElement>('a[data-user-card]')
    ?.getAttribute('data-user-card')
    ?.trim()
  if (byUserCard) return byUserCard

  const userLink = article.querySelector<HTMLAnchorElement>(
    '.names a[href*="/u/"], .topic-meta-data a[href*="/u/"]'
  )
  const fromHref = userLink
    ? parseUsernameFromHref(userLink.getAttribute('href') || userLink.href)
    : null
  if (fromHref) return fromHref

  const byText = article
    .querySelector<HTMLElement>('.names .username, .topic-meta-data .username')
    ?.textContent?.trim()
  return byText || null
}

function getTopicOriginalPosterUsername(topicId: number): string | null {
  const preloaded = tryGetTopicJsonFromDataPreloaded(topicId)
  const byPreloaded = preloaded?.post_stream?.posts
    ?.find((p) => p.post_number === 1)
    ?.username?.trim()
  if (byPreloaded) return byPreloaded

  const post1 = document.querySelector<HTMLElement>(
    'article[data-post-number="1"], .topic-post[data-post-number="1"]'
  )
  if (!post1) return null
  const article = getTopicPostArticle(post1)
  return article ? parseTopicPostUsername(article) : null
}

function getBlockedPostPlaceholder(article: HTMLElement): HTMLElement | null {
  const prev = article.previousElementSibling
  return prev instanceof HTMLElement && prev.classList.contains('ld2-blocked-post-placeholder')
    ? prev
    : null
}

function getBlockedPostHideTarget(item: HTMLElement, article: HTMLElement): HTMLElement {
  // Keep the wrapper visible so the placeholder inserted before the article can stay on screen.
  return item.tagName === 'ARTICLE' ? item : article
}

function markBlockedPostTemporarilyRevealed(item: HTMLElement): void {
  item.dataset.ld2BlockedPostRevealUntil = String(Date.now() + BLOCKED_POST_REVEAL_MS)
}

function clearBlockedPostTemporaryReveal(item: HTMLElement): void {
  if (item.dataset.ld2BlockedPostRevealUntil) delete item.dataset.ld2BlockedPostRevealUntil
}

function isBlockedPostTemporarilyRevealed(item: HTMLElement): boolean {
  const raw = item.dataset.ld2BlockedPostRevealUntil || ''
  const revealUntil = Number.parseInt(raw, 10)
  if (!Number.isFinite(revealUntil) || revealUntil <= Date.now()) {
    clearBlockedPostTemporaryReveal(item)
    return false
  }
  return true
}

function extractTopicMeta(el: HTMLElement): TopicMeta {
  return {
    level: parseLevelFromElement(el),
    categoryId: parseCategoryIdFromElement(el),
    parentCategoryId: parseParentCategoryIdFromElement(el),
    tags: parseTagsFromElement(el),
    authorUsername: parseTopicAuthorFromElement(el),
  }
}

function isListPage(pathname: string): boolean {
  return !isUserPage(pathname) && !pathname.startsWith('/t/')
}

function isCategoryOrTagScopedPage(pathname: string): boolean {
  return (
    /^\/c(?:\/|$)/.test(pathname) ||
    /^\/tag(?:\/|$)/.test(pathname) ||
    /^\/tags(?:\/|$)/.test(pathname)
  )
}

function getEffectiveListFilterConfig(cfg: FilterConfig, pathname: string): FilterConfig {
  if (!isCategoryOrTagScopedPage(pathname)) return cfg
  return {
    ...cfg,
    categoriesInclude: [],
    categoriesExclude: [],
    tagsInclude: [],
    tagsExclude: [],
  }
}

export function filterFeature(): Feature {
  return {
    id: FEATURE_ID,
    mount(ctx: AppContext) {
      const statusEl = document.getElementById('ld2-filter-status')
      const controls = document.getElementById('ld2-filter-controls')
      if (!statusEl || !controls) {
        ctx.logger.warn('filter ui missing')
        return
      }
      const status = statusEl

      const enabledInput = createCheckbox()
      const enabledLabel = document.createElement('label')
      enabledLabel.style.display = 'flex'
      enabledLabel.style.alignItems = 'center'
      enabledLabel.style.gap = '8px'
      enabledLabel.appendChild(enabledInput)
      enabledLabel.appendChild(document.createTextNode('启用筛选'))

      const modeSelect = createSelect([])
      modeSelect.innerHTML = ''
      for (const [value, label] of [
        ['strict', 'AND（包含：分类+标签都命中）'],
        ['loose', 'OR（包含：分类/标签命中其一）'],
      ] as const) {
        const opt = document.createElement('option')
        opt.value = value
        opt.textContent = label
        modeSelect.appendChild(opt)
      }

      const levelsWrap = document.createElement('div')
      levelsWrap.style.display = 'flex'
      levelsWrap.style.flexWrap = 'wrap'
      levelsWrap.style.gap = '10px'
      const levelInputs: Record<Level, HTMLInputElement> = {
        public: document.createElement('input'),
        lv1: document.createElement('input'),
        lv2: document.createElement('input'),
        lv3: document.createElement('input'),
      }
      for (const [lv, label] of [
        ['public', 'Lv0'],
        ['lv1', 'Lv1'],
        ['lv2', 'Lv2'],
        ['lv3', 'Lv3'],
      ] as const) {
        const cb = levelInputs[lv]
        cb.type = 'checkbox'
        const l = document.createElement('label')
        l.className = 'ld2-check-row'
        l.style.display = 'flex'
        l.style.alignItems = 'center'
        l.style.gap = '6px'
        l.appendChild(cb)
        l.appendChild(document.createTextNode(label))
        levelsWrap.appendChild(l)
      }

      const catsDetails = document.createElement('details')
      catsDetails.open = false
      const catsSummary = document.createElement('summary')
      catsSummary.textContent = '分类（包含/排除）'
      catsDetails.appendChild(catsSummary)
      const catsSearch = document.createElement('input')
      catsSearch.type = 'text'
      catsSearch.placeholder = '搜索分类（名称或编号）'
      catsSearch.style.marginTop = '8px'
      const catsList = document.createElement('div')
      catsList.style.marginTop = '8px'
      catsDetails.appendChild(catsSearch)
      catsDetails.appendChild(catsList)

      const tagsDetails = document.createElement('details')
      tagsDetails.open = false
      const tagsSummary = document.createElement('summary')
      tagsSummary.textContent = '标签（包含/排除）'
      tagsDetails.appendChild(tagsSummary)
      const tagsSearch = document.createElement('input')
      tagsSearch.type = 'text'
      tagsSearch.placeholder = '搜索标签（支持“无标签”，也可输入自定义标签）'
      tagsSearch.style.marginTop = '8px'
      const tagsList = document.createElement('div')
      tagsList.style.marginTop = '8px'
      tagsDetails.appendChild(tagsSearch)
      tagsDetails.appendChild(tagsList)

      const blockedDetails = document.createElement('details')
      blockedDetails.open = false
      const blockedSummary = document.createElement('summary')
      blockedSummary.textContent = '屏蔽用户（0）'
      blockedDetails.appendChild(blockedSummary)
      const blockedHelp = document.createElement('div')
      blockedHelp.className = 'ld2-inline-help ld2-muted'
      blockedHelp.style.marginTop = '8px'
      blockedHelp.textContent =
        '仅影响主题列表与帖子内回帖显示；直接打开主题、导出、查看用户资料不受影响。'
      const blockedInputRow = document.createElement('div')
      blockedInputRow.className = 'stack'
      blockedInputRow.style.marginTop = '8px'
      const blockedInput = createTextInput({ placeholder: '输入用户名、@用户名或个人主页链接' })
      blockedInput.setAttribute('aria-label', '添加要屏蔽的用户')
      blockedInput.style.flex = '1 1 220px'
      const blockedAddBtn = createButton({ text: '添加', className: 'btn' })
      blockedInputRow.appendChild(blockedInput)
      blockedInputRow.appendChild(blockedAddBtn)
      const blockedList = document.createElement('div')
      blockedList.style.marginTop = '8px'
      const showBlockedPostsLabel = document.createElement('label')
      showBlockedPostsLabel.className = 'ld2-check-row ld2-check-row-spacious'
      showBlockedPostsLabel.style.display = 'flex'
      showBlockedPostsLabel.style.alignItems = 'center'
      showBlockedPostsLabel.style.gap = '8px'
      showBlockedPostsLabel.style.marginTop = '8px'
      const showBlockedPostsInput = createCheckbox()
      showBlockedPostsLabel.appendChild(showBlockedPostsInput)
      showBlockedPostsLabel.appendChild(document.createTextNode('在帖子中显示已屏蔽用户的发言'))
      blockedDetails.appendChild(blockedHelp)
      blockedDetails.appendChild(blockedInputRow)
      blockedDetails.appendChild(blockedList)
      blockedDetails.appendChild(showBlockedPostsLabel)

      const refreshBtn = createButton({ text: '刷新分类/标签', className: 'btn' })

      const clearBtn = createButton({ text: '清空筛选条件', className: 'btn danger' })

      const autoLoadLabel = document.createElement('label')
      autoLoadLabel.className = 'ld2-check-row'
      autoLoadLabel.style.display = 'flex'
      autoLoadLabel.style.alignItems = 'center'
      autoLoadLabel.style.gap = '8px'
      const autoLoadInput = createCheckbox()
      autoLoadLabel.appendChild(autoLoadInput)
      autoLoadLabel.appendChild(document.createTextNode('自动加载更多（谨慎）'))

      const activeSummaryCard = document.createElement('div')
      activeSummaryCard.className = 'ld2-summary-card'
      const activeSummaryTitle = document.createElement('div')
      activeSummaryTitle.className = 'ld2-section-title'
      activeSummaryTitle.textContent = '当前生效条件'
      const activeSummaryStats = document.createElement('div')
      activeSummaryStats.className = 'ld2-compact-list'
      const activeSummaryActions = document.createElement('div')
      activeSummaryActions.className = 'ld2-summary-actions ld2-filter-summary-actions'
      const quickBlockAuthorBtn = createButton({
        text: '屏蔽当前楼主',
        className: 'btn primary ld2-block-author-btn ld2-pill-action-btn',
      })
      activeSummaryActions.appendChild(quickBlockAuthorBtn)
      activeSummaryCard.appendChild(activeSummaryTitle)
      activeSummaryCard.appendChild(activeSummaryStats)
      activeSummaryCard.appendChild(activeSummaryActions)

      controls.appendChild(activeSummaryCard)
      controls.appendChild(enabledLabel)
      controls.appendChild(modeSelect)
      controls.appendChild(levelsWrap)
      controls.appendChild(catsDetails)
      controls.appendChild(tagsDetails)
      controls.appendChild(blockedDetails)
      controls.appendChild(autoLoadLabel)
      const miscRow = document.createElement('div')
      miscRow.className = 'stack'
      miscRow.appendChild(refreshBtn)
      miscRow.appendChild(clearBtn)
      controls.appendChild(miscRow)

      const setControlsDisabled = (disabled: boolean) => {
        enabledInput.disabled = disabled
        modeSelect.disabled = disabled
        autoLoadInput.disabled = disabled
        catsSearch.disabled = disabled
        tagsSearch.disabled = disabled
        blockedInput.disabled = disabled
        blockedAddBtn.disabled = disabled
        showBlockedPostsInput.disabled = disabled
        refreshBtn.disabled = disabled
        clearBtn.disabled = disabled
        for (const lv of ['public', 'lv1', 'lv2', 'lv3'] as const) {
          levelInputs[lv].disabled = disabled
        }
      }

      function readConfig(): FilterConfig {
        const enabled = ctx.storage.get(KEY_ENABLED, false)
        const mode =
          (ctx.storage.get(KEY_MODE, 'strict') as FilterMode) === 'loose' ? 'loose' : 'strict'
        const levels = ctx.storage.get(KEY_LEVELS, ['public', 'lv1', 'lv2', 'lv3'] as Level[])
        const categoriesInclude = ctx.storage.get(KEY_CATS_INC, [] as number[])
        const categoriesExclude = ctx.storage.get(KEY_CATS_EX, [] as number[])
        const tagsInclude = ctx.storage.get(KEY_TAGS_INC, [] as string[])
        const tagsExclude = ctx.storage.get(KEY_TAGS_EX, [] as string[])
        const blockedUsers = ctx.storage.get(KEY_BLOCKED_USERS, [] as string[])
        const showBlockedPostsInTopic = ctx.storage.get(KEY_SHOW_BLOCKED_POSTS, false)
        const autoLoadMore = ctx.storage.get(KEY_AUTO_LOAD, false)

        return {
          enabled: !!enabled,
          mode,
          levels: Array.isArray(levels)
            ? (levels as Level[])
            : (['public', 'lv1', 'lv2', 'lv3'] as Level[]),
          categoriesInclude: Array.isArray(categoriesInclude)
            ? categoriesInclude.filter((n) => Number.isFinite(n))
            : [],
          categoriesExclude: Array.isArray(categoriesExclude)
            ? categoriesExclude.filter((n) => Number.isFinite(n))
            : [],
          tagsInclude: Array.isArray(tagsInclude) ? uniqCaseInsensitive(tagsInclude) : [],
          tagsExclude: Array.isArray(tagsExclude) ? uniqCaseInsensitive(tagsExclude) : [],
          blockedUsers: Array.isArray(blockedUsers)
            ? uniqCaseInsensitive(
                blockedUsers.map((u) => normalizeBlockedUserInput(String(u) || '') || '')
              )
            : [],
          showBlockedPostsInTopic: !!showBlockedPostsInTopic,
          autoLoadMore: !!autoLoadMore,
        }
      }

      function writeConfig(cfg: FilterConfig): void {
        ctx.storage.set(KEY_ENABLED, cfg.enabled)
        ctx.storage.set(KEY_MODE, cfg.mode)
        ctx.storage.set(KEY_LEVELS, cfg.levels)
        ctx.storage.set(KEY_CATS_INC, cfg.categoriesInclude)
        ctx.storage.set(KEY_CATS_EX, cfg.categoriesExclude)
        ctx.storage.set(KEY_TAGS_INC, cfg.tagsInclude)
        ctx.storage.set(KEY_TAGS_EX, cfg.tagsExclude)
        ctx.storage.set(KEY_BLOCKED_USERS, cfg.blockedUsers)
        ctx.storage.set(KEY_SHOW_BLOCKED_POSTS, cfg.showBlockedPostsInTopic)
        ctx.storage.set(KEY_AUTO_LOAD, cfg.autoLoadMore)
        emitUiRefresh()
      }

      function readCustomCategoryIds(): number[] {
        const raw = ctx.storage.get(KEY_CUSTOM_CATS, [] as number[])
        return Array.isArray(raw) ? uniqFiniteNumbers(raw) : []
      }

      function readCustomTagNames(): string[] {
        const raw = ctx.storage.get(KEY_CUSTOM_TAGS, [] as string[])
        return Array.isArray(raw) ? uniqCaseInsensitive(raw) : []
      }

      function rememberCustomCategoryIds(ids: Iterable<number>): void {
        const next = new Set(readCustomCategoryIds())
        let changed = false
        for (const raw of ids) {
          const id = Number.parseInt(String(raw ?? ''), 10)
          if (!Number.isFinite(id) || id <= 0) continue
          if (next.has(id)) continue
          next.add(id)
          changed = true
        }
        if (!changed) return
        ctx.storage.set(KEY_CUSTOM_CATS, uniqFiniteNumbers(Array.from(next)))
      }

      function rememberCustomTagNames(tags: Iterable<string>): void {
        const next = new Map(readCustomTagNames().map((tag) => [canonicalTagKey(tag), tag] as const))
        let changed = false
        for (const raw of tags) {
          const key = canonicalTagKey(raw)
          const name = canonicalTagName(raw)
          if (!key || !name || isNoTagToken(name)) continue
          if (next.has(key)) continue
          next.set(key, name)
          changed = true
        }
        if (!changed) return
        ctx.storage.set(KEY_CUSTOM_TAGS, Array.from(next.values()))
      }

      function seedCustomEntriesFromConfig(cfg: FilterConfig): void {
        const taxonomy = loadCachedTaxonomy(ctx.storage)
        if (!taxonomy) return

        const knownCategoryIds = new Set(taxonomy.categories.map((c) => c.id))
        const missingCategoryIds = [...cfg.categoriesInclude, ...cfg.categoriesExclude].filter(
          (id) => !knownCategoryIds.has(id)
        )
        if (missingCategoryIds.length > 0) rememberCustomCategoryIds(missingCategoryIds)

        const knownTagKeys = new Set(
          taxonomy.tags.map((tag) => canonicalTagKey(String(tag.name ?? ''))).filter(Boolean)
        )
        const missingTagNames = [...cfg.tagsInclude, ...cfg.tagsExclude]
          .map((tag) => canonicalTagName(tag))
          .filter((tag) => {
            const key = canonicalTagKey(tag)
            return !!key && !isNoTagToken(tag) && !knownTagKeys.has(key)
          })
        if (missingTagNames.length > 0) rememberCustomTagNames(missingTagNames)
      }

      function syncUiFromConfig(cfg: FilterConfig): void {
        enabledInput.checked = cfg.enabled
        modeSelect.value = cfg.mode
        for (const lv of ['public', 'lv1', 'lv2', 'lv3'] as const) {
          levelInputs[lv].checked = cfg.levels.includes(lv)
        }
        showBlockedPostsInput.checked = cfg.showBlockedPostsInTopic
        autoLoadInput.checked = cfg.autoLoadMore
      }

      function readCoreUiToConfig(prev: FilterConfig): FilterConfig {
        const levels: Level[] = []
        for (const lv of ['public', 'lv1', 'lv2', 'lv3'] as const) {
          if (levelInputs[lv].checked) levels.push(lv)
        }
        return {
          ...prev,
          enabled: enabledInput.checked,
          mode: (modeSelect.value as FilterMode) === 'loose' ? 'loose' : 'strict',
          levels: levels.length > 0 ? levels : (['public', 'lv1', 'lv2', 'lv3'] as Level[]),
          showBlockedPostsInTopic: showBlockedPostsInput.checked,
          autoLoadMore: autoLoadInput.checked,
        }
      }

      function setStatus(text: string): void {
        status.textContent = text
        emitUiRefresh()
      }

      function renderPickerSummaries(cfg: FilterConfig): void {
        catsSummary.textContent = `分类（含 ${cfg.categoriesInclude.length} / 排 ${cfg.categoriesExclude.length}）`
        tagsSummary.textContent = `标签（含 ${cfg.tagsInclude.length} / 排 ${cfg.tagsExclude.length}）`
        blockedSummary.textContent = `屏蔽用户（${cfg.blockedUsers.length}）`
      }

      function renderActiveSummary(cfg: FilterConfig): void {
        activeSummaryStats.innerHTML = ''

        const addStat = (label: string, value: string): void => {
          const item = document.createElement('span')
          item.className = 'ld2-compact-stat'
          item.innerHTML = `<span class="k">${label}</span><span>${value}</span>`
          activeSummaryStats.appendChild(item)
        }

        addStat('模式', cfg.enabled ? (cfg.mode === 'strict' ? 'AND' : 'OR') : '关闭')
        addStat('等级', String(cfg.levels.length))
        if (cfg.categoriesInclude.length || cfg.categoriesExclude.length)
          addStat('分类', `${cfg.categoriesInclude.length}/${cfg.categoriesExclude.length}`)
        if (cfg.tagsInclude.length || cfg.tagsExclude.length)
          addStat('标签', `${cfg.tagsInclude.length}/${cfg.tagsExclude.length}`)
        if (cfg.blockedUsers.length) addStat('屏蔽用户', String(cfg.blockedUsers.length))
        if (activeSummaryStats.childElementCount === 0) addStat('条件', '无')
      }

      function triStateButton(options: {
        text: string
        state: TriState
        activeState: TriState
        danger?: boolean
        disabled?: boolean
        onClick: () => void
      }): HTMLButtonElement {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = `btn sm${options.danger ? ' danger' : ''}${options.state === options.activeState ? ' selected' : ''}`
        btn.textContent = options.text
        btn.disabled = !!options.disabled
        btn.addEventListener('click', options.onClick)
        return btn
      }

      function renderCategoryPicker(cfg: FilterConfig, disabled: boolean): void {
        const taxonomy = loadCachedTaxonomy(ctx.storage)
        catsList.innerHTML = ''

        const q = catsSearch.value.trim().toLowerCase()
        const cats = taxonomy?.categories ?? []
        const byId = new Map<number, { id: number; name: string }>()
        for (const c of cats) byId.set(c.id, { id: c.id, name: c.name })

        if (!taxonomy) {
          const empty = document.createElement('div')
          empty.className = 'ld2-inline-help ld2-muted'
          empty.textContent = '分类/标签未加载：请先点击“刷新分类/标签”'
          catsList.appendChild(empty)
          return
        }

        const candidates = cats.map((c) => {
          const parent = c.parent_category_id != null ? byId.get(c.parent_category_id)?.name : null
          const label = parent ? `${parent} / ${c.name}` : c.name
          return { id: c.id, label }
        })

        const incSet = new Set(cfg.categoriesInclude)
        const exSet = new Set(cfg.categoriesExclude)
        const activeIds = new Set<number>([...cfg.categoriesInclude, ...cfg.categoriesExclude])

        const missingActiveInclude: Array<{ id: number; label: string }> = []
        const missingActiveExclude: Array<{ id: number; label: string }> = []
        for (const id of activeIds) {
          if (byId.has(id)) continue
          const label = `编号：${id}（分类数据未包含）`
          if (incSet.has(id)) missingActiveInclude.push({ id, label })
          else if (exSet.has(id)) missingActiveExclude.push({ id, label })
        }

        const activeInclude: Array<{ id: number; label: string }> = []
        const activeExclude: Array<{ id: number; label: string }> = []
        for (const c of candidates) {
          if (incSet.has(c.id)) activeInclude.push(c)
          else if (exSet.has(c.id)) activeExclude.push(c)
        }

        const matchesQuery = (c: { id: number; label: string }) => {
          if (!q) return true
          if (String(c.id).includes(q)) return true
          return c.label.toLowerCase().includes(q)
        }

        const limit = 80
        const savedCustomNeutral = readCustomCategoryIds()
          .filter((id) => !activeIds.has(id) && !byId.has(id))
          .map((id) => ({ id, label: `编号：${id}（分类数据未包含）` }))
          .filter(matchesQuery)
        const neutral = candidates.filter(matchesQuery).filter((c) => !activeIds.has(c.id))
        const slicedNeutral = neutral.slice(0, Math.max(0, limit - savedCustomNeutral.length))

        // Active (include/exclude) first, then neutral (limited).
        const items = [
          ...missingActiveInclude,
          ...activeInclude,
          ...missingActiveExclude,
          ...activeExclude,
          ...savedCustomNeutral,
          ...slicedNeutral,
        ]

        for (const c of items) {
          const row = document.createElement('div')
          row.className = 'ld2-row'

          const left = document.createElement('div')
          left.className = 'left'
          const title = document.createElement('div')
          title.className = 'title'
          title.textContent = c.label
          const sub = document.createElement('div')
          sub.className = 'sub'
          sub.textContent = `编号：${c.id}`
          left.appendChild(title)
          left.appendChild(sub)

          const state: TriState = exSet.has(c.id)
            ? 'exclude'
            : incSet.has(c.id)
              ? 'include'
              : 'neutral'
          const seg = document.createElement('div')
          seg.className = 'stack'
          seg.style.gap = '6px'

          const apply = (next: TriState) => {
            if (!byId.has(c.id)) rememberCustomCategoryIds([c.id])
            const current = readConfig()
            const inc = new Set(current.categoriesInclude)
            const ex = new Set(current.categoriesExclude)
            inc.delete(c.id)
            ex.delete(c.id)
            if (next === 'include') inc.add(c.id)
            if (next === 'exclude') ex.add(c.id)
            const updated: FilterConfig = {
              ...current,
              categoriesInclude: Array.from(inc),
              categoriesExclude: Array.from(ex),
            }
            writeConfig(updated)
            renderAll(updated, disabled)
            scheduleApply({ full: true })
          }

          seg.appendChild(
            triStateButton({
              text: '含',
              state: 'include',
              activeState: state,
              disabled,
              onClick: () => apply(state === 'include' ? 'neutral' : 'include'),
            })
          )
          seg.appendChild(
            triStateButton({
              text: '排',
              state: 'exclude',
              activeState: state,
              disabled,
              onClick: () => apply(state === 'exclude' ? 'neutral' : 'exclude'),
            })
          )
          seg.appendChild(
            triStateButton({
              text: '无',
              state: 'neutral',
              activeState: state,
              disabled,
              onClick: () => apply('neutral'),
            })
          )

          row.appendChild(left)
          row.appendChild(seg)
          catsList.appendChild(row)
        }
      }

      function renderTagPicker(cfg: FilterConfig, disabled: boolean): void {
        const taxonomy = loadCachedTaxonomy(ctx.storage)
        tagsList.innerHTML = ''

        const queryRaw = tagsSearch.value.trim()
        const q = queryRaw.toLowerCase()
        const tagsRaw = taxonomy?.tags ?? []
        type TagItem = { name: string; count?: number; custom?: boolean }
        const tags: TagItem[] = [{ name: '无标签', count: 0 }, ...tagsRaw]

        if (!taxonomy) {
          const empty = document.createElement('div')
          empty.className = 'ld2-inline-help ld2-muted'
          empty.textContent = '分类/标签未加载：请先点击“刷新分类/标签”'
          tagsList.appendChild(empty)
          return
        }

        const incSet = new Set(cfg.tagsInclude.map((t) => canonicalTagKey(t)).filter(Boolean))
        const exSet = new Set(cfg.tagsExclude.map((t) => canonicalTagKey(t)).filter(Boolean))
        const activeKeys = new Set<string>([...incSet, ...exSet])

        const byKey = new Map<string, TagItem>()
        for (const t of tags) byKey.set(canonicalTagKey(t.name), t)

        const persistedCustomTags = new Map<string, TagItem>()
        for (const raw of readCustomTagNames()) {
          const key = canonicalTagKey(raw)
          if (!key || byKey.has(key) || persistedCustomTags.has(key)) continue
          persistedCustomTags.set(key, { name: canonicalTagName(raw), custom: true })
        }

        const activeInclude: TagItem[] = []
        const activeExclude: TagItem[] = []
        {
          const seen = new Set<string>()
          for (const raw of cfg.tagsInclude) {
            const key = canonicalTagKey(raw)
            if (!key || seen.has(key)) continue
            seen.add(key)
            const display = canonicalTagName(raw)
            const fromTax = byKey.get(key)
            activeInclude.push({ name: display, count: fromTax?.count ?? 0, custom: !fromTax })
          }
          for (const raw of cfg.tagsExclude) {
            const key = canonicalTagKey(raw)
            if (!key || seen.has(key)) continue
            seen.add(key)
            const display = canonicalTagName(raw)
            const fromTax = byKey.get(key)
            activeExclude.push({ name: display, count: fromTax?.count ?? 0, custom: !fromTax })
          }
        }

        const activeIncludeForView = q
          ? activeInclude.filter((t) => t.name.toLowerCase().includes(q))
          : activeInclude
        const activeExcludeForView = q
          ? activeExclude.filter((t) => t.name.toLowerCase().includes(q))
          : activeExclude

        const baseItems = tags
          .filter((t) => {
            if (!q) return true
            return t.name.toLowerCase().includes(q)
          })
          .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))

        const customNeutral = Array.from(persistedCustomTags.values()).filter((t) => {
          const key = canonicalTagKey(t.name)
          if (!key || activeKeys.has(key)) return false
          return !q || t.name.toLowerCase().includes(q)
        })

        const queryKey = canonicalTagKey(queryRaw)
        const hasExact = q ? byKey.has(queryKey) || persistedCustomTags.has(queryKey) : false
        const canAddCustom =
          !!queryKey &&
          !hasExact &&
          !isNoTagToken(queryRaw) &&
          !activeKeys.has(queryKey)
        const customItem: TagItem | null = canAddCustom ? { name: queryRaw, custom: true } : null

        const MAX_NEUTRAL = 20
        const neutralCandidates = baseItems.filter((t) => {
          const key = canonicalTagKey(t.name)
          return !!key && !activeKeys.has(key) && !persistedCustomTags.has(key)
        })
        const neutralSliced = (() => {
          if (q) return neutralCandidates.slice(0, MAX_NEUTRAL)
          // Ensure “无标签” is always visible when not searching (even though its count is 0),
          // unless it's already active (then it'll be shown in the active section).
          if (activeKeys.has('无标签')) return neutralCandidates.slice(0, MAX_NEUTRAL)
          const rest = neutralCandidates.filter((t) => canonicalTagKey(t.name) !== '无标签')
          return [{ name: '无标签', count: 0 } satisfies TagItem, ...rest].slice(0, MAX_NEUTRAL)
        })()

        const items: TagItem[] = q
          ? [
              ...(customItem ? [customItem] : []),
              ...activeIncludeForView,
              ...activeExcludeForView,
              ...customNeutral,
              ...neutralSliced,
            ]
          : [
              ...activeIncludeForView,
              ...activeExcludeForView,
              ...customNeutral,
              ...(customItem ? [customItem] : []),
              ...neutralSliced,
            ]

        const matchedTotal = customNeutral.length + neutralCandidates.length
        const shownNeutral = customNeutral.length + neutralSliced.length
        if (matchedTotal > shownNeutral) {
          const hint = document.createElement('div')
          hint.className = 'ld2-inline-help ld2-muted'
          hint.textContent = q
            ? `匹配结果太多：仅显示前 ${MAX_NEUTRAL} 条（继续输入可进一步过滤）`
            : `标签太多：仅显示“已生效” + 前 ${MAX_NEUTRAL} 条（继续输入可进一步过滤）`
          tagsList.appendChild(hint)
        }

        for (const t of items) {
          const row = document.createElement('div')
          row.className = 'ld2-row'

          const left = document.createElement('div')
          left.className = 'left'
          const title = document.createElement('div')
          title.className = 'title'
          title.textContent = t.name
          const sub = document.createElement('div')
          sub.className = 'sub'
          sub.textContent = t.custom
            ? '自定义标签（分类/标签中未找到）'
            : t.name === '无标签'
              ? '没有任何标签的主题'
              : `数量：${t.count ?? 0}`
          left.appendChild(title)
          left.appendChild(sub)

          const key = canonicalTagKey(t.name)
          const active: TriState = exSet.has(key)
            ? 'exclude'
            : incSet.has(key)
              ? 'include'
              : 'neutral'
          const seg = document.createElement('div')
          seg.className = 'stack'
          seg.style.gap = '6px'

          const apply = (next: TriState) => {
            if (t.custom) rememberCustomTagNames([t.name])
            const current = readConfig()
            const inc = new Map<string, string>()
            const ex = new Map<string, string>()
            for (const v of current.tagsInclude) inc.set(canonicalTagKey(v), canonicalTagName(v))
            for (const v of current.tagsExclude) ex.set(canonicalTagKey(v), canonicalTagName(v))

            if (isNoTagToken(t.name)) {
              for (const k of Array.from(inc.keys())) if (isNoTagToken(k)) inc.delete(k)
              for (const k of Array.from(ex.keys())) if (isNoTagToken(k)) ex.delete(k)
            } else {
              inc.delete(key)
              ex.delete(key)
            }

            if (next === 'include') inc.set(key, canonicalTagName(t.name))
            if (next === 'exclude') ex.set(key, canonicalTagName(t.name))

            const updated: FilterConfig = {
              ...current,
              tagsInclude: Array.from(inc.values()),
              tagsExclude: Array.from(ex.values()),
            }
            writeConfig(updated)
            renderAll(updated, disabled)
            scheduleApply({ full: true })
          }

          seg.appendChild(
            triStateButton({
              text: '含',
              state: 'include',
              activeState: active,
              disabled,
              onClick: () => apply(active === 'include' ? 'neutral' : 'include'),
            })
          )
          seg.appendChild(
            triStateButton({
              text: '排',
              state: 'exclude',
              activeState: active,
              disabled,
              onClick: () => apply(active === 'exclude' ? 'neutral' : 'exclude'),
            })
          )
          seg.appendChild(
            triStateButton({
              text: '无',
              state: 'neutral',
              activeState: active,
              disabled,
              onClick: () => apply('neutral'),
            })
          )

          row.appendChild(left)
          row.appendChild(seg)
          tagsList.appendChild(row)
        }
      }

      function renderBlockedUsers(cfg: FilterConfig, disabled: boolean): void {
        blockedList.innerHTML = ''

        if (cfg.blockedUsers.length === 0) {
          const empty = document.createElement('div')
          empty.className = 'ld2-inline-help ld2-muted'
          empty.textContent = '还没有屏蔽任何用户。'
          blockedList.appendChild(empty)
          return
        }

        const blockedSet = toBlockedUserSet(cfg.blockedUsers)
        const currentRoute = ctx.discourse.getRouteInfo()
        const topicAuthor =
          currentRoute.isTopic && currentRoute.topicId
            ? getTopicOriginalPosterUsername(currentRoute.topicId)
            : null

        for (const username of cfg.blockedUsers) {
          const normalized = normalizeUsername(username)
          if (!normalized || !blockedSet.has(normalized)) continue

          const row = document.createElement('div')
          row.className = 'ld2-row'

          const left = document.createElement('div')
          left.className = 'left'
          const title = document.createElement('div')
          title.className = 'title'
          title.textContent = `@${username}`
          const sub = document.createElement('div')
          sub.className = 'sub'
          sub.textContent =
            topicAuthor && normalizeUsername(topicAuthor) === normalized
              ? '当前话题楼主；仅隐藏其回帖，不影响整帖打开。'
              : '屏蔽其发帖主题，并默认折叠其在他人主题中的发言。'
          left.appendChild(title)
          left.appendChild(sub)

          const actions = document.createElement('div')
          actions.className = 'stack'
          actions.style.gap = '6px'

          const removeBtn = document.createElement('button')
          removeBtn.type = 'button'
          removeBtn.className = 'btn sm danger'
          removeBtn.disabled = disabled
          removeBtn.textContent = '移除'
          removeBtn.addEventListener('click', () => {
            const current = readConfig()
            const next: FilterConfig = {
              ...current,
              blockedUsers: current.blockedUsers.filter((u) => normalizeUsername(u) !== normalized),
            }
            writeConfig(next)
            renderAll(next, disabled)
            connectObserver()
            scheduleApply({ full: true })
          })

          actions.appendChild(removeBtn)
          row.appendChild(left)
          row.appendChild(actions)
          blockedList.appendChild(row)
        }
      }

      function resetTopicPostVisibility(): void {
        const stream = getTopicStreamContainer()
        for (const item of getTopicPostItems(stream)) {
          clearBlockedPostTemporaryReveal(item)
          if (item.dataset.ld2BlockedPostHidden) delete item.dataset.ld2BlockedPostHidden
          item.style.removeProperty('display')

          const article = getTopicPostArticle(item)
          if (!article) continue
          const hideTarget = getBlockedPostHideTarget(item, article)
          if (hideTarget.dataset.ld2BlockedPostHidden) delete hideTarget.dataset.ld2BlockedPostHidden
          hideTarget.style.removeProperty('display')
          const inserted = getBlockedPostPlaceholder(article)
          inserted?.remove()
          article.style.removeProperty('opacity')
        }
      }

      function applyTopicPostBlocking(cfg: FilterConfig): number {
        const route = ctx.discourse.getRouteInfo()
        if (!route.isTopic || !route.topicId) {
          resetTopicPostVisibility()
          return 0
        }

        const blocked = toBlockedUserSet(cfg.blockedUsers)
        if (blocked.size === 0 || cfg.showBlockedPostsInTopic) {
          resetTopicPostVisibility()
          return 0
        }

        const opUsername = normalizeUsername(getTopicOriginalPosterUsername(route.topicId) || '')
        const stream = getTopicStreamContainer()
        let hiddenCount = 0

        for (const item of getTopicPostItems(stream)) {
          const article = getTopicPostArticle(item)
          if (!article) continue
          const hideTarget = getBlockedPostHideTarget(item, article)
          const username = normalizeUsername(parseTopicPostUsername(article) || '')
          const postNo = Number.parseInt(
            item.getAttribute('data-post-number') || article.getAttribute('data-post-number') || '',
            10
          )
          const shouldHide =
            !!username &&
            blocked.has(username) &&
            username !== opUsername &&
            Number.isFinite(postNo) &&
            postNo > 1

          const existingPlaceholder = getBlockedPostPlaceholder(article)
          const temporarilyRevealed = isBlockedPostTemporarilyRevealed(item)
          if (!shouldHide) {
            clearBlockedPostTemporaryReveal(item)
            if (item.dataset.ld2BlockedPostHidden) delete item.dataset.ld2BlockedPostHidden
            if (hideTarget.dataset.ld2BlockedPostHidden) delete hideTarget.dataset.ld2BlockedPostHidden
            item.style.removeProperty('display')
            hideTarget.style.removeProperty('display')
            existingPlaceholder?.remove()
            continue
          }

          if (temporarilyRevealed) {
            if (item.dataset.ld2BlockedPostHidden) delete item.dataset.ld2BlockedPostHidden
            if (hideTarget.dataset.ld2BlockedPostHidden) delete hideTarget.dataset.ld2BlockedPostHidden
            item.style.removeProperty('display')
            hideTarget.style.removeProperty('display')
            existingPlaceholder?.remove()
            continue
          }

          if (!existingPlaceholder) {
            const placeholder = document.createElement('div')
            placeholder.className = 'ld2-blocked-post-placeholder'
            const text = document.createElement('div')
            text.className = 'ld2-blocked-post-meta ld2-muted'
            text.textContent = `已屏蔽 @${username} 的发言 · #${Number.isFinite(postNo) ? postNo : '?'} `
            const toggle = document.createElement('button')
            toggle.type = 'button'
            toggle.className = 'btn sm'
            toggle.textContent = '查看一次'
            toggle.addEventListener('click', () => {
              markBlockedPostTemporarilyRevealed(item)
              placeholder.remove()
              delete item.dataset.ld2BlockedPostHidden
              if (hideTarget.dataset.ld2BlockedPostHidden) delete hideTarget.dataset.ld2BlockedPostHidden
              item.style.removeProperty('display')
              hideTarget.style.removeProperty('display')
            })
            const wrap = document.createElement('div')
            wrap.className = 'stack ld2-blocked-post-row'
            wrap.appendChild(text)
            wrap.appendChild(toggle)
            placeholder.appendChild(wrap)
            article.insertAdjacentElement('beforebegin', placeholder)
          }

          if (item.dataset.ld2BlockedPostHidden) delete item.dataset.ld2BlockedPostHidden
          hideTarget.dataset.ld2BlockedPostHidden = '1'
          item.style.removeProperty('display')
          hideTarget.style.display = 'none'
          hiddenCount += 1
        }

        return hiddenCount
      }

      function renderAll(cfg: FilterConfig, disabled: boolean): void {
        seedCustomEntriesFromConfig(cfg)
        renderPickerSummaries(cfg)
        renderActiveSummary(cfg)
        renderCategoryPicker(cfg, disabled)
        renderTagPicker(cfg, disabled)
        renderBlockedUsers(cfg, disabled)
      }

      let lastAutoLoadAt = 0
      let autoLoadSeq = 0
      let autoLoadKickTimer: number | null = null
      let autoLoadRestoreTimer: number | null = null

      function clearAutoLoadTimers(): void {
        autoLoadSeq += 1
        if (autoLoadKickTimer != null) {
          clearTimeout(autoLoadKickTimer)
          autoLoadKickTimer = null
        }
        if (autoLoadRestoreTimer != null) {
          clearTimeout(autoLoadRestoreTimer)
          autoLoadRestoreTimer = null
        }
      }

      function tryAutoLoadMore(cfg: FilterConfig, visible: number): void {
        if (!cfg.autoLoadMore) return
        const now = Date.now()
        if (now - lastAutoLoadAt < 2000) return
        // v1 parity: keep at least ~20 visible items; below that, try to load more.
        if (visible >= 20) return
        lastAutoLoadAt = now

        const btn = document.querySelector<HTMLButtonElement>(
          'button.load-more, button.btn.load-more, button.btn-primary.load-more'
        )
        if (btn && !btn.disabled) {
          btn.click()
          return
        }

        // No explicit "load more" button: scroll to bottom to trigger infinite load.
        // v1 parity: only do this when user is near the top, and restore the viewport afterwards
        // if the user didn't manually scroll.
        const startY = Number(window.scrollY || 0)
        const startX = Number(window.scrollX || 0)
        if (Number.isFinite(startY) && startY > 200) return

        clearAutoLoadTimers()
        const seq = autoLoadSeq
        window.scrollTo(0, document.body.scrollHeight - 120)
        autoLoadKickTimer = window.setTimeout(() => {
          if (seq !== autoLoadSeq) return
          window.scrollTo(0, document.body.scrollHeight)
          const expectedY = Number(window.scrollY || 0)
          autoLoadRestoreTimer = window.setTimeout(() => {
            if (seq !== autoLoadSeq) return
            const nowY = Number(window.scrollY || 0)
            if (
              Number.isFinite(expectedY) &&
              Number.isFinite(nowY) &&
              Math.abs(nowY - expectedY) <= 120
            ) {
              window.scrollTo(startX, startY)
            }
            autoLoadRestoreTimer = null
          }, 220)
          autoLoadKickTimer = null
        }, 120)
      }

      const topicMetaCache = new WeakMap<HTMLElement, TopicMeta>()

      function invalidateTopicMeta(item: HTMLElement): void {
        topicMetaCache.delete(item)
      }

      function getTopicMeta(item: HTMLElement): TopicMeta {
        const cached = topicMetaCache.get(item)
        if (cached) return cached
        const next = extractTopicMeta(item)
        topicMetaCache.set(item, next)
        return next
      }

      function setListStatus(
        cfg: FilterConfig,
        ignoreTaxonomyFilters: boolean,
        hidden: number,
        total: number
      ): void {
        setStatus(
          ignoreTaxonomyFilters
            ? hidden > 0
              ? `隐藏 ${hidden}/${total}（分类/标签筛选已忽略）`
              : cfg.enabled || cfg.blockedUsers.length > 0
                ? '分类/标签页：已忽略分类与标签筛选'
                : '关闭'
            : hidden > 0
              ? `隐藏 ${hidden}/${total}`
              : cfg.enabled || cfg.blockedUsers.length > 0
                ? '已生效'
                : '关闭'
        )
      }

      function applyListFilterToItem(el: HTMLElement, effectiveCfg: FilterConfig): boolean {
        const topicId = el.getAttribute('data-topic-id') || el.dataset.topicId
        // v1 parity: Discourse may insert "system rows" without topic id; never hide them.
        if (!topicId) {
          if (el.dataset.ld2FilterHidden) {
            delete el.dataset.ld2FilterHidden
            el.style.removeProperty('display')
          }
          return false
        }
        const meta = getTopicMeta(el)
        const show = shouldShowTopic(meta, effectiveCfg)
        if (!show) {
          el.dataset.ld2FilterHidden = '1'
          el.style.display = 'none'
          return true
        }
        if (el.dataset.ld2FilterHidden) {
          delete el.dataset.ld2FilterHidden
          el.style.removeProperty('display')
        }
        return false
      }

      function applyListIncremental(
        cfg: FilterConfig,
        route: ReturnType<AppContext['discourse']['getRouteInfo']>,
        changedItems: Set<HTMLElement>
      ): void {
        const container = getListContainer()
        const ignoreTaxonomyFilters = isCategoryOrTagScopedPage(route.pathname)
        const effectiveCfg = getEffectiveListFilterConfig(cfg, route.pathname)
        for (const item of changedItems) {
          if (container && !container.contains(item)) continue
          applyListFilterToItem(item, effectiveCfg)
        }
        const total = getTopicItems(container).length
        const hidden = container
          ? container.querySelectorAll<HTMLElement>('.topic-list-item[data-ld2-filter-hidden]').length
          : 0
        const visible = Math.max(0, total - hidden)
        setListStatus(cfg, ignoreTaxonomyFilters, hidden, total)
        tryAutoLoadMore(effectiveCfg, visible)
      }

      function collectChangedTopicItems(records: MutationRecord[]): Set<HTMLElement> {
        const out = new Set<HTMLElement>()
        for (const record of records) {
          if (record.type === 'attributes') {
            const item = getTopicItemFromNode(record.target)
            if (!item) continue
            invalidateTopicMeta(item)
            out.add(item)
            continue
          }

          const targetItem = getTopicItemFromNode(record.target)
          if (targetItem) {
            invalidateTopicMeta(targetItem)
            out.add(targetItem)
          }
          for (const node of Array.from(record.addedNodes)) collectTopicItemsFromNode(node, out)
          for (const node of Array.from(record.removedNodes)) {
            const item = getTopicItemFromNode(node)
            if (item) invalidateTopicMeta(item)
          }
        }
        return out
      }

      function applyOnce(cfg: FilterConfig): void {
        // v1 parity: autoRead enabled => disable filtering (avoid shrinking the list / changing reading rhythm).
        if (ctx.storage.get('read.enabled', false)) {
          setControlsDisabled(true)
          const container = getListContainer()
          for (const el of getTopicItems(container)) {
            if (el.dataset.ld2FilterHidden) {
              delete el.dataset.ld2FilterHidden
              el.style.removeProperty('display')
            }
          }
          resetTopicPostVisibility()
          setStatus('自动阅读：筛选暂停（停止自动阅读后恢复）')
          return
        }
        setControlsDisabled(false)

        const route = ctx.discourse.getRouteInfo()
        if (route.isTopic) {
          const hiddenPosts = applyTopicPostBlocking(cfg)
          setStatus(
            hiddenPosts > 0
              ? `已折叠 ${hiddenPosts} 条屏蔽用户发言`
              : cfg.blockedUsers.length > 0
                ? '已生效'
                : '空闲'
          )
          return
        }

        resetTopicPostVisibility()

        if (!isListPage(route.pathname)) {
          // Not on list pages: reset.
          const container = getListContainer()
          for (const el of getTopicItems(container)) {
            if (el.dataset.ld2FilterHidden) {
              delete el.dataset.ld2FilterHidden
              el.style.removeProperty('display')
            }
          }
          setStatus('空闲')
          return
        }

        const container = getListContainer()
        const items = getTopicItems(container)
        const ignoreTaxonomyFilters = isCategoryOrTagScopedPage(route.pathname)
        const effectiveCfg = getEffectiveListFilterConfig(cfg, route.pathname)
        let hidden = 0
        for (const el of items) {
          if (applyListFilterToItem(el, effectiveCfg)) hidden += 1
        }
        const visible = Math.max(0, items.length - hidden)
        setListStatus(cfg, ignoreTaxonomyFilters, hidden, items.length)
        tryAutoLoadMore(effectiveCfg, visible)
      }

      let observer: MutationObserver | null = null
      let observedContainer: HTMLElement | null = null
      let observerRetryTimer: number | null = null
      let scheduled = false
      let scheduledForceFull = false
      const scheduledTopicItems = new Set<HTMLElement>()
      function scheduleApply(options?: { full?: boolean; items?: Iterable<HTMLElement> }): void {
        if (options?.full) scheduledForceFull = true
        if (options?.items) {
          for (const item of options.items) scheduledTopicItems.add(item)
        }
        if (scheduled) return
        scheduled = true
        setTimeout(() => {
          scheduled = false
          const forceFull = scheduledForceFull
          const items = new Set(scheduledTopicItems)
          scheduledForceFull = false
          scheduledTopicItems.clear()
          const cfg = readConfig()
          const route = ctx.discourse.getRouteInfo()
          if (
            forceFull ||
            route.isTopic ||
            !isListPage(route.pathname) ||
            ctx.storage.get('read.enabled', false) ||
            items.size === 0
          ) {
            applyOnce(cfg)
            return
          }
          applyListIncremental(cfg, route, items)
        }, 120)
      }

      function ensureTaxonomyFresh(): void {
        const cached = loadCachedTaxonomy(ctx.storage)
        const age = cached ? Date.now() - cached.updatedAt : Infinity
        if (!cached || age > TAXONOMY_TTL_MS) {
          const ac = new AbortController()
          refreshTaxonomy({
            storage: ctx.storage,
            origin: window.location.origin,
            signal: ac.signal,
          })
            .then((t) => {
              ctx.logger.info(
                `taxonomy refreshed: ${t.categories.length} categories, ${t.tags.length} tags`
              )
              renderAll(readConfig(), false)
            })
            .catch((e) => ctx.logger.warn('taxonomy refresh failed', e))
        }
      }

      function disconnectObserver(): void {
        observer?.disconnect()
        observer = null
        observedContainer = null
        if (observerRetryTimer != null) {
          clearTimeout(observerRetryTimer)
          observerRetryTimer = null
        }
        clearAutoLoadTimers()
      }

      function getObserverTarget(
        cfg: FilterConfig,
        route: ReturnType<AppContext['discourse']['getRouteInfo']>
      ): { container: HTMLElement | null; options: MutationObserverInit } | null {
        if (ctx.storage.get('read.enabled', false)) return null

        if (route.isTopic) {
          if (cfg.blockedUsers.length === 0 || cfg.showBlockedPostsInTopic) return null
          return {
            container: getTopicStreamContainer(),
            options: {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['class', 'data-post-number', 'data-user-card', 'href'],
            },
          }
        }

        if (!(cfg.enabled || cfg.blockedUsers.length > 0) || !isListPage(route.pathname)) {
          return null
        }

        return {
          container: getListContainer(),
          options: {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [
              'class',
              'data-category-id',
              'data-parent-category-id',
              'data-tag-name',
            ],
          },
        }
      }

      function connectObserver(): void {
        const cfg = readConfig()
        const route = ctx.discourse.getRouteInfo()
        const target = getObserverTarget(cfg, route)
        if (!target) {
          disconnectObserver()
          return
        }

        const { container, options } = target
        if (!container) {
          if (observerRetryTimer == null) {
            observerRetryTimer = window.setTimeout(() => {
              observerRetryTimer = null
              connectObserver()
            }, 500)
          }
          return
        }

        if (container === observedContainer && observer) return

        observer?.disconnect()
        observedContainer = container
        observer = new MutationObserver((records) => {
          // Always apply with latest config (avoid stale closure bugs on config changes).
          const changedItems = collectChangedTopicItems(records)
          scheduleApply({ items: changedItems })
        })
        observer.observe(container, options)

        // Apply immediately after (re)connecting. Otherwise, if we attach after the list has
        // already rendered, there may be no further mutations to trigger `scheduleApply`,
        // making it look like the filter only works after toggling.
        scheduleApply({ full: true })
      }

      function onAnyConfigChanged(): void {
        const cfg = readConfig()
        const next = readCoreUiToConfig(cfg)
        writeConfig(next)
        connectObserver()
        renderAll(next, false)
        scheduleApply({ full: true })
      }

      enabledInput.addEventListener('change', onAnyConfigChanged)
      modeSelect.addEventListener('change', onAnyConfigChanged)
      showBlockedPostsInput.addEventListener('change', onAnyConfigChanged)
      autoLoadInput.addEventListener('change', onAnyConfigChanged)
      for (const lv of ['public', 'lv1', 'lv2', 'lv3'] as const) {
        levelInputs[lv].addEventListener('change', onAnyConfigChanged)
      }

      const onCatsSearch = () => renderCategoryPicker(readConfig(), false)
      const onTagsSearch = () => renderTagPicker(readConfig(), false)
      catsSearch.addEventListener('input', onCatsSearch)
      tagsSearch.addEventListener('input', onTagsSearch)

      const blockCurrentTopicAuthor = () => {
        const route = ctx.discourse.getRouteInfo()
        if (!route.isTopic || !route.topicId) return
        const author = getTopicOriginalPosterUsername(route.topicId)
        if (!author) return
        const current = readConfig()
        const nextSet = new Map(current.blockedUsers.map((u) => [normalizeUsername(u), u] as const))
        nextSet.set(normalizeUsername(author), author)
        const next: FilterConfig = { ...current, blockedUsers: Array.from(nextSet.values()) }
        writeConfig(next)
        connectObserver()
        renderAll(next, false)
        scheduleApply({ full: true })
        window.dispatchEvent(
          new CustomEvent('ld2:toast', { detail: { title: `已屏蔽 @${author}` } })
        )
      }

      const addBlockedUser = () => {
        const normalized = normalizeBlockedUserInput(blockedInput.value)
        if (!normalized) return
        const current = readConfig()
        const nextSet = new Map(current.blockedUsers.map((u) => [normalizeUsername(u), u] as const))
        nextSet.set(normalizeUsername(normalized), normalized)
        const next: FilterConfig = {
          ...current,
          blockedUsers: Array.from(nextSet.values()),
        }
        blockedInput.value = ''
        writeConfig(next)
        connectObserver()
        renderAll(next, false)
        scheduleApply({ full: true })
      }
      const onBlockedInputKeydown = (event: KeyboardEvent) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        addBlockedUser()
      }
      blockedAddBtn.addEventListener('click', addBlockedUser)
      blockedInput.addEventListener('keydown', onBlockedInputKeydown)
      quickBlockAuthorBtn.addEventListener('click', blockCurrentTopicAuthor)

      const onClear = () => {
        const cfg = readConfig()
        const next: FilterConfig = {
          ...cfg,
          categoriesInclude: [],
          categoriesExclude: [],
          tagsInclude: [],
          tagsExclude: [],
          blockedUsers: [],
        }
        writeConfig(next)
        renderAll(next, false)
        scheduleApply({ full: true })
        connectObserver()
        window.dispatchEvent(new CustomEvent('ld2:toast', { detail: { title: '筛选条件已清空' } }))
      }
      clearBtn.addEventListener('click', onClear)

      const onRefreshTaxonomy = () => {
        const ac = new AbortController()
        setStatus('正在刷新分类/标签…')
        refreshTaxonomy({ storage: ctx.storage, origin: window.location.origin, signal: ac.signal })
          .then((t) => {
            setStatus(`分类/标签：${t.categories.length}/${t.tags.length}`)
            window.dispatchEvent(
              new CustomEvent('ld2:toast', {
                detail: {
                  title: '分类/标签已刷新',
                  desc: `分类 ${t.categories.length} / 标签 ${t.tags.length}`,
                },
              })
            )
            renderAll(readConfig(), false)
          })
          .catch(() => {
            setStatus('分类/标签刷新失败')
            window.dispatchEvent(
              new CustomEvent('ld2:toast', { detail: { title: '分类/标签刷新失败' } })
            )
          })
      }
      refreshBtn.addEventListener('click', onRefreshTaxonomy)

      const cfg0 = readConfig()
      syncUiFromConfig(cfg0)
      const suspended0 = ctx.storage.get('read.enabled', false)
      setControlsDisabled(suspended0)
      ensureTaxonomyFresh()
      connectObserver()
      scheduleApply({ full: true })
      renderAll(cfg0, suspended0)

      let lastSuspended = suspended0
      const syncSuspended = () => {
        const suspended = ctx.storage.get('read.enabled', false)
        if (suspended === lastSuspended) return
        lastSuspended = suspended
        setControlsDisabled(suspended)
        renderAll(readConfig(), suspended)
        connectObserver()
        scheduleApply({ full: true })
      }
      const onUiRefresh = () => syncSuspended()
      const onAutoReadStateEvent = () => syncSuspended()
      const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') syncSuspended()
      }
      const onWindowFocus = () => syncSuspended()
      window.addEventListener(UI_REFRESH_EVENT, onUiRefresh)
      window.addEventListener(AUTO_READ_START_EVENT, onAutoReadStateEvent)
      window.addEventListener(AUTO_READ_TOGGLE_EVENT, onAutoReadStateEvent)
      window.addEventListener(AUTO_READ_STOP_EVENT, onAutoReadStateEvent)
      document.addEventListener('visibilitychange', onVisibilityChange)
      window.addEventListener('focus', onWindowFocus)

      const onBlockTopicAuthorEvent = () => blockCurrentTopicAuthor()
      window.addEventListener(FILTER_BLOCK_TOPIC_AUTHOR_EVENT, onBlockTopicAuthorEvent)

      const routeSub = ctx.router.onChange(() => {
        connectObserver()
        scheduleApply({ full: true })
        renderAll(readConfig(), ctx.storage.get('read.enabled', false))
      })

      return combineDisposables(
        routeSub,
        toDisposable(() => disconnectObserver()),
        toDisposable(() => {
          enabledInput.removeEventListener('change', onAnyConfigChanged)
          modeSelect.removeEventListener('change', onAnyConfigChanged)
          showBlockedPostsInput.removeEventListener('change', onAnyConfigChanged)
          autoLoadInput.removeEventListener('change', onAnyConfigChanged)
          for (const lv of ['public', 'lv1', 'lv2', 'lv3'] as const) {
            levelInputs[lv].removeEventListener('change', onAnyConfigChanged)
          }
          catsSearch.removeEventListener('input', onCatsSearch)
          tagsSearch.removeEventListener('input', onTagsSearch)
          blockedAddBtn.removeEventListener('click', addBlockedUser)
          blockedInput.removeEventListener('keydown', onBlockedInputKeydown)
          quickBlockAuthorBtn.removeEventListener('click', blockCurrentTopicAuthor)
          window.removeEventListener(FILTER_BLOCK_TOPIC_AUTHOR_EVENT, onBlockTopicAuthorEvent)
          window.removeEventListener(UI_REFRESH_EVENT, onUiRefresh)
          window.removeEventListener(AUTO_READ_START_EVENT, onAutoReadStateEvent)
          window.removeEventListener(AUTO_READ_TOGGLE_EVENT, onAutoReadStateEvent)
          window.removeEventListener(AUTO_READ_STOP_EVENT, onAutoReadStateEvent)
          document.removeEventListener('visibilitychange', onVisibilityChange)
          window.removeEventListener('focus', onWindowFocus)
          refreshBtn.removeEventListener('click', onRefreshTaxonomy)
          clearBtn.removeEventListener('click', onClear)
          activeSummaryCard.remove()
          enabledLabel.remove()
          modeSelect.remove()
          levelsWrap.remove()
          catsDetails.remove()
          tagsDetails.remove()
          blockedDetails.remove()
          autoLoadLabel.remove()
          miscRow.remove()
        })
      )
    },
  }
}

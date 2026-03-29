import { describe, expect, it } from 'vitest'

import { shouldShowTopic } from '../src/features/filter/rules'
import type { FilterConfig, TopicMeta } from '../src/features/filter/rules'

describe('filter rules', () => {
  it('filters by level allowlist', () => {
    const cfg: FilterConfig = {
      enabled: true,
      mode: 'strict',
      levels: ['public', 'lv2', 'lv3'],
      categoriesInclude: [],
      categoriesExclude: [],
      tagsInclude: [],
      tagsExclude: [],
      homeSourceEnabled: false,
      homeSourceCategories: [],
      homeSourceTags: [],
      homeSourceCollapsedByDefault: false,
      blockedUsers: [],
      showBlockedPostsInTopic: false,
      autoLoadMore: false,
    }
    const meta: TopicMeta = {
      level: 'lv1',
      categoryId: null,
      parentCategoryId: null,
      tags: [],
      authorUsername: null,
    }
    expect(shouldShowTopic(meta, cfg)).toBe(false)
  })

  it('strict mode requires matching all include dimensions', () => {
    const cfg: FilterConfig = {
      enabled: true,
      mode: 'strict',
      levels: ['public', 'lv1', 'lv2', 'lv3'],
      categoriesInclude: [10],
      categoriesExclude: [],
      tagsInclude: ['a'],
      tagsExclude: [],
      homeSourceEnabled: false,
      homeSourceCategories: [],
      homeSourceTags: [],
      homeSourceCollapsedByDefault: false,
      blockedUsers: [],
      showBlockedPostsInTopic: false,
      autoLoadMore: false,
    }
    expect(
      shouldShowTopic(
        {
          level: 'public',
          categoryId: 10,
          parentCategoryId: null,
          tags: ['a'],
          authorUsername: null,
        },
        cfg
      )
    ).toBe(true)
    expect(
      shouldShowTopic(
        { level: 'public', categoryId: 10, parentCategoryId: null, tags: [], authorUsername: null },
        cfg
      )
    ).toBe(false)
    expect(
      shouldShowTopic(
        {
          level: 'public',
          categoryId: 9,
          parentCategoryId: null,
          tags: ['a'],
          authorUsername: null,
        },
        cfg
      )
    ).toBe(false)
  })

  it('loose mode allows matching any include dimension', () => {
    const cfg: FilterConfig = {
      enabled: true,
      mode: 'loose',
      levels: ['public', 'lv1', 'lv2', 'lv3'],
      categoriesInclude: [10],
      categoriesExclude: [],
      tagsInclude: ['a'],
      tagsExclude: [],
      homeSourceEnabled: false,
      homeSourceCategories: [],
      homeSourceTags: [],
      homeSourceCollapsedByDefault: false,
      blockedUsers: [],
      showBlockedPostsInTopic: false,
      autoLoadMore: false,
    }
    expect(
      shouldShowTopic(
        { level: 'public', categoryId: 10, parentCategoryId: null, tags: [], authorUsername: null },
        cfg
      )
    ).toBe(true)
    expect(
      shouldShowTopic(
        {
          level: 'public',
          categoryId: 9,
          parentCategoryId: null,
          tags: ['a'],
          authorUsername: null,
        },
        cfg
      )
    ).toBe(true)
    expect(
      shouldShowTopic(
        { level: 'public', categoryId: 9, parentCategoryId: null, tags: [], authorUsername: null },
        cfg
      )
    ).toBe(false)
  })

  it('excludes by tagsExclude (case-insensitive)', () => {
    const cfg: FilterConfig = {
      enabled: true,
      mode: 'strict',
      levels: ['public', 'lv1', 'lv2', 'lv3'],
      categoriesInclude: [],
      categoriesExclude: [],
      tagsInclude: [],
      tagsExclude: ['SpAm'],
      homeSourceEnabled: false,
      homeSourceCategories: [],
      homeSourceTags: [],
      homeSourceCollapsedByDefault: false,
      blockedUsers: [],
      showBlockedPostsInTopic: false,
      autoLoadMore: false,
    }
    expect(
      shouldShowTopic(
        {
          level: 'public',
          categoryId: null,
          parentCategoryId: null,
          tags: ['spam'],
          authorUsername: null,
        },
        cfg
      )
    ).toBe(false)
  })

  it('supports include/exclude "no tag" token', () => {
    const base: Omit<FilterConfig, 'tagsInclude' | 'tagsExclude'> = {
      enabled: true,
      mode: 'strict',
      levels: ['public', 'lv1', 'lv2', 'lv3'],
      categoriesInclude: [],
      categoriesExclude: [],
      homeSourceEnabled: false,
      homeSourceCategories: [],
      homeSourceTags: [],
      homeSourceCollapsedByDefault: false,
      blockedUsers: [],
      showBlockedPostsInTopic: false,
      autoLoadMore: false,
    }

    const includeNoTag: FilterConfig = { ...base, tagsInclude: ['无标签'], tagsExclude: [] }
    expect(
      shouldShowTopic(
        {
          level: 'public',
          categoryId: null,
          parentCategoryId: null,
          tags: [],
          authorUsername: null,
        },
        includeNoTag
      )
    ).toBe(true)
    expect(
      shouldShowTopic(
        {
          level: 'public',
          categoryId: null,
          parentCategoryId: null,
          tags: ['a'],
          authorUsername: null,
        },
        includeNoTag
      )
    ).toBe(false)

    const excludeNoTag: FilterConfig = { ...base, tagsInclude: [], tagsExclude: ['__no_tag__'] }
    expect(
      shouldShowTopic(
        {
          level: 'public',
          categoryId: null,
          parentCategoryId: null,
          tags: [],
          authorUsername: null,
        },
        excludeNoTag
      )
    ).toBe(false)
    expect(
      shouldShowTopic(
        {
          level: 'public',
          categoryId: null,
          parentCategoryId: null,
          tags: ['a'],
          authorUsername: null,
        },
        excludeNoTag
      )
    ).toBe(true)
  })

  it('treats parent category as the topic category', () => {
    const cfg: FilterConfig = {
      enabled: true,
      mode: 'strict',
      levels: ['public', 'lv1', 'lv2', 'lv3'],
      categoriesInclude: [1],
      categoriesExclude: [],
      tagsInclude: [],
      tagsExclude: [],
      homeSourceEnabled: false,
      homeSourceCategories: [],
      homeSourceTags: [],
      homeSourceCollapsedByDefault: false,
      blockedUsers: [],
      showBlockedPostsInTopic: false,
      autoLoadMore: false,
    }

    // Topic is in child category 10, parent is 1.
    expect(
      shouldShowTopic(
        { level: 'public', categoryId: 10, parentCategoryId: 1, tags: [], authorUsername: null },
        cfg
      )
    ).toBe(true)
    // No parent => not included.
    expect(
      shouldShowTopic(
        { level: 'public', categoryId: 10, parentCategoryId: null, tags: [], authorUsername: null },
        cfg
      )
    ).toBe(false)
  })

  it('hides blocked authors regardless of general filter enabled state', () => {
    const cfg: FilterConfig = {
      enabled: false,
      mode: 'strict',
      levels: ['public', 'lv1', 'lv2', 'lv3'],
      categoriesInclude: [],
      categoriesExclude: [],
      tagsInclude: [],
      tagsExclude: [],
      homeSourceEnabled: false,
      homeSourceCategories: [],
      homeSourceTags: [],
      homeSourceCollapsedByDefault: false,
      blockedUsers: ['Neo'],
      showBlockedPostsInTopic: false,
      autoLoadMore: false,
    }

    expect(
      shouldShowTopic(
        {
          level: 'public',
          categoryId: null,
          parentCategoryId: null,
          tags: [],
          authorUsername: 'neo',
        },
        cfg
      )
    ).toBe(false)
    expect(
      shouldShowTopic(
        {
          level: 'public',
          categoryId: null,
          parentCategoryId: null,
          tags: [],
          authorUsername: 'other',
        },
        cfg
      )
    ).toBe(true)
  })
})

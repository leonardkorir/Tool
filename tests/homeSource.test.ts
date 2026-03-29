import { describe, expect, it } from 'vitest'

import {
  buildHomeSourceRequests,
  filterHomeSourceTopicsByRequest,
  normalizeHomeSourceTopics,
  selectHomeSourceTopics,
  type HomeSourceTopic,
} from '../src/features/filter/homeSource'
import type { FilterConfig } from '../src/features/filter/rules'
import type { Taxonomy } from '../src/platform/discourse/taxonomy'

function createBaseConfig(): FilterConfig {
  return {
    enabled: true,
    mode: 'strict',
    levels: ['public', 'lv1', 'lv2', 'lv3'],
    categoriesInclude: [],
    categoriesExclude: [],
    tagsInclude: [],
    tagsExclude: [],
    homeSourceEnabled: true,
    homeSourceCategories: [],
    homeSourceTags: [],
    homeSourceCollapsedByDefault: false,
    blockedUsers: [],
    showBlockedPostsInTopic: false,
    autoLoadMore: false,
  }
}

describe('home source helpers', () => {
  it('builds deduplicated category and tag requests', () => {
    const taxonomy: Taxonomy = {
      version: 1,
      updatedAt: 1,
      categories: [
        { id: 4, name: '开发调优', slug: 'dev' },
        { id: 45, name: '深海幽域', slug: 'muted', parent_category_id: 4 },
      ],
      tags: [{ name: 'OpenAI', count: 10 }],
    }

    const requests = buildHomeSourceRequests({
      origin: 'https://linux.do',
      taxonomy,
      categoryIds: [45, 45, 4],
      tagNames: ['OpenAI', 'openai', ''],
    })

    expect(requests).toEqual([
      {
        kind: 'category',
        key: 'category:4',
        label: '开发调优',
        url: 'https://linux.do/c/dev/4/l/latest.json',
        urls: ['https://linux.do/c/dev/4/l/latest.json', 'https://linux.do/c/dev/4.json', 'https://linux.do/c/4/l/latest.json', 'https://linux.do/c/4.json'],
        categoryId: 4,
      },
      {
        kind: 'category',
        key: 'category:45',
        label: '开发调优 / 深海幽域',
        url: 'https://linux.do/c/muted/45/l/latest.json',
        urls: ['https://linux.do/c/muted/45/l/latest.json', 'https://linux.do/c/muted/45.json', 'https://linux.do/c/45/l/latest.json', 'https://linux.do/c/45.json'],
        categoryId: 45,
      },
      {
        kind: 'tag',
        key: 'tag:openai',
        label: 'OpenAI',
        url: 'https://linux.do/tag/OpenAI.json',
        urls: ['https://linux.do/tag/OpenAI.json'],
        tagName: 'OpenAI',
      },
    ])
  })

  it('normalizes topic list responses with tags and authors', () => {
    const topics = normalizeHomeSourceTopics(
      {
        users: [
          { id: 1, username: 'neo' },
          { id: 2, username: 'trinity' },
        ],
        topic_list: {
          topics: [
            {
              id: 101,
              slug: 'hello',
              title: 'hello',
              category_id: 77,
              tags: ['OpenAI', { name: 'ChatGPT' }],
              posters: [{ user_id: 1 }, { user_id: 2 }],
              created_at: '2026-03-28T00:00:00.000Z',
              bumped_at: '2026-03-28T01:00:00.000Z',
              like_count: 8,
              reply_count: 5,
              views: 100,
            },
          ],
        },
      },
      {
        kind: 'tag',
        key: 'tag:openai',
        label: 'OpenAI',
        url: 'https://linux.do/tag/OpenAI.json',
        urls: ['https://linux.do/tag/OpenAI.json'],
        tagName: 'OpenAI',
      }
    )

    expect(topics).toEqual([
      {
        id: 101,
        slug: 'hello',
        title: 'hello',
        categoryId: 77,
        tags: ['OpenAI', 'ChatGPT'],
        authorUsername: 'neo',
        createdAt: '2026-03-28T00:00:00.000Z',
        bumpedAt: '2026-03-28T01:00:00.000Z',
        likeCount: 8,
        replyCount: 5,
        views: 100,
        sourceKind: 'tag',
        sourceKey: 'tag:openai',
        sourceLabel: 'OpenAI',
      },
    ])
  })

  it('drops leaked topics that do not belong to the requested category or tag', () => {
    const taxonomy: Taxonomy = {
      version: 1,
      updatedAt: 1,
      categories: [
        { id: 4, name: '开发调优' },
        { id: 77, name: '深海幽域', parent_category_id: 4 },
        { id: 88, name: '纯水' },
      ],
      tags: [{ name: 'OpenAI', count: 10 }],
    }
    const topics: HomeSourceTopic[] = [
      {
        id: 1,
        slug: 'deep-ocean',
        title: 'deep-ocean',
        categoryId: 77,
        tags: ['OpenAI'],
        authorUsername: 'neo',
        createdAt: '2026-03-28T00:00:00.000Z',
        bumpedAt: '2026-03-28T01:00:00.000Z',
        likeCount: 0,
        replyCount: 0,
        views: 0,
        sourceKind: 'category',
        sourceKey: 'category:77',
        sourceLabel: '开发调优 / 深海幽域',
      },
      {
        id: 2,
        slug: 'wrong-category',
        title: 'wrong-category',
        categoryId: 88,
        tags: ['OpenAI'],
        authorUsername: 'trinity',
        createdAt: '2026-03-28T00:00:00.000Z',
        bumpedAt: '2026-03-28T02:00:00.000Z',
        likeCount: 0,
        replyCount: 0,
        views: 0,
        sourceKind: 'category',
        sourceKey: 'category:77',
        sourceLabel: '开发调优 / 深海幽域',
      },
      {
        id: 3,
        slug: 'wrong-tag',
        title: 'wrong-tag',
        categoryId: 77,
        tags: ['ChatGPT'],
        authorUsername: 'morpheus',
        createdAt: '2026-03-28T00:00:00.000Z',
        bumpedAt: '2026-03-28T03:00:00.000Z',
        likeCount: 0,
        replyCount: 0,
        views: 0,
        sourceKind: 'tag',
        sourceKey: 'tag:openai',
        sourceLabel: 'OpenAI',
      },
    ]

    expect(
      filterHomeSourceTopicsByRequest({
        topics,
        request: {
          kind: 'category',
          key: 'category:77',
          label: '开发调优 / 深海幽域',
          url: 'https://linux.do/c/muted/77/l/latest.json',
          urls: ['https://linux.do/c/muted/77/l/latest.json'],
          categoryId: 77,
        },
        taxonomy,
      }).map((topic) => topic.id)
    ).toEqual([1, 3])

    expect(
      filterHomeSourceTopicsByRequest({
        topics,
        request: {
          kind: 'tag',
          key: 'tag:openai',
          label: 'OpenAI',
          url: 'https://linux.do/tag/OpenAI.json',
          urls: ['https://linux.do/tag/OpenAI.json'],
          tagName: 'OpenAI',
        },
        taxonomy,
      }).map((topic) => topic.id)
    ).toEqual([1, 2])
  })

  it('selects only visible supplemented topics after filtering and dedupe', () => {
    const cfg: FilterConfig = {
      ...createBaseConfig(),
      categoriesExclude: [12],
      tagsExclude: ['spam'],
      blockedUsers: ['bad-user'],
    }
    const taxonomy: Taxonomy = {
      version: 1,
      updatedAt: 1,
      categories: [
        { id: 11, name: '纯水' },
        { id: 12, name: '深海幽域', parent_category_id: 11 },
      ],
      tags: [],
    }
    const topics: HomeSourceTopic[] = [
      {
        id: 1,
        slug: 'kept',
        title: 'kept',
        categoryId: 11,
        tags: ['safe'],
        authorUsername: 'neo',
        createdAt: '2026-03-28T00:00:00.000Z',
        bumpedAt: '2026-03-28T04:00:00.000Z',
        likeCount: 0,
        replyCount: 0,
        views: 0,
        sourceKind: 'category',
        sourceKey: 'category:11',
        sourceLabel: '纯水',
      },
      {
        id: 2,
        slug: 'native-duplicate',
        title: 'native-duplicate',
        categoryId: 11,
        tags: ['safe'],
        authorUsername: 'neo',
        createdAt: '2026-03-28T00:00:00.000Z',
        bumpedAt: '2026-03-28T05:00:00.000Z',
        likeCount: 0,
        replyCount: 0,
        views: 0,
        sourceKind: 'category',
        sourceKey: 'category:11',
        sourceLabel: '纯水',
      },
      {
        id: 3,
        slug: 'excluded-category',
        title: 'excluded-category',
        categoryId: 12,
        tags: ['safe'],
        authorUsername: 'neo',
        createdAt: '2026-03-28T00:00:00.000Z',
        bumpedAt: '2026-03-28T06:00:00.000Z',
        likeCount: 0,
        replyCount: 0,
        views: 0,
        sourceKind: 'category',
        sourceKey: 'category:12',
        sourceLabel: '深海幽域',
      },
      {
        id: 4,
        slug: 'excluded-tag',
        title: 'excluded-tag',
        categoryId: 11,
        tags: ['spam'],
        authorUsername: 'neo',
        createdAt: '2026-03-28T00:00:00.000Z',
        bumpedAt: '2026-03-28T07:00:00.000Z',
        likeCount: 0,
        replyCount: 0,
        views: 0,
        sourceKind: 'tag',
        sourceKey: 'tag:spam',
        sourceLabel: 'spam',
      },
      {
        id: 5,
        slug: 'blocked-author',
        title: 'blocked-author',
        categoryId: 11,
        tags: ['safe'],
        authorUsername: 'bad-user',
        createdAt: '2026-03-28T00:00:00.000Z',
        bumpedAt: '2026-03-28T08:00:00.000Z',
        likeCount: 0,
        replyCount: 0,
        views: 0,
        sourceKind: 'tag',
        sourceKey: 'tag:safe',
        sourceLabel: 'safe',
      },
    ]

    const selected = selectHomeSourceTopics({
      topics,
      existingTopicIds: [2],
      cfg,
      taxonomy,
      limit: 10,
    })

    expect(selected.map((topic) => topic.id)).toEqual([1])
  })
})

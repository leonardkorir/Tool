import { DOMParser } from 'linkedom'
import { describe, expect, it } from 'vitest'

import { parseTagsFromElement } from '../src/features/filter/filterFeature'
import { shouldShowTopic } from '../src/features/filter/rules'

function parseRoot(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(html, 'text/html') as unknown as Document
  return doc.querySelector('.topic-list-item') as HTMLElement
}

describe('filter list item parsing', () => {
  it('parses visible tag chips rendered as links, spans, and tag-* classes', () => {
    const el = parseRoot(`
      <div class="topic-list-item tag-%E7%BA%AF%E6%B0%B4">
        <div>
          <a class="discourse-tag" href="/tag/%E7%BA%AF%E6%B0%B4">纯水</a>
          <span class="simple-tag">公告</span>
          <span class="discourse-tag">快问快答</span>
        </div>
      </div>
    `)

    expect(parseTagsFromElement(el).sort()).toEqual(['公告', '快问快答', '纯水'])
  })

  it('parses non-link tags from data-tag-name nodes', () => {
    const el = parseRoot(`
      <div class="topic-list-item">
        <div>
          <span data-tag-name="纯水"></span>
          <span data-tag-name="公告">忽略这里的额外文本</span>
        </div>
      </div>
    `)

    expect(parseTagsFromElement(el).sort()).toEqual(['公告', '纯水'])
  })

  it('hides actual discourse topic rows when excluded tags are present', () => {
    const el = parseRoot(`
      <tr data-topic-id="1841950" class="topic-list-item category-gossip unseen-topic tag-纯水">
        <td class="main-link clearfix topic-list-data">
          <span class="link-top-line" role="heading" aria-level="2">
            <a href="https://linux.do/t/topic/1841950/1" data-topic-id="1841950" class="title raw-link raw-topic-link">
              <span dir="auto">今天刚拼了一个cc</span>
            </a>
          </span>
          <div class="link-bottom-line">
            <a class="badge-category__wrapper" href="https://linux.do/c/gossip/11">
              <span data-category-id="11" class="badge-category --style-icon">
                <span class="badge-category__name" dir="auto">搞七捻三</span>
              </span>
            </a>
            <ul class="discourse-tags" aria-label="标签">
              <li>
                <a
                  href="https://linux.do/tag/1461-tag/1461"
                  data-tag-name="纯水"
                  class="discourse-tag box discourse-tag--tag-icons-style"
                >
                  <span class="tag-icon"></span>纯水
                </a>
              </li>
            </ul>
          </div>
        </td>
      </tr>
    `)

    expect(parseTagsFromElement(el)).toEqual(['纯水'])
    expect(
      shouldShowTopic(
        {
          level: 'public',
          categoryId: 11,
          parentCategoryId: null,
          tags: parseTagsFromElement(el),
          authorUsername: null,
        },
        {
          enabled: true,
          mode: 'strict',
          levels: ['public', 'lv1', 'lv2', 'lv3'],
          categoriesInclude: [],
          categoriesExclude: [],
          tagsInclude: [],
          tagsExclude: ['纯水', '公告'],
          homeSourceEnabled: false,
          homeSourceCategories: [],
          homeSourceTags: [],
          homeSourceCollapsedByDefault: false,
          blockedUsers: [],
          showBlockedPostsInTopic: false,
          autoLoadMore: false,
        }
      )
    ).toBe(false)
  })
})

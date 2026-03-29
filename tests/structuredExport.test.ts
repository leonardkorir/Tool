import { DOMParser } from 'linkedom'
import { describe, expect, it } from 'vitest'

import {
  buildTopicExportJson,
  renderTopicMarkdown,
} from '../src/features/export/structured'
import type { TopicData } from '../src/features/export/types'

;(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser

function createTopicData(): TopicData {
  return {
    topic: {
      id: 123,
      title: '导出测试主题',
      slug: 'export-test',
      origin: 'https://linux.do',
      url: 'https://linux.do/t/export-test/123',
    },
    posts: [
      {
        id: 1,
        postNumber: 1,
        username: 'neo',
        name: 'Neo',
        avatarUrl: 'https://linux.do/avatar.png',
        createdAt: '2026-03-28T00:00:00.000Z',
        cookedHtml:
          '<p>Hello <strong>world</strong></p><pre><code>const x = 1\\n</code></pre><p><a href="https://example.com">link</a></p>',
        replyToPostNumber: null,
        onlineUrl: 'https://linux.do/t/export-test/123/1',
      },
      {
        id: 2,
        postNumber: 2,
        username: 'trinity',
        name: null,
        avatarUrl: null,
        createdAt: '2026-03-28T01:00:00.000Z',
        cookedHtml:
          '<blockquote><p>quoted</p></blockquote><ul><li>alpha</li><li>beta</li></ul><p><img src="https://linux.do/image.png" alt="demo" /></p>',
        replyToPostNumber: 1,
        onlineUrl: 'https://linux.do/t/export-test/123/2',
      },
    ],
  }
}

describe('structured export helpers', () => {
  it('builds topic export json with asset failure report', () => {
    const data = createTopicData()
    const json = buildTopicExportJson({
      data,
      exportedAt: '2026-03-28T02:00:00.000Z',
      assetFailures: [{ url: 'https://linux.do/broken.png', reason: 'http 404' }],
    })

    expect(json).toMatchObject({
      version: 1,
      kind: 'topic',
      topicId: 123,
      slug: 'export-test',
      postCount: 2,
      sourceUrl: 'https://linux.do/t/export-test/123',
      assetFailures: [{ url: 'https://linux.do/broken.png', reason: 'http 404' }],
    })
    expect(json.posts[0]).toMatchObject({
      id: 1,
      postNumber: 1,
      username: 'neo',
      name: 'Neo',
      onlineUrl: 'https://linux.do/t/export-test/123/1',
    })
  })

  it('renders markdown with headings, metadata, code blocks, and failure appendix', () => {
    const data = createTopicData()
    const markdown = renderTopicMarkdown({
      data,
      exportedAt: '2026-03-28T02:00:00.000Z',
      assetFailures: [{ url: 'https://linux.do/broken.png', reason: 'http 404' }],
    })

    expect(markdown).toContain('# 导出测试主题')
    expect(markdown).toContain('- 原始链接：https://linux.do/t/export-test/123')
    expect(markdown).toContain('## #1 · Neo')
    expect(markdown).toContain('## #2 · trinity')
    expect(markdown).toContain('```')
    expect(markdown).toContain('const x = 1')
    expect(markdown).toContain('[link](https://example.com)')
    expect(markdown).toContain('![demo](https://linux.do/image.png)')
    expect(markdown).toContain('## 资源内联失败')
    expect(markdown).toContain('原因：http 404')
  })
})

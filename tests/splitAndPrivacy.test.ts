import { describe, expect, it } from 'vitest'

import { splitTopicData } from '../src/features/export/splitExport'
import { renderCleanHtml } from '../src/features/export/templateClean'
import type { TopicData } from '../src/features/export/types'

describe('split export', () => {
  it('renders cross-segment reply-to links', () => {
    const data: TopicData = {
      topic: { id: 1, title: 't', slug: 'topic', origin: 'https://linux.do' },
      posts: [
        {
          id: 10,
          postNumber: 1,
          username: 'u1',
          name: null,
          avatarUrl: null,
          createdAt: '1970-01-01T00:00:00.000Z',
          cookedHtml: '<p>p1</p>',
          replyToPostNumber: null,
        },
        {
          id: 11,
          postNumber: 51,
          username: 'u2',
          name: null,
          avatarUrl: null,
          createdAt: '1970-01-01T00:00:00.000Z',
          cookedHtml: '<p>p2</p>',
          replyToPostNumber: 1,
        },
      ],
    }

    const { segments, postToFile } = splitTopicData(data, {
      enabled: true,
      size: 50,
      includeIndex: true,
      baseFileName: 'base',
    })

    expect(segments.length).toBe(2)
    const seg2 = segments[1]
    if (!seg2) throw new Error('missing segment 2')
    const linkFor = (postNumber: number) => {
      const file = postToFile.get(postNumber)
      if (!file) return `#post-${postNumber}`
      return file === seg2.fileName ? `#post-${postNumber}` : `${file}#post-${postNumber}`
    }

    const html = renderCleanHtml(
      { topic: data.topic, posts: seg2.posts },
      { exportedAt: '1970-01-01T00:00:00.000Z', linkForPostNumber: linkFor }
    )

    const first = segments[0]
    if (!first) throw new Error('missing segment 1')
    expect(html).toContain(`href="${first.fileName}#post-1"`)
  })
})

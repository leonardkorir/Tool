import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import type { DiscourseTopicJson } from '../src/platform/discourse/api'
import { normalizeTopicData } from '../src/features/export/transform'
import { renderCleanHtml } from '../src/features/export/templateClean'

function loadFixture(topicId: number): DiscourseTopicJson {
  const p = path.join(__dirname, 'fixtures', `topic_${topicId}.json`)
  return JSON.parse(fs.readFileSync(p, 'utf8')) as DiscourseTopicJson
}

describe('export template (clean)', () => {
  it('renders anchors and basic structure (topic_1550278)', () => {
    const topicJson = loadFixture(1550278)
    const data = normalizeTopicData({
      origin: 'https://linux.do',
      topicJson,
      posts: topicJson.post_stream.posts,
    })

    const html = renderCleanHtml(data, { exportedAt: '1970-01-01T00:00:00.000Z' })
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<title>')
    expect(html).toContain(
      `class="topic-title" href="https://linux.do/t/${topicJson.slug}/${topicJson.id}"`
    )

    const firstUserUrl = `https://linux.do/u/${encodeURIComponent(data.posts[0].username)}`
    expect(html).toContain(`class="author" href="${firstUserUrl}"`)
    expect(html).toContain(`class="avatar-link" href="${firstUserUrl}"`)

    for (const p of data.posts) {
      expect(html).toContain(`id="post-${p.postNumber}"`)
    }

    const withReply = data.posts.find((p) => p.replyToPostNumber != null)
    if (withReply?.replyToPostNumber != null) {
      expect(html).toContain(`href="#post-${withReply.replyToPostNumber}"`)
    }

    // v2 clean export intentionally removes the TOC to keep the HTML smaller and less noisy.
    expect(html).not.toContain('目录（最多 200 条）')

    // removed UI in clean mode
    expect(html).not.toContain('话题编号：')
    expect(html).not.toContain('导出时间：')
    expect(html).not.toContain('ld2-jump-form')
  })

  it('renders anchors and basic structure (topic_1428364)', () => {
    const topicJson = loadFixture(1428364)
    const data = normalizeTopicData({
      origin: 'https://linux.do',
      topicJson,
      posts: topicJson.post_stream.posts,
    })

    const html = renderCleanHtml(data, { exportedAt: '1970-01-01T00:00:00.000Z' })
    expect(html).toContain('<!doctype html>')
    expect(html).toContain(
      `class="topic-title" href="https://linux.do/t/${topicJson.slug}/${topicJson.id}"`
    )

    for (const p of data.posts) {
      expect(html).toContain(`id="post-${p.postNumber}"`)
    }
  })
})

import fs from 'node:fs'
import path from 'node:path'

import { DOMParser } from 'linkedom'
import { describe, expect, it } from 'vitest'

import type { DiscourseTopicJson } from '../src/platform/discourse/api'
import { injectOfflineInteractions } from '../src/features/export/domSnapshot'
import { normalizeTopicData } from '../src/features/export/transform'
import { renderCleanHtml } from '../src/features/export/templateClean'
import { renderUserActivityCleanHtml } from '../src/features/export/templateUserActivity'

function loadFixture(topicId: number): DiscourseTopicJson {
  const p = path.join(__dirname, 'fixtures', `topic_${topicId}.json`)
  return JSON.parse(fs.readFileSync(p, 'utf8')) as DiscourseTopicJson
}

function parseHtml(html: string): Document {
  // linkedom provides a lightweight DOM implementation for tests (vitest runs in node).
  return new DOMParser().parseFromString(html, 'text/html') as unknown as Document
}

describe('offline interactions injection', () => {
  it('injects required nodes into clean topic export', () => {
    const topicJson = loadFixture(1550278)
    const data = normalizeTopicData({
      origin: 'https://linux.do',
      topicJson,
      posts: topicJson.post_stream.posts,
    })

    const html = renderCleanHtml(data, { exportedAt: '1970-01-01T00:00:00.000Z' })
    expect(html).not.toContain('id="ld2-offline-script"')
    expect(html).not.toContain('id="ld2-lightbox"')
    expect(html).not.toContain('id="ld2-reply-preview"')

    const doc = parseHtml(html)
    injectOfflineInteractions(doc.documentElement as unknown as HTMLElement)

    expect(doc.getElementById('ld2-offline-style')).toBeTruthy()
    expect(doc.getElementById('ld2-offline-script')).toBeTruthy()
    expect(doc.getElementById('ld2-lightbox')).toBeTruthy()
    expect(doc.getElementById('ld2-reply-preview')).toBeTruthy()
  })

  it('injects required nodes into user activity export', () => {
    const html = renderUserActivityCleanHtml({
      title: '用户活动 @alice',
      origin: 'https://linux.do',
      pageUrl: 'https://linux.do/u/alice/activity',
      exportedAt: '1970-01-01T00:00:00.000Z',
      username: 'alice',
      items: [
        {
          id: '100',
          topicTitle: 'Hello',
          topicHref: null,
          categoryName: null,
          timeLabel: '',
          cookedHtml: '<p>Hi</p>',
        },
      ],
    })

    expect(html).not.toContain('id="ld2-offline-script"')
    expect(html).not.toContain('id="ld2-lightbox"')

    const doc = parseHtml(html)
    injectOfflineInteractions(doc.documentElement as unknown as HTMLElement)

    expect(doc.getElementById('ld2-offline-style')).toBeTruthy()
    expect(doc.getElementById('ld2-offline-script')).toBeTruthy()
    expect(doc.getElementById('ld2-lightbox')).toBeTruthy()
  })

  it('is idempotent (no duplicate nodes)', () => {
    const html = '<!doctype html><html><head></head><body><div class="cooked"></div></body></html>'
    const doc = parseHtml(html)
    const root = doc.documentElement as unknown as HTMLElement

    injectOfflineInteractions(root)
    injectOfflineInteractions(root)

    expect(doc.querySelectorAll('#ld2-offline-style').length).toBe(1)
    expect(doc.querySelectorAll('#ld2-offline-script').length).toBe(1)
    expect(doc.querySelectorAll('#ld2-lightbox').length).toBe(1)
    expect(doc.querySelectorAll('#ld2-reply-preview').length).toBe(1)
  })
})

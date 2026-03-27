import { describe, expect, it } from 'vitest'

import { renderUserActivityCleanHtml } from '../src/features/export/templateUserActivity'

describe('export template (user activity)', () => {
  it('renders basic structure and items', () => {
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
          topicHref: 'https://linux.do/t/hello/1',
          categoryName: 'General',
          timeLabel: '1970-01-01 00:00',
          cookedHtml: '<p>Hi</p>',
        },
        {
          id: '101',
          topicTitle: 'World',
          topicHref: null,
          categoryName: null,
          timeLabel: '',
          cookedHtml: '<p>Ok</p>',
        },
      ],
    })

    expect(html).toContain('<!doctype html>')
    expect(html).toContain('用户活动')
    expect(html).toContain('条目：2')
    expect(html).toContain('id="act-100"')
    expect(html).toContain('id="act-101"')
    expect(html).toContain('<div class="cooked"><p>Hi</p></div>')
  })
})

import { describe, expect, it } from 'vitest'

import { createDiscoursePlatform } from '../src/platform/discourse/platform'

describe('discourse route parsing', () => {
  it('parses topic id from linux.do topic urls', () => {
    const p = createDiscoursePlatform()

    expect(p.getRouteInfo('https://linux.do/t/topic/1550278').topicId).toBe(1550278)
    expect(p.getRouteInfo('https://linux.do/t/topic/1550278/12').topicId).toBe(1550278)
    expect(p.getRouteInfo('https://linux.do/t/1550278').topicId).toBe(1550278)
    expect(p.getRouteInfo('https://linux.do/t/1550278/12').topicId).toBe(1550278)
    expect(p.getRouteInfo('https://linux.do/t/some-slug/1550278').topicId).toBe(1550278)
    expect(p.getRouteInfo('https://linux.do/t/some-slug/1550278/12').topicId).toBe(1550278)
  })

  it('returns null topic id for non-topic urls', () => {
    const p = createDiscoursePlatform()
    expect(p.getRouteInfo('https://linux.do/latest').topicId).toBe(null)
    expect(p.getRouteInfo('https://linux.do/').topicId).toBe(null)
  })
})

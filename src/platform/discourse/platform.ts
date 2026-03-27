import type { DiscoursePlatform, DiscourseRouteInfo } from '../../app/types'

function parseTopicIdFromHref(href: string): number | null {
  try {
    const url = new URL(href)
    const p = url.pathname
    // linux.do 常见：
    // - /t/topic/<id>/<postNumber?>
    // - /t/<slug>/<id>/<postNumber?>
    // - /t/<id>/<postNumber?>
    let m = p.match(/^\/t\/(\d+)(?:\/\d+)?(?:\/)?$/)
    if (!m) m = p.match(/^\/t\/[^/]+\/(\d+)(?:\/\d+)?(?:\/)?$/)
    if (!m) return null
    const id = Number.parseInt(m[1] ?? '', 10)
    return Number.isFinite(id) ? id : null
  } catch {
    return null
  }
}

function parseUsernameFromPathname(pathname: string): string | null {
  const m = pathname.match(/^\/u\/([^/]+)(?:\/|$)/)
  return m?.[1] ?? null
}

function isUserActivityPath(pathname: string): boolean {
  return /^\/u\/[^/]+\/activity(?:\/.*)?\/?$/.test(pathname)
}

export function createDiscoursePlatform(): DiscoursePlatform {
  return {
    getRouteInfo(href = window.location.href): DiscourseRouteInfo {
      const url = new URL(href)
      const topicId = parseTopicIdFromHref(href)
      const username = parseUsernameFromPathname(url.pathname)
      const isUserActivity = isUserActivityPath(url.pathname)
      return {
        href,
        pathname: url.pathname,
        isTopic: topicId != null,
        topicId,
        isUserActivity,
        username: isUserActivity ? username : null,
      }
    },
  }
}

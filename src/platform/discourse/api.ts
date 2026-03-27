export type DiscoursePost = {
  id: number
  post_number: number
  username: string
  name?: string | null
  avatar_template?: string | null
  created_at: string
  cooked: string
  reply_to_post_number?: number | null
}

export type DiscourseTopicJson = {
  id: number
  title: string
  slug: string
  fancy_title?: string
  posts_count: number
  post_stream: {
    stream: number[]
    posts: DiscoursePost[]
  }
}

export class DiscourseApiError extends Error {
  readonly status: number | null
  readonly url: string

  constructor(message: string, options: { status: number | null; url: string }) {
    super(message)
    this.name = 'DiscourseApiError'
    this.status = options.status
    this.url = options.url
  }
}

async function tryFetchJsonOnlyIfCached<T>(
  url: string,
  options: { signal?: AbortSignal }
): Promise<T | null> {
  // only-if-cached is only allowed for same-origin requests; Discourse APIs here are always same-origin.
  try {
    const res = await fetch(url, {
      signal: options.signal,
      credentials: 'include',
      cache: 'only-if-cached',
      mode: 'same-origin',
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('application/json')) return null
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    return null
  }
}

async function fetchJsonCacheFirst<T>(url: string, options: { signal?: AbortSignal }): Promise<T> {
  const cached = await tryFetchJsonOnlyIfCached<T>(url, options)
  if (cached) return cached

  let res: Response
  try {
    res = await fetch(url, { signal: options.signal, credentials: 'include', cache: 'force-cache' })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    throw new DiscourseApiError(`network error`, { status: null, url })
  }

  if (!res.ok) {
    throw new DiscourseApiError(`http ${res.status}`, { status: res.status, url })
  }

  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    throw new DiscourseApiError(`unexpected content-type: ${ct}`, { status: res.status, url })
  }

  try {
    return (await res.json()) as T
  } catch {
    throw new DiscourseApiError(`invalid json`, { status: res.status, url })
  }
}

async function fetchFirstOkJson<T>(urls: string[], options: { signal?: AbortSignal }): Promise<T> {
  for (const url of urls) {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const cached = await tryFetchJsonOnlyIfCached<T>(url, options)
    if (cached) return cached
  }

  let lastErr: unknown = null
  for (const url of urls) {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    try {
      return await fetchJsonCacheFirst<T>(url, options)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      lastErr = err
    }
  }
  throw lastErr
}

export async function fetchTopicJson(options: {
  origin: string
  topicId: number
  slug: string
  signal?: AbortSignal
}): Promise<DiscourseTopicJson> {
  const { origin, topicId, slug, signal } = options
  return await fetchFirstOkJson<DiscourseTopicJson>(
    [
      `${origin}/t/${slug}/${topicId}.json`,
      `${origin}/t/${topicId}.json`,
      `${origin}/t/topic/${topicId}.json`,
    ],
    { signal }
  )
}

export async function fetchPostsByIds(options: {
  origin: string
  topicId: number
  slug: string
  postIds: number[]
  signal?: AbortSignal
}): Promise<DiscoursePost[]> {
  const { origin, topicId, slug, postIds, signal } = options
  const params = new URLSearchParams()
  for (const id of postIds) params.append('post_ids[]', String(id))
  const json = await fetchFirstOkJson<{
    post_stream?: { posts?: DiscoursePost[] }
    posts?: DiscoursePost[]
  }>(
    [
      `${origin}/t/${slug}/${topicId}/posts.json?${params.toString()}`,
      `${origin}/t/${topicId}/posts.json?${params.toString()}`,
      `${origin}/posts.json?${params.toString()}`,
    ],
    { signal }
  )
  if (json.post_stream?.posts) return json.post_stream.posts
  if (json.posts) return json.posts
  return []
}

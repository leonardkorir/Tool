// Keep this aligned with @types/tampermonkey to avoid type errors.
export type GmHttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE'

export type GmResponseType = 'json' | 'text' | 'blob' | 'arraybuffer'

export type GmRequestOptions = {
  method?: GmHttpMethod
  url: string
  headers?: Record<string, string>
  data?: string | Blob | ArrayBuffer | FormData
  responseType?: GmResponseType
  timeoutMs?: number
  // Tampermonkey uses `anonymous` (do NOT send cookies). Default: false.
  anonymous?: boolean
  signal?: AbortSignal
}

export type GmResponse<T> = {
  status: number
  statusText: string
  finalUrl: string
  headers: Record<string, string>
  response: T
  responseText: string
}

function abortError(): DOMException {
  return new DOMException('aborted', 'AbortError')
}

function parseResponseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const k = line.slice(0, idx).trim().toLowerCase()
    const v = line.slice(idx + 1).trim()
    if (!k) continue
    out[k] = v
  }
  return out
}

export async function gmRequest<T = unknown>(options: GmRequestOptions): Promise<GmResponse<T>> {
  if (options.signal?.aborted) throw abortError()
  if (typeof GM_xmlhttpRequest !== 'function') {
    throw new Error('GM_xmlhttpRequest is not available (missing @grant?)')
  }

  return await new Promise<GmResponse<T>>((resolve, reject) => {
    let finished = false

    const finishOnce = (fn: () => void) => {
      if (finished) return
      finished = true
      fn()
    }

    const req = GM_xmlhttpRequest({
      method: options.method ?? 'GET',
      url: options.url,
      headers: options.headers,
      data: options.data as never,
      responseType: (options.responseType ?? 'json') as never,
      timeout: options.timeoutMs,
      anonymous: options.anonymous ?? false,
      onload: (res) =>
        finishOnce(() =>
          resolve({
            status: res.status,
            statusText: res.statusText || '',
            finalUrl: res.finalUrl || options.url,
            headers: parseResponseHeaders(res.responseHeaders || ''),
            response: res.response as T,
            responseText: res.responseText || '',
          })
        ),
      onerror: (res) =>
        finishOnce(() =>
          reject(
            new Error(`GM_xmlhttpRequest error: ${res.status || 0} ${res.statusText || ''}`.trim())
          )
        ),
      ontimeout: () => finishOnce(() => reject(new Error('GM_xmlhttpRequest timeout'))),
      onabort: () => finishOnce(() => reject(abortError())),
    })

    const onAbort = () =>
      finishOnce(() => {
        try {
          req.abort()
        } catch {
          // ignore
        }
        reject(abortError())
      })

    options.signal?.addEventListener('abort', onAbort, { once: true })
  })
}

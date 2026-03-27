export function cleanUrlParamU(url: string, base: string): string {
  const raw = String(url ?? '').trim()
  if (!raw) return ''
  if (raw.startsWith('#')) return raw

  try {
    const u = new URL(raw, base)
    u.searchParams.delete('u')
    return u.toString()
  } catch {
    // Fallback: best-effort strip `u=...` query param without URL parsing.
    let out = raw
    out = out.replace(/([?&])u=[^&]*(&)?/g, (_m, sep: string, tail: string | undefined) =>
      tail ? sep : ''
    )
    out = out.replace(/\?&/g, '?')
    out = out.replace(/&&+/g, '&')
    out = out.replace(/[?&]$/g, '')
    return out
  }
}

export function hasUrlParamU(url: string): boolean {
  return /[?&]u=/.test(url)
}

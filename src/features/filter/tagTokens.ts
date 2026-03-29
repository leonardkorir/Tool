const NO_TAG_LABEL = '无标签'

export function isNoTagToken(raw: string): boolean {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
  return value === NO_TAG_LABEL || value === 'no_tag' || value === '__no_tag__'
}

export function canonicalTagKey(raw: string): string {
  const value = String(raw ?? '').trim()
  if (!value) return ''
  return (isNoTagToken(value) ? NO_TAG_LABEL : value).trim().toLowerCase()
}

export function canonicalTagName(raw: string): string {
  const value = String(raw ?? '').trim()
  if (!value) return ''
  return (isNoTagToken(value) ? NO_TAG_LABEL : value).trim()
}

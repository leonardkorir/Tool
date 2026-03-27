export function sanitizeFilename(input: string, options?: { maxLength?: number }): string {
  const maxLength = options?.maxLength ?? 80
  const cleaned = input
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return 'download'
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength).trim() : cleaned
}

import { injectOfflineInteractions } from './domSnapshot'

type ParsedDocumentLike = {
  documentElement: unknown
  getElementById(id: string): unknown
}

type DomParserLike = {
  parseFromString(input: string, mimeType: string): ParsedDocumentLike
}

export function applyOfflineInteractionsToHtml(
  html: string,
  parser: DomParserLike = new DOMParser()
): string {
  try {
    const doc = parser.parseFromString(html, 'text/html')
    const root = doc.documentElement as unknown as HTMLElement | null
    if (!root) return html

    injectOfflineInteractions(root)
    if (!doc.getElementById('ld2-offline-script') || !doc.getElementById('ld2-lightbox'))
      return html

    return `<!doctype html>\n${root.outerHTML}`
  } catch {
    return html
  }
}

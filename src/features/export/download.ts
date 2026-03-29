import { sanitizeFilename } from '../../shared/filename'

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('FileReader error'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(blob)
  })
}

async function downloadTextFile(options: {
  filename: string
  content: string
  mime: string
}): Promise<void> {
  const blob = new Blob([options.content], { type: options.mime })
  const url = URL.createObjectURL(blob)

  try {
    if (typeof GM_download === 'function') {
      const dataUrl = await blobToDataUrl(blob)
      await new Promise<void>((resolve, reject) => {
        GM_download({
          url: dataUrl,
          name: options.filename,
          onload: resolve,
          onerror: reject,
          ontimeout: () => reject(new Error('GM_download timeout')),
        })
      })
      return
    }

    const a = document.createElement('a')
    a.href = url
    a.download = options.filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    await new Promise((resolve) => setTimeout(resolve, 150))
  } catch (_err) {
    const a = document.createElement('a')
    a.href = url
    a.download = options.filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    await new Promise((resolve) => setTimeout(resolve, 150))
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 8000)
  }
}

export async function downloadHtml(options: { filenameBase: string; html: string }): Promise<void> {
  const name = sanitizeFilename(options.filenameBase)
  const filename = name.toLowerCase().endsWith('.html') ? name : `${name}.html`
  await downloadTextFile({ filename, content: options.html, mime: 'text/html;charset=utf-8' })
}

export async function downloadJson(options: {
  filenameBase: string
  json: unknown
}): Promise<void> {
  const name = sanitizeFilename(options.filenameBase)
  const filename = name.toLowerCase().endsWith('.json') ? name : `${name}.json`
  await downloadTextFile({
    filename,
    content: JSON.stringify(options.json, null, 2),
    mime: 'application/json;charset=utf-8',
  })
}

export async function downloadMarkdown(options: {
  filenameBase: string
  markdown: string
}): Promise<void> {
  const name = sanitizeFilename(options.filenameBase)
  const filename = name.toLowerCase().endsWith('.md') ? name : `${name}.md`
  await downloadTextFile({
    filename,
    content: options.markdown,
    mime: 'text/markdown;charset=utf-8',
  })
}

export function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {}
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value)
  return el
}

export function createButton(options: {
  text: string
  className?: string
  attrs?: Record<string, string>
}): HTMLButtonElement {
  const btn = createEl('button', options.attrs ?? {})
  btn.type = 'button'
  if (options.className) btn.className = options.className
  btn.textContent = options.text
  return btn
}

export function createSelect(options: { value: string; label: string }[]): HTMLSelectElement {
  const select = document.createElement('select')
  select.className = 'ld2-select'
  for (const option of options) {
    const el = document.createElement('option')
    el.value = option.value
    el.textContent = option.label
    select.appendChild(el)
  }
  return select
}

export function createCheckbox(): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'checkbox'
  return input
}

export function createNumberInput(options: {
  min: number
  max: number
  step: number
  widthPx: number
  placeholder?: string
}): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'number'
  input.min = String(options.min)
  input.max = String(options.max)
  input.step = String(options.step)
  input.style.width = `${options.widthPx}px`
  input.placeholder = options.placeholder ?? ''
  return input
}

export function createTextInput(
  options: { placeholder?: string; widthPx?: number; attrs?: Record<string, string> } = {}
): HTMLInputElement {
  const input = createEl('input', options.attrs ?? {})
  input.type = 'text'
  input.placeholder = options.placeholder ?? ''
  if (options.widthPx) input.style.width = `${options.widthPx}px`
  return input
}

export function createRow(options: {
  title: string
  sub?: string
  right: HTMLElement
  className?: string
}): HTMLDivElement {
  const row = document.createElement('div')
  row.className = options.className ? `ld2-row ${options.className}` : 'ld2-row'

  const left = document.createElement('div')
  left.className = 'left'

  const title = document.createElement('div')
  title.className = 'title'
  title.textContent = options.title

  left.appendChild(title)
  if (options.sub) {
    const sub = document.createElement('div')
    sub.className = 'sub'
    sub.textContent = options.sub
    left.appendChild(sub)
  }
  row.appendChild(left)
  row.appendChild(options.right)
  return row
}

export function createDetails(options: {
  summary: string
  open?: boolean
  content?: HTMLElement[]
}): HTMLDetailsElement {
  const details = document.createElement('details')
  details.open = !!options.open
  const summary = document.createElement('summary')
  summary.textContent = options.summary
  details.appendChild(summary)
  for (const child of options.content ?? []) details.appendChild(child)
  return details
}

export function createMetric(options: {
  label: string
  valueId?: string
  value?: string
}): HTMLDivElement {
  const box = document.createElement('div')
  box.className = 'ld2-metric'
  const k = document.createElement('div')
  k.className = 'k'
  k.textContent = options.label
  const v = document.createElement('div')
  v.className = 'v'
  if (options.valueId) v.id = options.valueId
  v.textContent = options.value ?? '-'
  box.appendChild(k)
  box.appendChild(v)
  return box
}

export function createProgressBlock(options: {
  label: string
  valueId: string
  barId: string
}): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.className = 'ld2-progress'

  const head = document.createElement('div')
  head.className = 'ld2-progress-head'

  const label = document.createElement('div')
  label.className = 'ld2-progress-label'
  label.textContent = options.label

  const value = document.createElement('div')
  value.className = 'ld2-progress-value'
  value.id = options.valueId
  value.textContent = '空闲'

  const track = document.createElement('div')
  track.className = 'ld2-progress-track'
  const bar = document.createElement('div')
  bar.className = 'ld2-progress-bar'
  bar.id = options.barId
  track.appendChild(bar)

  head.appendChild(label)
  head.appendChild(value)
  wrap.appendChild(head)
  wrap.appendChild(track)
  return wrap
}

export function createChip(options: {
  text: string
  tone?: 'default' | 'accent' | 'danger' | 'success'
  removable?: boolean
  onRemove?: () => void
}): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.className = `ld2-chip${options.tone ? ` ${options.tone}` : ''}`

  const label = document.createElement('span')
  label.textContent = options.text
  chip.appendChild(label)

  if (options.removable) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'ld2-chip-remove'
    btn.setAttribute('aria-label', `移除 ${options.text}`)
    btn.textContent = '×'
    if (options.onRemove) btn.addEventListener('click', options.onRemove)
    chip.appendChild(btn)
  }

  return chip
}

export function createSectionTitle(text: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'ld2-section-title'
  el.textContent = text
  return el
}

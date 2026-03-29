import type { AppContext, Feature } from '../../app/types'
import {
  createButton,
  createCheckbox,
  createDetails,
  createMetric,
  createNumberInput,
  createProgressBlock,
  createRow,
  createSelect,
} from '../ui/dom'
import {
  EXPORT_FULL_EVENT,
  EXPORT_QUICK_EVENT,
  NAVIGATE_TOPIC_HOME_EVENT,
  emitUiRefresh,
} from '../ui/events'
import { DiscourseApiError } from '../../platform/discourse/api'
import type { Disposable } from '../../shared/disposable'
import { toDisposable } from '../../shared/disposable'
import { sanitizeFilename } from '../../shared/filename'
import { startPassiveTopicPostCache, startPassiveUserActivityCache } from './domPassiveCache'
import { downloadHtml, downloadJson, downloadMarkdown } from './download'
import type { AssetInlineFailure, AssetInlineMetrics, AssetPolicy } from './assetPolicy'
import { inlineAssets } from './assetPolicy'
import { renderSplitIndexHtml, splitTopicData } from './splitExport'
import { loadTopicData } from './topicSource'
import type { DomScrollConfig, TopicLoadMetrics } from './topicSource'
import { renderCleanHtml } from './templateClean'
import type { TopicData } from './types'
import { collectUserActivityEntries } from './userActivity'
import { escapeHtml } from '../../shared/html'
import { getExportProgressValue } from './status'
import {
  buildTopicExportJson,
  renderTopicMarkdown,
  type ExportFileFormat,
} from './structured'

const FEATURE_ID = 'ld2-export'

type ExportPreset = 'current' | 'full'

function getEffectiveExportFormat(raw: string | ExportFileFormat): ExportFileFormat {
  return raw === 'markdown' || raw === 'json' ? raw : 'html'
}

function formatExportLabel(format: ExportFileFormat): string {
  if (format === 'markdown') return 'Markdown'
  if (format === 'json') return 'JSON'
  return 'HTML'
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id)
  if (el) el.textContent = text
  if (id === 'ld2-export-status') {
    const progressValue = document.getElementById('ld2-export-progress-value')
    const progressBar = document.getElementById('ld2-export-progress-bar') as HTMLElement | null
    if (progressValue) progressValue.textContent = text
    if (progressBar) progressBar.style.width = `${getExportProgressValue(text)}%`
  }
  emitUiRefresh()
}

function getSlugFromPathname(pathname: string): string | null {
  const m = pathname.match(/\/t\/([^/]+)\/\d+/)
  const slug = m?.[1] ?? null
  if (!slug) return null
  if (/^\d+$/.test(slug)) return 'topic'
  return slug
}

function routeTo(pathOrUrl: string): void {
  const raw = String(pathOrUrl || '').trim()
  if (!raw) return
  let u: URL
  try {
    u = new URL(raw, window.location.origin)
  } catch {
    return
  }
  const next = `${u.pathname}${u.search}${u.hash}`

  try {
    const g = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : globalThis) as unknown as {
      DiscourseURL?: unknown
    }
    const discourseUrl = (g as { DiscourseURL?: { routeTo?: (href: string) => void } }).DiscourseURL
    if (discourseUrl && typeof discourseUrl.routeTo === 'function') {
      discourseUrl.routeTo(next)
      return
    }
  } catch {
    // ignore
  }

  // Best effort: Discourse usually intercepts internal anchor clicks without full reload.
  try {
    const a = document.createElement('a')
    a.href = next
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    return
  } catch {
    // ignore
  }

  window.location.href = next
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  const n = Math.floor(value)
  return Math.min(max, Math.max(min, n))
}

function computeAdaptiveSplitSize(data: TopicData, baseSize: number): number {
  const posts = data.posts
  if (posts.length === 0) return clampInt(baseSize, 50, 5000, 500)

  // Try to keep each segment roughly under ~1.8MB (heuristic), then clamp to user value.
  let totalCooked = 0
  for (const p of posts) totalCooked += p.cookedHtml.length
  const avgCooked = totalCooked / Math.max(1, posts.length)
  const estPerPost = Math.max(800, avgCooked + 240)
  const target = 1_800_000
  const recommended = clampInt(Math.floor((target - 30_000) / estPerPost), 50, 5000, 500)
  const desired = clampInt(baseSize, 50, 5000, 500)
  return desired > recommended ? recommended : desired
}

function applyOfflineInteractions(html: string): string {
  return html
}

function formatError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') return '已取消'
  if (err instanceof DiscourseApiError) {
    if (err.status === 403) return '权限不足/需要登录（HTTP 403）'
    if (err.status === 404) return '话题不存在或无权限（HTTP 404）'
    if (err.status === 429) return '请求过于频繁，请稍后重试（HTTP 429）'
    if (err.status == null) return '网络错误'
    return `请求失败（HTTP ${err.status}）`
  }
  if (err && typeof err === 'object') {
    const maybe = err as { error?: unknown; message?: unknown }
    if (typeof maybe.error === 'string' && maybe.error) return `下载失败：${maybe.error}`
    if (typeof maybe.message === 'string' && maybe.message) return maybe.message
  }
  if (err instanceof Error) return err.message
  return '未知错误'
}

async function downloadAssetFailureReport(options: {
  filenameBase: string
  exportedAt: string
  title: string
  sourceUrl: string
  failures: AssetInlineFailure[]
}): Promise<void> {
  if (options.failures.length === 0) return
  await downloadJson({
    filenameBase: `${options.filenameBase}_assets-report`,
    json: {
      version: 1,
      exportedAt: options.exportedAt,
      title: options.title,
      sourceUrl: options.sourceUrl,
      failureCount: options.failures.length,
      failures: options.failures,
    },
  })
}

async function downloadCleanExport(options: {
  format: ExportFileFormat
  filenameBase: string
  data: TopicData
  exportedAt: string
  assetFailures: AssetInlineFailure[]
}): Promise<void> {
  if (options.format === 'json') {
    await downloadJson({
      filenameBase: options.filenameBase,
      json: buildTopicExportJson({
        data: options.data,
        exportedAt: options.exportedAt,
        assetFailures: options.assetFailures,
      }),
    })
    return
  }

  if (options.format === 'markdown') {
    await downloadMarkdown({
      filenameBase: options.filenameBase,
      markdown: renderTopicMarkdown({
        data: options.data,
        exportedAt: options.exportedAt,
        assetFailures: options.assetFailures,
      }),
    })
    return
  }

  const html = applyOfflineInteractions(
    renderCleanHtml(options.data, { exportedAt: options.exportedAt })
  )
  await downloadHtml({ filenameBase: options.filenameBase, html })
}

export function exportFeature(): Feature {
  return {
    id: FEATURE_ID,
    mount(ctx: AppContext) {
      const controls = document.getElementById('ld2-export-controls')
      if (!controls) {
        ctx.logger.warn('export ui missing: #ld2-export-controls')
        return
      }

      controls.classList.add('ld2-export')

      const configRow = document.createElement('div')
      configRow.className = 'stack vertical'
      configRow.style.gap = '8px'

      const formatSelect = createSelect([
        { value: 'html', label: 'HTML' },
        { value: 'markdown', label: 'Markdown' },
        { value: 'json', label: 'JSON' },
      ])
      formatSelect.setAttribute('aria-label', '导出格式')

      const networkDelayInput = createNumberInput({
        min: 0,
        max: 10_000,
        step: 50,
        widthPx: 110,
        placeholder: '毫秒',
      })
      networkDelayInput.setAttribute('aria-label', '联网补齐间隔')

      const splitCheckbox = createCheckbox()
      const splitSizeInput = createNumberInput({
        min: 50,
        max: 5000,
        step: 50,
        widthPx: 110,
        placeholder: '每段楼层',
      })
      splitSizeInput.setAttribute('aria-label', '分段导出每段楼层')

      const scrollStepInput = createNumberInput({
        min: 50,
        max: 5000,
        step: 10,
        widthPx: 110,
        placeholder: '像素',
      })
      const scrollDelayInput = createNumberInput({
        min: 0,
        max: 60_000,
        step: 50,
        widthPx: 110,
        placeholder: '毫秒',
      })
      const scrollCollectIntervalInput = createNumberInput({
        min: 0,
        max: 10_000,
        step: 20,
        widthPx: 110,
        placeholder: '毫秒',
      })
      const scrollStableInput = createNumberInput({
        min: 1,
        max: 60,
        step: 1,
        widthPx: 110,
        placeholder: '次数',
      })
      const scrollMaxCountInput = createNumberInput({
        min: 50,
        max: 20_000,
        step: 50,
        widthPx: 110,
        placeholder: '次数',
      })

      const splitControls = document.createElement('div')
      splitControls.className = 'stack'
      splitControls.style.gap = '10px'
      const splitToggle = document.createElement('label')
      splitToggle.style.display = 'flex'
      splitToggle.style.alignItems = 'center'
      splitToggle.style.gap = '8px'
      splitToggle.appendChild(splitCheckbox)
      splitToggle.appendChild(document.createTextNode('开启'))
      splitControls.appendChild(splitToggle)
      splitControls.appendChild(splitSizeInput)

      configRow.appendChild(
        createRow({
          title: '导出格式',
          right: formatSelect,
        })
      )
      configRow.appendChild(
        createRow({
          title: '联网补齐间隔',
          right: networkDelayInput,
        })
      )
      configRow.appendChild(
        createRow({
          title: '分段导出',
          right: splitControls,
        })
      )

      const scrollWrap = document.createElement('div')
      scrollWrap.className = 'stack vertical'
      scrollWrap.style.marginTop = '10px'
      scrollWrap.appendChild(
        createRow({ title: '步长', right: scrollStepInput })
      )
      scrollWrap.appendChild(
        createRow({ title: '间隔', right: scrollDelayInput })
      )
      scrollWrap.appendChild(
        createRow({
          title: '采样间隔',
          right: scrollCollectIntervalInput,
        })
      )
      scrollWrap.appendChild(
        createRow({
          title: '稳定阈值',
          right: scrollStableInput,
        })
      )
      scrollWrap.appendChild(
        createRow({
          title: '最大次数',
          right: scrollMaxCountInput,
        })
      )
      const scrollDetails = createDetails({ summary: '滚动', content: [scrollWrap] })
      scrollDetails.style.marginTop = '2px'

      const optionsDetails = createDetails({ summary: '设置', content: [configRow] })
      optionsDetails.open = false

      const metricsWrap = document.createElement('div')
      metricsWrap.className = 'ld2-export-metrics'

      const metricsTitle = document.createElement('div')
      metricsTitle.className = 'ld2-section-title'
      metricsTitle.textContent = '概览'

      const metricsGrid = document.createElement('div')
      metricsGrid.className = 'ld2-metrics'
      metricsGrid.appendChild(createMetric({ label: '模式', valueId: 'ld2-export-metric-mode' }))
      metricsGrid.appendChild(createMetric({ label: '分段', valueId: 'ld2-export-metric-split' }))
      metricsGrid.appendChild(createMetric({ label: '资源', valueId: 'ld2-export-metric-inline' }))
      metricsGrid.appendChild(
        createMetric({ label: '缓存/网络', valueId: 'ld2-export-metric-cache' })
      )
      metricsWrap.appendChild(metricsTitle)
      metricsWrap.appendChild(metricsGrid)

      const metricModeEl = metricsWrap.querySelector<HTMLElement>('#ld2-export-metric-mode')
      const metricSplitEl = metricsWrap.querySelector<HTMLElement>('#ld2-export-metric-split')
      const metricInlineEl = metricsWrap.querySelector<HTMLElement>('#ld2-export-metric-inline')
      const metricCacheEl = metricsWrap.querySelector<HTMLElement>('#ld2-export-metric-cache')

      const progressWrap = createProgressBlock({
        label: '进度',
        valueId: 'ld2-export-progress-value',
        barId: 'ld2-export-progress-bar',
      })
      const progressValueEl = progressWrap.querySelector<HTMLElement>('#ld2-export-progress-value')
      const progressBarEl = progressWrap.querySelector<HTMLElement>('#ld2-export-progress-bar')

      const quickActionsCard = document.createElement('div')
      quickActionsCard.className = 'ld2-summary-card'

      type ExportUiMetrics = {
        format: ExportFileFormat
        preset: ExportPreset
        routeKind: 'topic' | 'activity'
        splitEnabled: boolean
        splitSegments: number | null
        collected: number | null
        topicLoad: TopicLoadMetrics | null
        assetInline: AssetInlineMetrics | null
        assetFailures: AssetInlineFailure[]
      }

      let lastRun: ExportUiMetrics | null = null

      const setProgress = (value: number, label: string): void => {
        if (progressBarEl) progressBarEl.style.width = `${Math.max(0, Math.min(100, value))}%`
        if (progressValueEl) progressValueEl.textContent = label
      }

      const updateProgressFromStatus = (text: string): void => {
        if (/失败/.test(text)) {
          setProgress(100, text)
          return
        }
        if (/完成/.test(text)) {
          setProgress(100, text)
          return
        }
        if (/已停止|已取消/.test(text)) {
          setProgress(0, text)
          return
        }
        if (/准备中/.test(text)) {
          setProgress(8, text)
          return
        }
        if (/抓取中/.test(text)) {
          setProgress(28, text)
          return
        }
        if (/脱敏/.test(text)) {
          setProgress(48, text)
          return
        }
        if (/资源内联/.test(text)) {
          setProgress(66, text)
          return
        }
        if (/生成中/.test(text)) {
          setProgress(82, text)
          return
        }
        if (/下载中/.test(text)) {
          setProgress(94, text)
          return
        }
        setProgress(0, text || '空闲')
      }

      updateProgressFromStatus('空闲')

      const setMetric = (el: HTMLElement | null, text: string): void => {
        if (el) el.textContent = text
      }

      const settingsArea = document.createElement('div')
      settingsArea.className = 'stack vertical'
      settingsArea.style.gap = '8px'
      settingsArea.appendChild(optionsDetails)
      settingsArea.appendChild(scrollDetails)

      const exportCurrentBtn = createButton({
        text: '当前',
        className: 'btn',
        attrs: { id: 'ld2-export-current' },
      })

      const exportFullBtn = createButton({
        text: '完整',
        className: 'btn primary',
        attrs: { id: 'ld2-export-full' },
      })

      const cancelBtn = createButton({
        text: '取消',
        className: 'btn danger',
        attrs: { id: 'ld2-export-cancel' },
      })
      cancelBtn.disabled = true

      const actionsRow = document.createElement('div')
      actionsRow.className = 'ld2-export-actions'
      actionsRow.appendChild(exportFullBtn)
      actionsRow.appendChild(exportCurrentBtn)
      quickActionsCard.appendChild(actionsRow)

      const stopRow = document.createElement('div')
      stopRow.className = 'ld2-export-stop'
      stopRow.hidden = true
      stopRow.appendChild(cancelBtn)
      quickActionsCard.appendChild(stopRow)

      const footer = document.createElement('div')
      footer.className = 'ld2-export-footer'
      footer.hidden = true

      const exportLayout = document.createElement('div')
      exportLayout.className = 'ld2-export-layout'
      exportLayout.appendChild(progressWrap)
      exportLayout.appendChild(quickActionsCard)
      exportLayout.appendChild(metricsWrap)
      exportLayout.appendChild(settingsArea)

      controls.appendChild(exportLayout)

      // Insert footer into the dedicated container outside .ld2-card so sticky works correctly
      const footerContainer = document.getElementById('ld2-export-footer-container')
      if (footerContainer) {
        footerContainer.appendChild(footer)
      } else {
        // Fallback: insert into controls if container not found
        controls.appendChild(footer)
      }

      const exportTabpanel = controls.closest(
        '.ld2-tabpanel[data-panel="export"]'
      ) as HTMLElement | null
      const exportScrollEl = controls.closest<HTMLElement>('.ld2-card') ?? null

      const isExportUiVisible = (): boolean => {
        const panel = document.getElementById('ld2-panel')
        const panelOpen = panel != null && panel.getAttribute('data-open') === 'true'
        if (!panelOpen) return false
        if (!exportTabpanel) return true
        if (exportTabpanel.hasAttribute('hidden')) return false
        return exportTabpanel.getClientRects().length > 0
      }

      const scrollExportToAlignTop = (el: HTMLElement, topOffsetPx = 8): void => {
        if (!exportScrollEl) return
        if (!isExportUiVisible()) return
        const containerRect = exportScrollEl.getBoundingClientRect()
        const elRect = el.getBoundingClientRect()
        const delta = elRect.top - containerRect.top
        if (!Number.isFinite(delta)) return
        const next = exportScrollEl.scrollTop + delta - topOffsetPx
        exportScrollEl.scrollTop = Math.max(0, next)
      }

      const ensureInView = (el: HTMLElement, bottomOffsetPx = 8): void => {
        if (!exportScrollEl) return
        if (!isExportUiVisible()) return
        const containerRect = exportScrollEl.getBoundingClientRect()
        const elRect = el.getBoundingClientRect()
        const safeBottom = containerRect.bottom - bottomOffsetPx
        const over = elRect.bottom - safeBottom
        if (over > 0) exportScrollEl.scrollTop += over
      }

      const maybeAutoScrollToOptions = (): void => {
        if (!exportScrollEl) return
        // Only adjust when the export panel is at (or near) the top.
        if (exportScrollEl.scrollTop > 8) return
        scrollExportToAlignTop(optionsDetails, 8)
      }

      const syncFooterSpacerOnce = (): boolean => {
        // Footer is now outside .ld2-card, so sticky works correctly.
        // No need to add paddingBottom spacer anymore.
        // Just clear any legacy padding that might have been set.
        if (settingsArea.style.paddingBottom) {
          settingsArea.style.paddingBottom = ''
        }
        return true
      }

      let footerSpacerRafId: number | null = null
      let footerSpacerRetryLeft = 0
      const queueFooterSpacerSync = (): void => {
        if (footerSpacerRafId != null) return
        footerSpacerRafId = window.requestAnimationFrame(() => {
          footerSpacerRafId = null
          const ok = syncFooterSpacerOnce()
          if (ok) return
          if (!isExportUiVisible()) return
          if (footerSpacerRetryLeft <= 0) return
          footerSpacerRetryLeft -= 1
          queueFooterSpacerSync()
        })
      }

      const scheduleFooterSpacerSync = (reason: string): void => {
        void reason
        footerSpacerRetryLeft = 10
        queueFooterSpacerSync()
      }

      let footerSpacerRo: ResizeObserver | null = null
      let panelOpenMo: MutationObserver | null = null
      let tabShowMo: MutationObserver | null = null
      const onWindowResize = () => scheduleFooterSpacerSync('resize')
      window.addEventListener('resize', onWindowResize)
      scheduleFooterSpacerSync('init')
      if (typeof ResizeObserver !== 'undefined') {
        footerSpacerRo = new ResizeObserver(() => scheduleFooterSpacerSync('footer-resize'))
        footerSpacerRo.observe(footer)
      }

      const panelEl = document.getElementById('ld2-panel')
      if (panelEl && typeof MutationObserver !== 'undefined') {
        let wasOpen = panelEl.getAttribute('data-open') === 'true'
        panelOpenMo = new MutationObserver(() => {
          const isOpen = panelEl.getAttribute('data-open') === 'true'
          if (isOpen && !wasOpen) {
            scheduleFooterSpacerSync('panel-open')
            window.requestAnimationFrame(() => maybeAutoScrollToOptions())
          }
          wasOpen = isOpen
        })
        panelOpenMo.observe(panelEl, { attributes: true, attributeFilter: ['data-open'] })
      }

      if (exportTabpanel && typeof MutationObserver !== 'undefined') {
        let wasHidden = exportTabpanel.hasAttribute('hidden')
        tabShowMo = new MutationObserver(() => {
          const isHidden = exportTabpanel.hasAttribute('hidden')
          if (!isHidden && wasHidden) {
            scheduleFooterSpacerSync('tab-show')
            window.requestAnimationFrame(() => maybeAutoScrollToOptions())
          }
          wasHidden = isHidden
        })
        tabShowMo.observe(exportTabpanel, { attributes: true, attributeFilter: ['hidden'] })
      }

      const onDetailsToggle = (e: Event) => {
        const d = e.currentTarget
        if (!(d instanceof HTMLDetailsElement)) return
        scheduleFooterSpacerSync('details-toggle')
        if (!d.open) return
        window.requestAnimationFrame(() => {
          if (d === scrollDetails) {
            // Prefer the "options + scroll params" layout when opening scroll parameters.
            scrollExportToAlignTop(optionsDetails.open ? scrollDetails : optionsDetails, 8)
          }
          ensureInView(d, 8)
        })
      }
      optionsDetails.addEventListener('toggle', onDetailsToggle)
      scrollDetails.addEventListener('toggle', onDetailsToggle)

      let controller: AbortController | null = null

      let passiveCacheSub: Disposable | null = null
      let passiveKind: 'topic' | 'activity' | null = null
      let passiveTopicId: number | null = null
      let passiveUsername: string | null = null

      function syncPassiveCache(href = window.location.href): void {
        const r = ctx.discourse.getRouteInfo(href)
        if (r.isTopic && r.topicId) {
          if (passiveKind !== 'topic' || passiveTopicId !== r.topicId) {
            passiveCacheSub?.dispose()
            passiveCacheSub = startPassiveTopicPostCache({ topicId: r.topicId })
            passiveKind = 'topic'
            passiveTopicId = r.topicId
            passiveUsername = null
          }
          return
        }

        if (r.isUserActivity) {
          const u = r.username || null
          if (passiveKind !== 'activity' || passiveUsername !== u) {
            passiveCacheSub?.dispose()
            passiveCacheSub = startPassiveUserActivityCache({ username: u })
            passiveKind = 'activity'
            passiveUsername = u
            passiveTopicId = null
          }
          return
        }

        passiveCacheSub?.dispose()
        passiveCacheSub = null
        passiveKind = null
        passiveTopicId = null
        passiveUsername = null
      }

      const KEY_FORMAT = 'export.format'
      const KEY_NETWORK_DELAY = 'export.network.delayMs'
      const KEY_INLINE_DELAY_COMPAT = 'export.inline.delayMs'
      const KEY_ASSET_POLICY = 'export.assetPolicy'
      const KEY_CACHE_ONLY = 'export.inline.cacheOnly'
      const KEY_SCROLL_CFG = 'export.scroll.config'
      const KEY_SPLIT_ENABLED = 'export.split.enabled'
      const KEY_SPLIT_SIZE = 'export.split.size'

      function readConfig(): {
        format: ExportFileFormat
        scrollConfig: DomScrollConfig
        networkDelayMs: number
        assetPolicy: AssetPolicy
        cacheOnly: boolean
        splitEnabled: boolean
        splitSize: number
      } {
        const formatRaw = String(ctx.storage.get(KEY_FORMAT, 'html') || 'html')
        const networkDelayMs = Number(
          ctx.storage.get(KEY_NETWORK_DELAY, ctx.storage.get(KEY_INLINE_DELAY_COMPAT, 800)) ?? 800
        )
        const assetPolicyRaw = String(ctx.storage.get(KEY_ASSET_POLICY, 'images') || 'images')
        const cacheOnly = !!ctx.storage.get(KEY_CACHE_ONLY, true)

        const scrollCfgRaw = ctx.storage.get(KEY_SCROLL_CFG, null as unknown)
        const scrollCfg =
          scrollCfgRaw && typeof scrollCfgRaw === 'object'
            ? (scrollCfgRaw as Record<string, unknown>)
            : ({} as Record<string, unknown>)

        const splitEnabled = !!ctx.storage.get(KEY_SPLIT_ENABLED, false)
        const splitSize = Number(ctx.storage.get(KEY_SPLIT_SIZE, 500))

        const stepPx = Number(scrollCfg.stepPx)
        const delayMs = Number(scrollCfg.delayMs)
        const stableThreshold = Number(scrollCfg.stableThreshold)
        const maxScrollCount = Number(scrollCfg.maxScrollCount)
        const collectIntervalMs = Number(scrollCfg.collectIntervalMs)

        // v1 parity: full export should always start from top (we restore scroll position afterwards).
        const scrollToTop = true

        return {
          format: getEffectiveExportFormat(formatRaw as ExportFileFormat),
          assetPolicy:
            assetPolicyRaw === 'none' || assetPolicyRaw === 'all' ? assetPolicyRaw : 'images',
          cacheOnly,
          scrollConfig: {
            stepPx: Number.isFinite(stepPx) ? clampInt(stepPx, 50, 5000, 400) : 400,
            delayMs: Number.isFinite(delayMs) ? clampInt(delayMs, 0, 60_000, 2500) : 2500,
            stableThreshold: Number.isFinite(stableThreshold)
              ? clampInt(stableThreshold, 1, 60, 8)
              : 8,
            maxScrollCount: Number.isFinite(maxScrollCount)
              ? clampInt(maxScrollCount, 50, 20_000, 1000)
              : 1000,
            collectIntervalMs: Number.isFinite(collectIntervalMs)
              ? clampInt(collectIntervalMs, 0, 10_000, 300)
              : 300,
            scrollToTop,
          },
          networkDelayMs: clampInt(networkDelayMs, 0, 10_000, 800),
          splitEnabled,
          splitSize: Number.isFinite(splitSize) ? clampInt(splitSize, 50, 5000, 500) : 500,
        }
      }

      function syncConfigUiFromStore(): void {
        const c = readConfig()
        formatSelect.value = c.format
        networkDelayInput.value = String(c.networkDelayMs)
        splitCheckbox.checked = c.splitEnabled
        splitSizeInput.value = String(c.splitSize)

        scrollStepInput.value = String(c.scrollConfig.stepPx)
        scrollDelayInput.value = String(c.scrollConfig.delayMs)
        scrollCollectIntervalInput.value = String(c.scrollConfig.collectIntervalMs)
        scrollStableInput.value = String(c.scrollConfig.stableThreshold)
        scrollMaxCountInput.value = String(c.scrollConfig.maxScrollCount)

        splitSizeInput.disabled = !c.splitEnabled
        formatSelect.disabled = false
      }

      function persistConfigFromUi(): void {
        ctx.storage.set('export.template', 'clean')
        ctx.storage.set(KEY_FORMAT, getEffectiveExportFormat(formatSelect.value as ExportFileFormat))
        ctx.storage.set(KEY_NETWORK_DELAY, Number.parseInt(networkDelayInput.value, 10) || 0)

        ctx.storage.set(KEY_SPLIT_ENABLED, splitCheckbox.checked)
        ctx.storage.set(KEY_SPLIT_SIZE, Number.parseInt(splitSizeInput.value, 10) || 500)

        const scrollCfg: DomScrollConfig = {
          stepPx: Number.parseInt(scrollStepInput.value, 10) || 400,
          delayMs: Number.parseInt(scrollDelayInput.value, 10) || 2500,
          stableThreshold: Number.parseInt(scrollStableInput.value, 10) || 8,
          maxScrollCount: Number.parseInt(scrollMaxCountInput.value, 10) || 1000,
          collectIntervalMs: Number.parseInt(scrollCollectIntervalInput.value, 10) || 300,
          scrollToTop: true,
        }
        ctx.storage.set(KEY_SCROLL_CFG, scrollCfg)

        splitSizeInput.disabled = !splitCheckbox.checked
        formatSelect.disabled = false
      }

      function updateEnabled(href = window.location.href): void {
        const route = ctx.discourse.getRouteInfo(href)
        const isBusy = controller != null
        const format = getEffectiveExportFormat(formatSelect.value as ExportFileFormat)

        exportCurrentBtn.disabled = !(route.isTopic || route.isUserActivity) || isBusy
        exportFullBtn.disabled = !(route.isTopic || route.isUserActivity) || isBusy
        cancelBtn.disabled = controller == null
        // Show either export actions or the single cancel action.
        actionsRow.hidden = isBusy
        stopRow.hidden = !isBusy

        formatSelect.disabled = isBusy
        networkDelayInput.disabled = isBusy

        splitCheckbox.disabled = isBusy || !route.isTopic || format !== 'html'
        splitSizeInput.disabled =
          isBusy || !route.isTopic || !splitCheckbox.checked || format !== 'html'

        scrollStepInput.disabled = isBusy
        scrollDelayInput.disabled = isBusy
        scrollCollectIntervalInput.disabled = isBusy
        scrollStableInput.disabled = isBusy
        scrollMaxCountInput.disabled = isBusy

        scheduleFooterSpacerSync('update-enabled')
      }

      function updateMetricsView(href = window.location.href): void {
        const route = ctx.discourse.getRouteInfo(href)
        const cfg = readConfig()
        const format = getEffectiveExportFormat(formatSelect.value as ExportFileFormat)

        const pageLabel = route.isTopic
          ? `话题${route.topicId ? ` #${route.topicId}` : ''}`
          : route.isUserActivity
            ? `活动${route.username ? ` @${route.username}` : ''}`
            : '当前页面'
        const lastLabel = lastRun
          ? `｜上次：${lastRun.preset === 'full' ? '完整' : '当前'}·${formatExportLabel(lastRun.format)}`
          : ''
        setMetric(
          metricModeEl,
          `${pageLabel}｜简洁（数据化）｜${formatExportLabel(format)}｜资源 ${cfg.assetPolicy}｜${cfg.cacheOnly ? '仅缓存' : '可联网'}｜间隔 ${cfg.networkDelayMs}ms${lastLabel}`
        )

        if (!route.isTopic) {
          setMetric(metricSplitEl, '活动页不支持分段')
        } else {
          let txt =
            format !== 'html'
              ? '分段：仅 HTML 导出支持'
              : cfg.splitEnabled
                ? `分段：开启（${cfg.splitSize} 楼/段）`
                : '分段：关闭'
          if (lastRun?.routeKind === 'topic') {
            if (lastRun.splitSegments != null || lastRun.collected != null) {
              const seg = lastRun.splitSegments != null ? `${lastRun.splitSegments}` : '?'
              const cnt = lastRun.collected != null ? `${lastRun.collected}` : '?'
              txt += `｜上次 ${seg} 段 · ${cnt} 楼`
            }
          }
          setMetric(metricSplitEl, txt)
        }

        const inlineTxt = (() => {
          if (!lastRun) return '-'
          const m = lastRun.assetInline
          if (!m) return '-'
          return `内联 ${m.inlined}/${m.discovered} · 失败 ${m.failed}${lastRun.assetFailures.length > 0 ? ' · 已产出报告' : ''}`
        })()
        setMetric(metricInlineEl, inlineTxt)

        const cacheTxt = (() => {
          if (!lastRun) return '-'
          if (lastRun.topicLoad) {
            const t = lastRun.topicLoad
            const dom = `${t.fromRenderedDom}`
            const passive = `${t.fromPassiveCache}`
            const api = `${t.fetchedFromApi}`
            const missing = `${t.remainingMissing}`
            return `页面 ${dom} + 缓存 ${passive} + 接口 ${api}｜缺失 ${missing}`
          }
          const m = lastRun.assetInline
          if (m) return `缓存 ${m.cacheOnlyHits} · 网络 ${m.netOk} · 脚本 ${m.gmOk}`
          return '-'
        })()
        setMetric(metricCacheEl, cacheTxt)
      }

      async function onExport(preset: ExportPreset): Promise<void> {
        if (controller) return
        const route = ctx.discourse.getRouteInfo()
        if (!route.isTopic && !route.isUserActivity) return

        controller = new AbortController()
        updateEnabled()
        setText('ld2-export-status', preset === 'current' ? '准备中…（当前）' : '准备中…（完整）')

        const origin = window.location.origin
        const slug = getSlugFromPathname(route.pathname) ?? 'topic'

        try {
          persistConfigFromUi()
          const config = readConfig()
          const format = getEffectiveExportFormat(config.format)

          lastRun = {
            format,
            preset,
            routeKind: route.isUserActivity ? 'activity' : 'topic',
            splitEnabled: !!(config.splitEnabled && route.isTopic),
            splitSegments: null,
            collected: null,
            topicLoad: null,
            assetInline: null,
            assetFailures: [],
          }
          updateMetricsView()

          if (route.isUserActivity) {
            const exportedAt = new Date().toISOString()
            setText(
              'ld2-export-status',
              preset === 'full'
                ? '活动页简洁导出（自动滚动收集）…'
                : '活动页简洁导出（仅当前/缓存）…'
            )
            const entries = await collectUserActivityEntries({
              origin,
              username: route.username,
              mode: preset === 'full' ? 'scroll' : 'visible',
              signal: controller.signal,
              scrollConfig: config.scrollConfig,
              onProgress: (m) => setText('ld2-export-status', m),
            })
            if (entries.length === 0) throw new Error('活动页未收集到任何条目（可能尚未加载）')
            if (lastRun) lastRun.collected = entries.length
            updateMetricsView()

            const title = route.username ? `用户活动 @${route.username}` : '用户活动'

            const pageUrl = window.location.href
            const buildCooked = (it: (typeof entries)[number]) => {
              const topicTitle = escapeHtml(it.topicTitle || it.topicHref || '话题')
              const topicHref = it.topicHref ? escapeHtml(it.topicHref) : ''
              const titleLine = topicHref
                ? `<h3><a href="${topicHref}" target="_blank" rel="noreferrer">${topicTitle}</a></h3>`
                : `<h3>${topicTitle}</h3>`

              const metaParts: string[] = []
              if (it.categoryName) metaParts.push(escapeHtml(it.categoryName))
              if (it.timeLabel) metaParts.push(escapeHtml(it.timeLabel))
              const metaLine = metaParts.length
                ? `<p class="muted">${metaParts.join(' · ')}</p>`
                : ''

              const body = it.cookedHtml || '<em class="muted">（该条未缓存到正文内容）</em>'
              return `${titleLine}${metaLine}${body}`
            }

            const baseTopic: TopicData = {
              topic: { id: 0, title, slug: 'user_activity', origin, url: pageUrl },
              posts: entries.map((it, idx) => ({
                id: Number.parseInt(it.postId, 10) || idx + 1,
                postNumber: idx + 1,
                username: route.username ?? 'unknown',
                name: null,
                avatarUrl: null,
                createdAt: it.time > 0 ? new Date(it.time).toISOString() : new Date().toISOString(),
                cookedHtml: buildCooked(it),
                replyToPostNumber: null,
                onlineUrl: `${origin}/posts/${encodeURIComponent(it.postId)}`,
              })),
            }

            setText('ld2-export-status', '资源内联中…')
            const { data: inlined, metrics, failures } = await inlineAssets(baseTopic, {
              policy: config.assetPolicy,
              concurrency: 3,
              delayMs: config.networkDelayMs,
              cacheOnly: config.cacheOnly,
              signal: controller.signal,
            })
            if (lastRun) {
              lastRun.assetInline = metrics
              lastRun.assetFailures = failures
            }
            updateMetricsView()
            setText(
              'ld2-export-status',
              `资源内联：${metrics.inlined}/${metrics.discovered}（失败 ${metrics.failed}）`
            )

            setText('ld2-export-status', '生成中…')
            const time = exportedAt.slice(0, 19).replace(/[T:]/g, '_')
            const filenameBase = sanitizeFilename(`${title}_${time}_activity`, { maxLength: 120 })

            setText('ld2-export-status', '下载中…')
            await downloadCleanExport({
              format,
              filenameBase,
              data: inlined,
              exportedAt,
              assetFailures: failures,
            })
            await downloadAssetFailureReport({
              filenameBase,
              exportedAt,
              title,
              sourceUrl: pageUrl,
              failures,
            })
            setText('ld2-export-status', `完成（收集 ${entries.length} 条）`)
            window.dispatchEvent(
              new CustomEvent('ld2:toast', {
                detail: {
                  title: '导出完成',
                  desc: `${filenameBase}.${format === 'html' ? 'html' : format === 'markdown' ? 'md' : 'json'}`,
                  ttlMs: 5200,
                },
              })
            )
            return
          }

          if (!route.topicId) return
          setText('ld2-export-status', '抓取中…')
          const loaded = await loadTopicData({
            origin,
            topicId: route.topicId,
            slug,
            signal: controller.signal,
            domScrollConfig: config.scrollConfig,
            networkDelayMs: config.networkDelayMs,
            onProgress: (p) => {
              if (p.stage === 'posts' && p.total) {
                setText('ld2-export-status', `抓取中… ${p.done ?? 0}/${p.total}`)
                return
              }
              setText('ld2-export-status', p.message ?? p.stage)
            },
          })
          const data = loaded.data
          if (lastRun) {
            lastRun.topicLoad = loaded.metrics
            lastRun.collected = data.posts.length
          }
          updateMetricsView()

          const exportedAt = new Date().toISOString()
          setText('ld2-export-status', '资源内联中…')
          const { data: finalData, metrics, failures } = await inlineAssets(data, {
            policy: config.assetPolicy,
            concurrency: 3,
            delayMs: config.networkDelayMs,
            cacheOnly: config.cacheOnly,
            signal: controller.signal,
          })
          if (lastRun) {
            lastRun.assetInline = metrics
            lastRun.assetFailures = failures
          }
          updateMetricsView()
          setText(
            'ld2-export-status',
            `资源内联：${metrics.inlined}/${metrics.discovered}（失败 ${metrics.failed}）`
          )

          const time = exportedAt.slice(0, 19).replace(/[T:]/g, '_')
          const baseFileName = sanitizeFilename(`${finalData.topic.title}_${time}`)

          const shouldSplit = config.splitEnabled && format === 'html'
          if (shouldSplit) {
            const size = computeAdaptiveSplitSize(finalData, config.splitSize)
            setText('ld2-export-status', '分段生成中…')
            const { segments, postToFile, indexFileName } = splitTopicData(finalData, {
              enabled: true,
              size,
              includeIndex: true,
              baseFileName,
            })
            if (lastRun) lastRun.splitSegments = segments.length
            updateMetricsView()

            const indexHtml = renderSplitIndexHtml({
              title: finalData.topic.title,
              exportedAt,
              origin: finalData.topic.origin,
              segments,
            })

            setText('ld2-export-status', '下载中…(index)')
            await downloadHtml({ filenameBase: indexFileName, html: indexHtml })

            for (let i = 0; i < segments.length; i += 1) {
              if (controller.signal.aborted) throw new DOMException('aborted', 'AbortError')
              const seg = segments[i]
              setText('ld2-export-status', `下载中…(${i + 1}/${segments.length})`)
              const linkFor = (postNumber: number) => {
                const file = postToFile.get(postNumber)
                if (!file) return `#post-${postNumber}`
                return file === seg.fileName ? `#post-${postNumber}` : `${file}#post-${postNumber}`
              }
              const partMeta = {
                partNo: i + 1,
                partTotal: segments.length,
                rangeLabel: `${seg.startPostNumber}-${seg.endPostNumber}`,
                indexFileName,
                prevFileName: segments[i - 1]?.fileName ?? null,
                nextFileName: segments[i + 1]?.fileName ?? null,
              }
              const html = applyOfflineInteractions(
                renderCleanHtml(
                  { topic: finalData.topic, posts: seg.posts },
                  { exportedAt, linkForPostNumber: linkFor, partMeta }
                )
              )
              await downloadHtml({ filenameBase: seg.fileName, html })
            }

            setText('ld2-export-status', '完成')
            window.dispatchEvent(
              new CustomEvent('ld2:toast', {
                detail: {
                  title: '导出完成',
                  desc: `分段：${segments.length} + index`,
                  ttlMs: 5200,
                },
              })
            )
            return
          }

          setText('ld2-export-status', '生成中…')
          setText('ld2-export-status', '下载中…')
          await downloadCleanExport({
            format,
            filenameBase: baseFileName,
            data: finalData,
            exportedAt,
            assetFailures: failures,
          })
          await downloadAssetFailureReport({
            filenameBase: baseFileName,
            exportedAt,
            title: finalData.topic.title,
            sourceUrl: finalData.topic.url || `${finalData.topic.origin}/t/${finalData.topic.slug}/${finalData.topic.id}`,
            failures,
          })
          setText('ld2-export-status', '完成')
          window.dispatchEvent(
            new CustomEvent('ld2:toast', {
              detail: {
                title: '导出完成',
                desc: `${baseFileName}.${format === 'html' ? 'html' : format === 'markdown' ? 'md' : 'json'}`,
                ttlMs: 5200,
              },
            })
          )
        } catch (err) {
          const msg = formatError(err)
          if (err instanceof DOMException && err.name === 'AbortError') {
            setText('ld2-export-status', '已取消')
          } else {
            setText('ld2-export-status', `失败：${msg}`)
            window.dispatchEvent(
              new CustomEvent('ld2:toast', {
                detail: { title: '导出失败', desc: msg, ttlMs: 5200 },
              })
            )
          }
          if (!(err instanceof DOMException && err.name === 'AbortError'))
            ctx.logger.error('export failed', err)
        } finally {
          controller = null
          updateEnabled()
        }
      }

      function onCancel(): void {
        if (!controller) return
        controller?.abort()
      }

      const onExportCurrent = () => void onExport('current')
      const onExportFull = () => void onExport('full')
      exportCurrentBtn.addEventListener('click', onExportCurrent)
      exportFullBtn.addEventListener('click', onExportFull)
      cancelBtn.addEventListener('click', onCancel)

      const onGotoFirst = () => {
        const r = ctx.discourse.getRouteInfo()
        if (!r.isTopic || !r.topicId) return
        const slug = getSlugFromPathname(r.pathname) ?? 'topic'
        routeTo(`${window.location.origin}/t/${slug}/${r.topicId}`)
      }

      const onQuickExportEvent = () => void onExport('current')
      const onFullExportEvent = () => void onExport('full')
      const onGotoFirstEvent = () => onGotoFirst()
      window.addEventListener(EXPORT_QUICK_EVENT, onQuickExportEvent)
      window.addEventListener(EXPORT_FULL_EVENT, onFullExportEvent)
      window.addEventListener(NAVIGATE_TOPIC_HOME_EVENT, onGotoFirstEvent)

      const onConfigChange = () => {
        persistConfigFromUi()
        updateEnabled()
        updateMetricsView()
      }
      formatSelect.addEventListener('change', onConfigChange)
      networkDelayInput.addEventListener('change', onConfigChange)
      splitCheckbox.addEventListener('change', onConfigChange)
      splitSizeInput.addEventListener('change', onConfigChange)
      scrollStepInput.addEventListener('change', onConfigChange)
      scrollDelayInput.addEventListener('change', onConfigChange)
      scrollCollectIntervalInput.addEventListener('change', onConfigChange)
      scrollStableInput.addEventListener('change', onConfigChange)
      scrollMaxCountInput.addEventListener('change', onConfigChange)

      const routeSub = ctx.router.onChange((href) => {
        syncPassiveCache(href)
        updateEnabled(href)
        updateMetricsView(href)
      })

      syncConfigUiFromStore()
      syncPassiveCache()
      updateEnabled()
      updateMetricsView()

      return toDisposable(() => {
        routeSub.dispose()
        passiveCacheSub?.dispose()

        formatSelect.removeEventListener('change', onConfigChange)
        networkDelayInput.removeEventListener('change', onConfigChange)
        splitCheckbox.removeEventListener('change', onConfigChange)
        splitSizeInput.removeEventListener('change', onConfigChange)
        scrollStepInput.removeEventListener('change', onConfigChange)
        scrollDelayInput.removeEventListener('change', onConfigChange)
        scrollCollectIntervalInput.removeEventListener('change', onConfigChange)
        scrollStableInput.removeEventListener('change', onConfigChange)
        scrollMaxCountInput.removeEventListener('change', onConfigChange)

        exportCurrentBtn.removeEventListener('click', onExportCurrent)
        exportFullBtn.removeEventListener('click', onExportFull)
        cancelBtn.removeEventListener('click', onCancel)
        window.removeEventListener(EXPORT_QUICK_EVENT, onQuickExportEvent)
        window.removeEventListener(EXPORT_FULL_EVENT, onFullExportEvent)
        window.removeEventListener(NAVIGATE_TOPIC_HOME_EVENT, onGotoFirstEvent)

        footerSpacerRo?.disconnect()
        footerSpacerRo = null
        panelOpenMo?.disconnect()
        panelOpenMo = null
        tabShowMo?.disconnect()
        tabShowMo = null
        window.removeEventListener('resize', onWindowResize)
        optionsDetails.removeEventListener('toggle', onDetailsToggle)
        scrollDetails.removeEventListener('toggle', onDetailsToggle)
        if (footerSpacerRafId != null) {
          window.cancelAnimationFrame(footerSpacerRafId)
          footerSpacerRafId = null
        }
        footerSpacerRetryLeft = 0

        metricsWrap.remove()
        settingsArea.remove()
        footer.remove()
      })
    },
  }
}

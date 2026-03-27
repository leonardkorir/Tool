import { combineDisposables, toDisposable } from '../../shared/disposable'
import type { AppContext, Feature } from '../../app/types'
import { getExportProgressValue, isExportBusyStatus } from '../export/status'
import { createEl } from './dom'
import { panelStyles } from './styles'
import {
  EXPORT_FULL_EVENT,
  FILTER_BLOCK_TOPIC_AUTHOR_EVENT,
  NAVIGATE_TOPIC_HOME_EVENT,
  UI_REFRESH_EVENT,
} from './events'

const UI_ID = 'ld2-ui'

type PanelRefs = {
  route: HTMLElement | null
  exportBadge: HTMLElement | null
}

function ensureStyles(): void {
  if (document.getElementById('ld2-panel-styles')) return
  if (typeof GM_addStyle === 'function') {
    GM_addStyle(panelStyles)
    return
  }
  const style = document.createElement('style')
  style.id = 'ld2-panel-styles'
  style.textContent = panelStyles
  document.head.appendChild(style)
}

function iconSvg(
  name: 'x' | 'gear' | 'sparkles' | 'arrowUp' | 'download' | 'play' | 'filter' | 'flash' | 'panel'
): string {
  if (name === 'x') {
    return `<svg class="ld2-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
  }
  if (name === 'panel') {
    return `<svg class="ld2-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2.5" stroke="currentColor" stroke-width="1.9"/><path d="M9 5v14M13 10h4M13 14h3" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`
  }
  if (name === 'gear') {
    return `<svg class="ld2-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z" stroke="currentColor" stroke-width="1.9"/><path d="M19.2 15a7.9 7.9 0 0 0 .1-2l1.8-1.1-1.8-3.1-2.2.6a7.1 7.1 0 0 0-1.5-.9l-.3-2.2H9.7l-.3 2.2a7.1 7.1 0 0 0-1.5.9l-2.2-.6-1.8 3.1L5.7 13a7.9 7.9 0 0 0 .1 2L4 16.1l1.8 3.1 2.2-.6c.5.4 1 .7 1.5.9l.3 2.2h4.6l.3-2.2c.5-.2 1-.5 1.5-.9l2.2.6 1.8-3.1L19.2 15Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`
  }
  if (name === 'arrowUp') {
    return `<svg class="ld2-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 17V7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="m7 12 5-5 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 20h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
  }
  if (name === 'download') {
    return `<svg class="ld2-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 7v10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="m7 12 5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 20h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
  }
  if (name === 'play') {
    return `<svg class="ld2-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 7 8 5-8 5V7Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>`
  }
  if (name === 'filter') {
    return `<svg class="ld2-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16l-6 7v5l-4-2v-3L4 6Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>`
  }
  if (name === 'flash') {
    return `<svg class="ld2-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 2 6 13h5l-1 9 8-12h-5l1-8Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`
  }
  return `<svg class="ld2-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l1.2 4.3L18 8l-4.3 1.2L12 14l-1.2-4.8L6 8l4.8-1.7L12 2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M6 14l.7 2.5L9 17l-2.3.7L6 20l-.7-2.3L3 17l2.3-.5L6 14Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
}

function routeLabel(ctx: AppContext, href: string): string {
  const route = ctx.discourse.getRouteInfo(href)
  if (route.isTopic) return `主题页 #${route.topicId ?? '?'}`
  if (route.isUserActivity) return route.username ? `用户活动 @${route.username}` : '用户活动页'
  if (route.pathname.startsWith('/u/')) return '用户资料页'
  if (route.pathname === '/' || route.pathname === '/latest') return '最新主题列表'
  if (route.pathname.includes('/c/')) return '分类列表页'
  if (route.pathname.includes('/tag')) return '标签列表页'
  return route.pathname || '当前页面'
}

function getExportStatusText(): string {
  const text = document.getElementById('ld2-export-status')?.textContent?.trim()
  return text || '空闲'
}

export function uiFeature(): Feature {
  return {
    id: UI_ID,
    mount(ctx: AppContext) {
      ensureStyles()

      const fabHome = createEl('button', {
        id: 'ld2-fab-home',
        title: '回到话题首页',
        type: 'button',
      })
      fabHome.setAttribute('aria-label', '回到话题首页')
      fabHome.innerHTML = iconSvg('arrowUp')

      const fabExport = createEl('button', {
        id: 'ld2-fab-export',
        title: '完整导出',
        type: 'button',
      })
      fabExport.setAttribute('aria-label', '完整导出')
      fabExport.innerHTML = iconSvg('download')
      fabExport.dataset.busy = 'false'
      fabExport.style.setProperty('--ld2-fab-progress', '0deg')

      const fab = createEl('button', { id: 'ld2-fab', title: 'Linux.do Tool', type: 'button' })
      fab.setAttribute('aria-label', '打开/关闭工具面板')
      fab.innerHTML = iconSvg('panel')

      const panel = createEl('div', { id: 'ld2-panel' })
      panel.innerHTML = `
        <div class="ld2-header">
          <div class="ld2-brand">
            <div class="ld2-logo" aria-hidden="true">${iconSvg('panel')}</div>
            <div class="ld2-title">
              <strong>Linux.do Tool</strong>
              <div class="ld2-sub">
                <span id="ld2-overview-route-text">当前页面</span>
              </div>
            </div>
          </div>
          <div class="ld2-actions">
            <button id="ld2-close" class="ld2-close" type="button" aria-label="关闭面板">${iconSvg('x')}</button>
          </div>
        </div>

        <div class="ld2-tabs">
          <div class="ld2-tablist" role="tablist" aria-label="Linux.do Tool 标签页">
            <button class="ld2-tab" type="button" role="tab" data-tab="read" aria-selected="true">阅读</button>
            <button class="ld2-tab" type="button" role="tab" data-tab="export" aria-selected="false">导出 <span class="ld2-badge" id="ld2-export-badge">-</span></button>
            <button class="ld2-tab" type="button" role="tab" data-tab="filter" aria-selected="false">筛选</button>
          </div>
        </div>

        <div class="ld2-body">
          <section class="ld2-tabpanel" data-panel="read" role="tabpanel">
            <div class="ld2-card ld2-read-panel">
              <div class="ld2-card-header">
                <div class="ld2-card-title">自动阅读</div>
                <div id="ld2-read-status" class="ld2-card-status">空闲</div>
              </div>
              <div id="ld2-read-controls" class="stack vertical"></div>
            </div>
          </section>

          <section class="ld2-tabpanel" data-panel="export" role="tabpanel" hidden>
            <div class="ld2-card">
              <div id="ld2-export-status" class="ld2-card-status" hidden>空闲</div>
              <div id="ld2-export-progress-anchor"></div>
              <div id="ld2-export-controls" class="stack vertical"></div>
            </div>
            <div id="ld2-export-footer-container"></div>
          </section>

          <section class="ld2-tabpanel" data-panel="filter" role="tabpanel" hidden>
            <div class="ld2-card">
              <div id="ld2-filter-status" class="ld2-card-status" hidden>空闲</div>
              <div id="ld2-filter-summary-anchor"></div>
              <div id="ld2-filter-controls" class="stack vertical"></div>
            </div>
          </section>
        </div>
      `

      const refs: PanelRefs = {
        route: panel.querySelector('#ld2-overview-route-text'),
        exportBadge: panel.querySelector('#ld2-export-badge'),
      }

      const toast = createEl('div', { id: 'ld2-toast' })
      toast.innerHTML = `
        <div class="t-row">
          <div>
            <div class="t-title" id="ld2-toast-title"></div>
            <div class="t-desc" id="ld2-toast-desc"></div>
          </div>
          <button class="t-close" id="ld2-toast-close" type="button" aria-label="关闭提示">${iconSvg('x')}</button>
        </div>
      `

      let toastTimer: number | null = null
      function showToast(title: string, desc = '', ttlMs = 3200): void {
        const titleEl = toast.querySelector<HTMLElement>('#ld2-toast-title')
        const descEl = toast.querySelector<HTMLElement>('#ld2-toast-desc')
        if (titleEl) titleEl.textContent = title
        if (descEl) descEl.textContent = desc
        toast.setAttribute('data-open', 'true')
        if (toastTimer != null) window.clearTimeout(toastTimer)
        toastTimer = window.setTimeout(() => toast.removeAttribute('data-open'), ttlMs)
      }

      const onToastEvent = (e: Event) => {
        if (!(e instanceof CustomEvent)) return
        const title = String(e.detail?.title ?? '').trim()
        if (!title) return
        const desc = String(e.detail?.desc ?? '').trim()
        const ttlMsRaw = Number(e.detail?.ttlMs)
        const ttlMs = Number.isFinite(ttlMsRaw) ? Math.max(800, Math.min(20_000, ttlMsRaw)) : 3200
        showToast(title, desc, ttlMs)
      }
      window.addEventListener('ld2:toast', onToastEvent)

      function render(href = window.location.href): void {
        const route = ctx.discourse.getRouteInfo(href)
        const routeText = routeLabel(ctx, href)
        const exportStatus = getExportStatusText()
        const exportBusy = isExportBusyStatus(exportStatus)
        const exportProgressDeg = `${Math.round(getExportProgressValue(exportStatus) * 3.6)}deg`
        const exportLabel =
          exportStatus === '空闲' ? '完整导出' : `完整导出：${exportStatus.replace(/\s+/g, ' ')}`
        if (refs.route) refs.route.textContent = routeText

        fabHome.toggleAttribute('disabled', !route.isTopic)
        fabExport.toggleAttribute('disabled', !(route.isTopic || route.isUserActivity) || exportBusy)
        fabExport.dataset.busy = exportBusy ? 'true' : 'false'
        fabExport.style.setProperty('--ld2-fab-progress', exportProgressDeg)
        fabExport.setAttribute('aria-busy', exportBusy ? 'true' : 'false')
        fabExport.title = exportLabel
        fabExport.setAttribute('aria-label', exportLabel)

        if (refs.exportBadge) {
          if (route.isTopic) {
            const count = document.querySelectorAll('article[data-post-id]').length
            refs.exportBadge.textContent = count > 0 ? String(count) : '-'
          } else if (document.querySelector('.user-stream') && route.pathname.includes('/u/')) {
            const count = document.querySelectorAll(
              '.user-stream .post-list-item.user-stream-item'
            ).length
            refs.exportBadge.textContent = count > 0 ? String(count) : '活动'
          } else {
            refs.exportBadge.textContent = '-'
          }
        }
      }

      let open = false
      function setOpen(next: boolean): void {
        open = next
        if (open) panel.setAttribute('data-open', 'true')
        else panel.removeAttribute('data-open')
      }

      const onFabClick = () => setOpen(!open)
      fab.addEventListener('click', onFabClick)

      const onFabHomeClick = (e: Event) => {
        e.preventDefault()
        if (fabHome.hasAttribute('disabled')) return
        window.dispatchEvent(new CustomEvent(NAVIGATE_TOPIC_HOME_EVENT))
      }
      fabHome.addEventListener('click', onFabHomeClick)

      const onFabExportClick = (e: Event) => {
        e.preventDefault()
        if (fabExport.hasAttribute('disabled')) return
        window.dispatchEvent(new CustomEvent(EXPORT_FULL_EVENT))
      }
      fabExport.addEventListener('click', onFabExportClick)

      const closeBtn = panel.querySelector<HTMLButtonElement>('#ld2-close')
      const onClose = () => setOpen(false)
      closeBtn?.addEventListener('click', onClose)

      const scrollTopByTab: Record<string, number> = {}
      let currentTab: string | null = null

      function getScrollEl(tab: string): HTMLElement | null {
        const tabpanel = panel.querySelector<HTMLElement>(`.ld2-tabpanel[data-panel="${tab}"]`)
        if (!tabpanel) return null
        if (tab === 'export')
          return tabpanel.querySelector<HTMLElement>(':scope > .ld2-card') ?? tabpanel
        return tabpanel
      }

      function setTab(tab: string): void {
        if (currentTab) {
          const prevScrollEl = getScrollEl(currentTab)
          if (prevScrollEl) scrollTopByTab[currentTab] = prevScrollEl.scrollTop
        }
        const tabs = Array.from(panel.querySelectorAll<HTMLButtonElement>('.ld2-tab'))
        const panels = Array.from(panel.querySelectorAll<HTMLElement>('.ld2-tabpanel'))
        for (const t of tabs) {
          const selected = t.dataset.tab === tab
          t.setAttribute('aria-selected', selected ? 'true' : 'false')
        }
        for (const p of panels) {
          const show = p.getAttribute('data-panel') === tab
          if (show) p.removeAttribute('hidden')
          else p.setAttribute('hidden', 'true')
        }
        ctx.storage.set('ui.tab', tab)
        const nextScrollEl = getScrollEl(tab)
        if (nextScrollEl) nextScrollEl.scrollTop = scrollTopByTab[tab] ?? 0
        currentTab = tab
      }

      const initialTab = String(ctx.storage.get('ui.tab', 'read') || 'read')
      const normalizedTab =
        initialTab === 'main'
          ? 'read'
          : initialTab === 'read' || initialTab === 'export' || initialTab === 'filter'
            ? initialTab
            : 'read'
      setTab(normalizedTab)
      const onTabClick = (e: Event) => {
        const btn = e.currentTarget as HTMLButtonElement
        const tab = btn.dataset.tab
        if (tab) setTab(tab)
      }
      for (const t of Array.from(panel.querySelectorAll<HTMLButtonElement>('.ld2-tab')))
        t.addEventListener('click', onTabClick)

      const toastClose = toast.querySelector<HTMLButtonElement>('#ld2-toast-close')
      const onToastClose = () => toast.removeAttribute('data-open')
      toastClose?.addEventListener('click', onToastClose)

      const onHotkey = (e: KeyboardEvent) => {
        if (isEditableTarget(e.target)) return
        if (e.key === 'Escape' && open) {
          setOpen(false)
          return
        }
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
          e.preventDefault()
          setOpen(!open)
        }
      }
      document.addEventListener('keydown', onHotkey, true)

      const routeSub = ctx.router.onChange((href) => render(href))
      const refreshSub = () => render()
      window.addEventListener(UI_REFRESH_EVENT, refreshSub)
      render()

      function appendToBody(): void {
        document.body.appendChild(panel)
        document.body.appendChild(fabHome)
        document.body.appendChild(fabExport)
        document.body.appendChild(fab)
        document.body.appendChild(toast)
      }
      if (document.body) appendToBody()
      else document.addEventListener('DOMContentLoaded', appendToBody, { once: true })

      const onDocClick = (e: MouseEvent) => {
        if (!open) return
        const target = e.target as Node | null
        if (!target) return
        if (
          panel.contains(target) ||
          fab.contains(target) ||
          fabHome.contains(target) ||
          fabExport.contains(target) ||
          toast.contains(target)
        )
          return
        setOpen(false)
      }
      document.addEventListener('click', onDocClick, true)

      const onBlockTopicAuthor = (e: Event) => {
        if (!(e instanceof CustomEvent)) return
        setTab('filter')
        setOpen(true)
      }
      window.addEventListener(FILTER_BLOCK_TOPIC_AUTHOR_EVENT, onBlockTopicAuthor)

      return combineDisposables(
        routeSub,
        toDisposable(() => fab.removeEventListener('click', onFabClick)),
        toDisposable(() => fabHome.removeEventListener('click', onFabHomeClick)),
        toDisposable(() => fabExport.removeEventListener('click', onFabExportClick)),
        toDisposable(() => closeBtn?.removeEventListener('click', onClose)),
        toDisposable(() => document.removeEventListener('keydown', onHotkey, true)),
        toDisposable(() => window.removeEventListener('ld2:toast', onToastEvent)),
        toDisposable(() => window.removeEventListener(UI_REFRESH_EVENT, refreshSub)),
        toDisposable(() =>
          window.removeEventListener(FILTER_BLOCK_TOPIC_AUTHOR_EVENT, onBlockTopicAuthor)
        ),
        toDisposable(() => toastClose?.removeEventListener('click', onToastClose)),
        toDisposable(() => document.removeEventListener('click', onDocClick, true)),
        toDisposable(() => panel.remove()),
        toDisposable(() => fabHome.remove()),
        toDisposable(() => fabExport.remove()),
        toDisposable(() => fab.remove()),
        toDisposable(() => toast.remove())
      )
    },
  }
}

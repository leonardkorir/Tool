export const UI_REFRESH_EVENT = 'ld2:ui:refresh'
export const AUTO_READ_START_EVENT = 'ld2:auto-read:start'
export const AUTO_READ_TOGGLE_EVENT = 'ld2:auto-read:toggle'
export const AUTO_READ_STOP_EVENT = 'ld2:auto-read:stop'
export const EXPORT_QUICK_EVENT = 'ld2:export:quick'
export const EXPORT_FULL_EVENT = 'ld2:export:full'
export const NAVIGATE_TOPIC_HOME_EVENT = 'ld2:navigate:topic-home'
export const FILTER_BLOCK_TOPIC_AUTHOR_EVENT = 'ld2:filter:block-topic-author'

export function emitUiRefresh(): void {
  window.dispatchEvent(new CustomEvent(UI_REFRESH_EVENT))
}

export const panelStyles = `
#ld2-panel,
#ld2-fab,
#ld2-fab-home,
#ld2-fab-export,
#ld2-toast {
  z-index: 2147483647;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'PingFang SC',
    'Helvetica Neue', sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  --bg: rgba(242, 242, 247, 0.92);
  --bg-hover: rgba(60, 60, 67, 0.08);
  --fg: #1d1d1f;
  --fg-muted: #6e6e73;
  --border: rgba(29, 29, 31, 0.08);
  --border-strong: rgba(29, 29, 31, 0.14);
  --radius: 14px;
  --radius-lg: 28px;
  --shadow: 0 24px 64px rgba(15, 23, 42, 0.18);
  --shadow-sm: 0 14px 28px rgba(15, 23, 42, 0.11);
  --surface: rgba(255, 255, 255, 0.82);
  --surface-2: rgba(255, 255, 255, 0.58);
  --surface-3: rgba(246, 246, 248, 0.94);
  --focus: rgba(45, 46, 51, 0.18);
  --danger: #c4493d;
  --success: #5d7a63;
  --accent: #2c2c2e;
  --accent-fill: #1f1f21;
  --accent-contrast: #ffffff;
  --accent-soft: rgba(31, 31, 33, 0.08);
  --ld2-text: var(--fg);
  --ld2-muted: var(--fg-muted);
  --ld2-border: var(--border);
  --ld2-bg: var(--bg);
  --ld2-surface: var(--surface);
  --ld2-surface-2: var(--surface-2);
  --ld2-shadow: var(--shadow);
  --ld2-shadow-sm: var(--shadow-sm);
  --ld2-focus: var(--focus);
  --ld2-danger: var(--danger);
  --ld2-success: var(--success);
  --ld2-accent: var(--accent);
  --ld2-accent2: var(--accent-contrast);
}

@media (prefers-color-scheme: dark) {
  #ld2-panel,
  #ld2-fab,
  #ld2-fab-home,
  #ld2-fab-export,
  #ld2-toast {
    --bg: rgba(28, 28, 30, 0.94);
    --bg-hover: rgba(255, 255, 255, 0.08);
    --fg: #f5f5f7;
    --fg-muted: rgba(235, 235, 245, 0.68);
    --border: rgba(255, 255, 255, 0.1);
    --border-strong: rgba(255, 255, 255, 0.16);
    --surface: rgba(36, 36, 38, 0.84);
    --surface-2: rgba(54, 54, 58, 0.58);
    --surface-3: rgba(44, 44, 46, 0.94);
    --focus: rgba(245, 245, 247, 0.18);
    --shadow: 0 26px 68px rgba(0, 0, 0, 0.42);
    --shadow-sm: 0 18px 34px rgba(0, 0, 0, 0.26);
    --accent: #f5f5f7;
    --accent-fill: #f5f5f7;
    --accent-contrast: #1c1c1e;
    --accent-soft: rgba(245, 245, 247, 0.1);
    --ld2-fab-progress-track: rgba(255, 255, 255, 0.16);
  }
}

#ld2-fab-home,
#ld2-fab-export {
  position: fixed;
  right: 14px;
  width: 44px;
  height: 44px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  background: var(--surface);
  backdrop-filter: blur(20px) saturate(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(1.2);
  color: var(--fg-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
  user-select: none;
  transition: transform 0.16s ease, opacity 0.16s ease, background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease;
  overflow: hidden;
  isolation: isolate;
}

#ld2-fab-home {
  bottom: 14px;
  --ld2-translate: -116px;
  transform: translateY(var(--ld2-translate));
}

#ld2-fab-export {
  bottom: 14px;
  --ld2-translate: -60px;
  --ld2-fab-progress: 0deg;
  --ld2-fab-progress-track: rgba(60, 60, 67, 0.12);
  transform: translateY(var(--ld2-translate));
}

@media (prefers-color-scheme: dark) {
  #ld2-fab-export {
    --ld2-fab-progress-track: rgba(255, 255, 255, 0.16);
  }
}

#ld2-fab-home .ld2-icon,
#ld2-fab-export .ld2-icon {
  width: 17px;
  height: 17px;
  position: relative;
  z-index: 1;
}

#ld2-fab-export::before,
#ld2-fab-export::after {
  content: '';
  position: absolute;
  border-radius: inherit;
  pointer-events: none;
  transition: opacity 0.16s ease;
}

#ld2-fab-export::before {
  inset: 0;
  background: conic-gradient(
    from -90deg,
    var(--accent-fill) 0deg,
    var(--accent-fill) var(--ld2-fab-progress),
    var(--ld2-fab-progress-track) var(--ld2-fab-progress),
    var(--ld2-fab-progress-track) 360deg
  );
  opacity: 0;
}

#ld2-fab-export::after {
  inset: 3px;
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border);
  opacity: 0;
}

#ld2-fab-export[data-busy='true']::before,
#ld2-fab-export[data-busy='true']::after {
  opacity: 1;
}

#ld2-fab-export[data-busy='true'] {
  color: var(--accent-fill);
}

#ld2-fab-export[data-busy='true'][disabled] {
  opacity: 1;
  cursor: progress;
}

#ld2-fab-home[disabled],
#ld2-fab-export[disabled] {
  opacity: 0.55;
  cursor: not-allowed;
}

#ld2-fab-home:hover:not([disabled]),
#ld2-fab-export:hover:not([disabled]) {
  transform: translateY(calc(var(--ld2-translate) - 1px));
  background: var(--bg-hover);
  color: var(--fg);
}

#ld2-fab-export[data-busy='true']:hover:not([disabled]) {
  color: var(--accent-fill);
}

#ld2-fab-home:active:not([disabled]),
#ld2-fab-export:active:not([disabled]) {
  transform: translateY(var(--ld2-translate));
}

#ld2-fab-home:focus-visible,
#ld2-fab-export:focus-visible,
#ld2-fab:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}

#ld2-fab {
  position: fixed;
  right: 14px;
  bottom: 14px;
  width: 48px;
  height: 48px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  background: var(--surface);
  backdrop-filter: blur(20px) saturate(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(1.2);
  color: var(--accent-fill);
  display: grid;
  place-items: center;
  cursor: pointer;
  user-select: none;
  transition: transform 0.16s ease, opacity 0.16s ease, background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease;
  overflow: hidden;
}

#ld2-fab .ld2-icon {
  width: 19px;
  height: 19px;
}

#ld2-fab:hover {
  transform: translateY(-1px);
  background: var(--bg-hover);
  color: var(--fg);
}

#ld2-fab:active {
  transform: translateY(0);
}

#ld2-panel[data-open='true'] ~ #ld2-fab-home,
#ld2-panel[data-open='true'] ~ #ld2-fab-export {
  opacity: 0;
  pointer-events: none;
  transform: translateY(0) scale(0.96);
}

#ld2-panel {
  position: fixed;
  right: 14px;
  bottom: 64px;
  width: 408px;
  max-width: calc(100vw - 20px);
  height: min(74vh, 660px);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface);
  box-shadow: var(--shadow);
  overflow: hidden;
  display: none;
  flex-direction: column;
  transform-origin: bottom right;
  color: var(--fg);
  backdrop-filter: blur(28px) saturate(1.18);
  -webkit-backdrop-filter: blur(28px) saturate(1.18);
}

#ld2-panel[data-open='true'] {
  display: flex;
  animation: ld2-pop 0.16s ease-out;
}

@keyframes ld2-pop {
  0% {
    opacity: 0;
    transform: translateY(4px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

#ld2-panel * {
  box-sizing: border-box;
}

#ld2-panel a {
  color: inherit;
}

#ld2-panel code,
#ld2-panel .ld2-kbd {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace;
  font-size: 12px;
  color: var(--ld2-text);
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: 8px;
}

#ld2-panel code {
  padding: 1px 6px;
}

#ld2-panel .ld2-kbd {
  padding: 1px 5px;
}

#ld2-panel .ld2-muted {
  color: var(--ld2-muted);
}

#ld2-panel .ld2-section-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--fg-muted);
  margin-bottom: 8px;
  letter-spacing: 0.01em;
}

#ld2-panel .ld2-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 12px;
  border-bottom: 0;
  background: linear-gradient(180deg, var(--surface-3), rgba(255, 255, 255, 0));
}

#ld2-panel .ld2-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

#ld2-panel .ld2-title {
  min-width: 0;
}

#ld2-panel .ld2-title strong {
  display: block;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--ld2-text);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

#ld2-panel .ld2-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  font-size: 12px;
  color: var(--ld2-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

#ld2-panel .ld2-actions {
  display: flex;
  gap: 6px;
}

#ld2-panel .ld2-close {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--surface-2);
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--fg-muted);
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}

#ld2-panel .ld2-close .ld2-icon {
  width: 15px;
  height: 15px;
}

#ld2-panel .ld2-close:hover {
  background: var(--surface-3);
  border-color: var(--border-strong);
  color: var(--fg);
}

#ld2-panel .ld2-close:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

#ld2-panel .ld2-logo {
  width: 28px;
  height: 28px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  background: var(--surface-3);
  border: 1px solid var(--border);
  color: var(--accent-fill);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

#ld2-panel .ld2-logo .ld2-icon {
  width: 15px;
  height: 15px;
}

#ld2-panel .ld2-tabs {
  padding: 0 16px 14px;
  background: transparent;
}

#ld2-panel .ld2-tablist {
  display: flex;
  gap: 6px;
  padding: 4px;
  border: 0;
  border-radius: 999px;
  background: rgba(60, 60, 67, 0.08);
  box-shadow: none;
}

#ld2-panel .ld2-icon,
#ld2-toast .ld2-icon {
  width: 16px;
  height: 16px;
  display: block;
}

#ld2-panel .ld2-tab {
  appearance: none;
  flex: 1 1 0;
  min-height: 38px;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: var(--ld2-muted);
  padding: 0 16px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  transition: color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
  min-width: 0;
  white-space: nowrap;
  position: relative;
}

#ld2-panel .ld2-tab:hover {
  color: var(--ld2-text);
  background: rgba(255, 255, 255, 0.4);
}

#ld2-panel .ld2-tab[aria-selected='true'] {
  color: var(--ld2-text);
  background: var(--surface);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
}

#ld2-panel .ld2-tab[aria-selected='true']::after {
  display: none;
}

#ld2-panel .ld2-tab:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

#ld2-panel .ld2-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-3);
  font-size: 11px;
  font-weight: 700;
  color: var(--ld2-text);
}

#ld2-panel .ld2-body {
  padding: 0 16px 0;
  overflow: hidden;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

#ld2-panel .ld2-tabpanel {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding-bottom: 16px;
}

#ld2-panel .ld2-tabpanel[data-panel='export'] {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-bottom: 0;
}

#ld2-panel .ld2-tabpanel[data-panel='export'] > .ld2-card {
  flex: 1 1 auto;
  overflow: auto;
  min-height: 0;
  margin-bottom: 0;
}

#ld2-panel .ld2-tabpanel[data-panel='filter'] > .ld2-card {
  padding-top: 10px;
}

#ld2-panel .ld2-card {
  border: 0;
  background: var(--surface);
  border-radius: 22px;
  padding: 16px;
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.24);
}

#ld2-panel .ld2-card + .ld2-card {
  margin-top: 12px;
}

#ld2-panel .ld2-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

#ld2-panel .ld2-card-header > :first-child {
  min-width: 0;
  flex: 1 1 auto;
}

#ld2-panel .ld2-card-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--ld2-text);
  letter-spacing: -0.01em;
}

#ld2-panel .ld2-card-status {
  font-size: 12px;
  color: var(--ld2-muted);
  min-width: 0;
  flex: 0 1 58%;
  white-space: normal;
  text-align: right;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

#ld2-panel .ld2-card-note,
#ld2-panel .ld2-overview-note,
#ld2-panel .ld2-helper {
  font-size: 12px;
  color: var(--ld2-muted);
  line-height: 1.6;
}

#ld2-panel .ld2-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-3);
  color: var(--ld2-muted);
  font-size: 12px;
  font-weight: 600;
}

#ld2-panel .ld2-status-pill .dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.7;
}

#ld2-panel .ld2-status-pill.active {
  background: var(--accent-soft);
  border-color: var(--border-strong);
  color: var(--accent-fill);
}

#ld2-panel .ld2-status-pill.success {
  background: rgba(93, 122, 99, 0.12);
  border-color: rgba(93, 122, 99, 0.18);
  color: var(--success);
}

#ld2-panel .ld2-status-pill.error {
  background: rgba(196, 73, 61, 0.12);
  border-color: rgba(196, 73, 61, 0.22);
  color: var(--danger);
}

#ld2-panel .ld2-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: flex-start;
}

#ld2-panel .ld2-chip-row.compact {
  max-height: 92px;
  overflow: auto;
  margin-top: 8px;
  padding-right: 2px;
}

#ld2-panel .ld2-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-3);
  color: var(--ld2-text);
  font-size: 12px;
  font-weight: 600;
}

#ld2-panel .ld2-chip.accent {
  background: var(--accent-soft);
  border-color: var(--border-strong);
  color: var(--accent-fill);
}

#ld2-panel .ld2-chip.success {
  background: rgba(93, 122, 99, 0.12);
  border-color: rgba(93, 122, 99, 0.18);
  color: var(--success);
}

#ld2-panel .ld2-chip.danger {
  background: rgba(196, 73, 61, 0.12);
  border-color: rgba(196, 73, 61, 0.18);
  color: var(--danger);
}

#ld2-panel .ld2-chip-remove {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
  font-size: 13px;
  line-height: 1;
}

#ld2-panel .ld2-export-actions,
#ld2-panel .ld2-summary-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

#ld2-panel .ld2-export-stop {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

#ld2-panel .ld2-export-layout {
  display: grid;
  gap: 12px;
}

#ld2-panel .ld2-summary-card,
#ld2-panel .ld2-export-metrics {
  border: 0;
  background: var(--surface-2);
  border-radius: 20px;
  padding: 16px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
}

#ld2-panel #ld2-filter-controls {
  gap: 6px;
}

#ld2-panel .ld2-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

#ld2-panel .ld2-metric {
  border: 0;
  background: var(--surface-3);
  border-radius: 16px;
  padding: 12px;
  min-width: 0;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
}

#ld2-panel .ld2-metric .k {
  font-size: 12px;
  color: var(--ld2-muted);
  margin-bottom: 4px;
}

#ld2-panel .ld2-metric .v {
  font-size: 14px;
  font-weight: 700;
  color: var(--ld2-text);
  white-space: pre-wrap;
  line-height: 1.5;
}

#ld2-panel .ld2-progress {
  display: grid;
  gap: 8px;
}

#ld2-panel .ld2-progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}

#ld2-panel .ld2-progress-label {
  color: var(--ld2-muted);
}

#ld2-panel .ld2-progress-value {
  color: var(--ld2-text);
  font-weight: 700;
}

#ld2-panel .ld2-progress-track {
  height: 8px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}

#ld2-panel .ld2-progress-bar {
  width: 0;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent-fill), rgba(140, 140, 145, 0.92));
  transition: width 0.18s ease;
}

#ld2-panel .ld2-export-footer {
  flex: 0 0 auto;
  padding: 10px 16px;
  padding-bottom: calc(10px + env(safe-area-inset-bottom));
  display: grid;
  gap: 8px;
  background: transparent;
  border-top: 0;
  box-shadow: 0 -10px 24px rgba(15, 23, 42, 0.04);
}

#ld2-panel .ld2-export-actions[hidden],
#ld2-panel .ld2-export-stop[hidden] {
  display: none !important;
}

#ld2-panel .btn {
  appearance: none;
  min-height: 40px;
  border: 1px solid var(--border);
  background: var(--surface-3);
  color: var(--fg);
  border-radius: 14px;
  padding: 0 14px;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  transition: transform 0.16s ease, background 0.16s ease, border-color 0.16s ease,
    color 0.16s ease, opacity 0.16s ease, box-shadow 0.16s ease;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
}

#ld2-panel .btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.88);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}

#ld2-panel .btn:active {
  transform: translateY(1px) scale(0.995);
}

#ld2-panel .btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

#ld2-panel .btn:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

#ld2-panel .btn.primary {
  background: var(--accent-fill);
  border-color: transparent;
  color: var(--accent-contrast);
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.14);
}

#ld2-panel .btn.primary:hover:not(:disabled) {
  background: var(--accent-fill);
  opacity: 0.96;
}

#ld2-panel .btn.danger {
  color: var(--danger);
  border-color: rgba(196, 73, 61, 0.24);
  background: rgba(196, 73, 61, 0.08);
}

#ld2-panel .btn.danger:hover:not(:disabled) {
  background: rgba(196, 73, 61, 0.14);
}

#ld2-panel .btn.sm {
  min-height: 32px;
  padding: 0 10px;
  font-size: 12px;
}

#ld2-panel .btn.selected {
  background: var(--accent-soft);
  border-color: var(--border-strong);
  color: var(--accent-fill);
}

#ld2-panel .stack {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

#ld2-panel .stack > * {
  flex: 0 0 auto;
}

#ld2-panel .stack.vertical {
  flex-direction: column;
  align-items: stretch;
}

#ld2-panel .stack.vertical > * {
  width: 100%;
}

#ld2-panel .ld2-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border: 0;
  border-radius: 16px;
  background: var(--surface-3);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
}

#ld2-panel .ld2-row + .ld2-row {
  margin-top: 8px;
}

#ld2-panel .ld2-row .left {
  min-width: 0;
  flex: 1 1 auto;
}

#ld2-panel .ld2-row .title {
  font-size: 13px;
  font-weight: 700;
  color: var(--ld2-text);
  line-height: 1.4;
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
  overflow-wrap: anywhere;
  max-width: none;
}

#ld2-panel .ld2-row .sub {
  font-size: 12px;
  color: var(--ld2-muted);
  margin-top: 3px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

#ld2-panel .ld2-field-md {
  width: min(220px, 100%) !important;
  max-width: 100%;
}

#ld2-panel .ld2-pair-grid {
  display: grid !important;
  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  gap: 8px;
  width: min(220px, 100%) !important;
  max-width: 100%;
}

#ld2-panel .ld2-pair-grid > * {
  min-width: 0;
}

#ld2-panel .ld2-action-grid {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  gap: 8px;
}

#ld2-panel .ld2-row.ld2-row-top {
  align-items: flex-start;
}

#ld2-panel input[type='text'],
#ld2-panel input[type='number'],
#ld2-panel select {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--surface-3);
  color: var(--fg);
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
  min-width: 0;
  font-variant-numeric: tabular-nums;
  transition: box-shadow 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

#ld2-panel textarea {
  width: 100%;
  min-height: 72px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--surface-3);
  color: var(--fg);
  font-size: 13px;
  outline: none;
  resize: vertical;
  transition: box-shadow 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

#ld2-panel .ld2-select {
  width: 160px;
  max-width: 100%;
}

#ld2-panel input[type='text']:focus,
#ld2-panel input[type='number']:focus,
#ld2-panel select:focus,
#ld2-panel textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--focus);
}

#ld2-panel input[type='checkbox'] {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
  margin: 0;
}

#ld2-panel label {
  cursor: pointer;
  font-size: 13px;
  color: var(--ld2-text);
}

#ld2-panel details {
  border: 0;
  background: var(--surface-2);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
}

#ld2-panel summary {
  list-style: none;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  font-size: 13px;
  font-weight: 700;
  color: var(--fg);
  background: var(--surface-3);
}

#ld2-panel summary:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

#ld2-panel summary::-webkit-details-marker {
  display: none;
}

#ld2-panel details > summary::after {
  content: '';
  width: 7px;
  height: 7px;
  border-right: 2px solid var(--ld2-muted);
  border-bottom: 2px solid var(--ld2-muted);
  transform: rotate(-45deg);
  transition: transform 0.16s ease;
  flex: 0 0 auto;
  opacity: 0.9;
  margin-left: 8px;
}

#ld2-panel details[open] > summary::after {
  transform: rotate(45deg);
}

#ld2-panel details > summary + * {
  margin-top: 0;
}

#ld2-panel details > summary ~ * {
  margin-left: 0;
  margin-right: 0;
}

#ld2-panel details > :last-child {
  margin-bottom: 0;
}

#ld2-panel .ld2-presets {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

#ld2-panel .ld2-preset {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--surface-3);
  border-radius: 18px;
  padding: 12px;
  text-align: left;
  cursor: pointer;
  color: var(--fg);
  transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
}

#ld2-panel .ld2-preset strong {
  display: block;
  font-size: 14px;
  line-height: 1.2;
}

#ld2-panel .ld2-preset span {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ld2-muted);
}

#ld2-panel .ld2-preset:hover {
  background: var(--bg-hover);
}

#ld2-panel .ld2-preset.selected {
  background: var(--accent-soft);
  border-color: var(--border-strong);
}

#ld2-panel .ld2-summary-actions {
  grid-template-columns: 1fr;
  justify-items: center;
}

#ld2-panel .ld2-filter-summary-actions {
  margin-top: 10px;
}

#ld2-panel .ld2-block-author-btn {
  width: 100%;
  max-width: 260px;
}

#ld2-panel .ld2-pill-action-btn {
  min-height: 48px;
  padding: 0 22px;
  border-radius: 999px;
  box-shadow: 0 16px 32px rgba(15, 23, 42, 0.16);
}

#ld2-panel .ld2-compact-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

#ld2-panel .ld2-compact-stat {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-3);
  font-size: 12px;
  color: var(--ld2-text);
}

#ld2-panel .ld2-compact-stat .k {
  color: var(--ld2-muted);
}

#ld2-panel .ld2-inline-help {
  font-size: 12px;
  line-height: 1.6;
}

#ld2-panel .ld2-check-row {
  display: inline-flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 20px;
  padding: 2px 4px 2px 2px;
  font-size: 13px;
  line-height: 1.5;
  overflow: visible;
}

#ld2-panel .ld2-check-row input[type='checkbox'] {
  flex: 0 0 auto;
  margin-top: 2px;
}

#ld2-panel .ld2-check-row-spacious {
  margin-left: 2px;
}

#ld2-panel .ld2-blocked-post-placeholder {
  margin: 12px 0;
  padding: 14px;
  border-radius: 18px;
  border: 0;
  background: var(--surface-3);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
}

#ld2-panel .ld2-blocked-post-row {
  width: 100%;
  justify-content: space-between;
}

#ld2-panel .ld2-blocked-post-meta {
  font-size: 12px;
}

#ld2-panel [hidden] {
  display: none !important;
}

#ld2-toast {
  position: fixed;
  right: 64px;
  bottom: 14px;
  width: min(360px, calc(100vw - 76px));
  padding: 12px 14px;
  border-radius: 20px;
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  background: var(--surface);
  color: var(--fg);
  display: none;
  overflow: hidden;
  backdrop-filter: blur(18px) saturate(1.15);
  -webkit-backdrop-filter: blur(18px) saturate(1.15);
}

#ld2-toast[data-open='true'] {
  display: block;
  animation: ld2-pop 0.16s ease-out;
}

#ld2-toast .t-title {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 3px;
}

#ld2-toast .t-desc {
  font-size: 12px;
  color: var(--fg-muted);
  line-height: 1.55;
}

#ld2-toast .t-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

#ld2-toast .t-close {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 4px;
  border-radius: 8px;
  opacity: 0.85;
}

#ld2-toast .t-close:hover {
  opacity: 1;
  background: var(--bg-hover);
}

@media (max-width: 640px) {
  #ld2-panel {
    right: 10px;
    bottom: 60px;
    width: min(408px, calc(100vw - 20px));
    max-width: calc(100vw - 20px);
    height: min(80vh, 680px);
  }

  #ld2-panel .ld2-metrics,
  #ld2-panel .ld2-presets,
  #ld2-panel .ld2-export-actions,
  #ld2-panel .ld2-export-stop,
  #ld2-panel .ld2-summary-actions {
    grid-template-columns: 1fr;
  }

  #ld2-panel .ld2-card-header {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  #ld2-panel .ld2-card-status {
    max-width: 100%;
    text-align: left;
  }

  #ld2-panel .ld2-row {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  #ld2-panel .ld2-row > :last-child,
  #ld2-panel .ld2-row .stack,
  #ld2-panel .ld2-row input[type='text'],
  #ld2-panel .ld2-row input[type='number'],
  #ld2-panel .ld2-row select {
    width: 100% !important;
    max-width: 100%;
  }

  #ld2-panel .ld2-row .title {
    max-width: 100%;
    white-space: normal;
  }

  #ld2-panel .ld2-row .sub {
    font-size: 11px;
    line-height: 1.4;
  }

  #ld2-panel .ld2-pair-grid {
    width: 100% !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }

  #ld2-panel .ld2-select {
    width: 100%;
  }

  #ld2-toast {
    right: 10px;
    width: calc(100vw - 20px);
  }
}

@media (prefers-reduced-motion: reduce) {
  #ld2-panel,
  #ld2-toast,
  #ld2-fab,
  #ld2-fab-home,
  #ld2-fab-export,
  #ld2-panel .ld2-progress-bar,
  #ld2-panel .btn,
  #ld2-panel .ld2-preset {
    transition: none !important;
    animation: none !important;
  }
}
`

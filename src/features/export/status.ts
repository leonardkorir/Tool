export function getExportProgressValue(statusText: string): number {
  const text = String(statusText ?? '').trim()
  if (!text || /空闲|已停止|已取消/.test(text)) return 0
  if (/失败|完成/.test(text)) return 100
  if (/准备/.test(text)) return 8
  if (/抓取|当前已渲染楼层/.test(text)) return 28
  if (/脱敏/.test(text)) return 48
  if (/资源内联/.test(text)) return 66
  if (/生成|目录/.test(text)) return 82
  if (/下载/.test(text)) return 94
  return 12
}

export function isExportBusyStatus(statusText: string): boolean {
  const text = String(statusText ?? '').trim()
  if (!text) return false
  return !/空闲|完成|失败|已停止|已取消/.test(text)
}

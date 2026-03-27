import { createApp } from './app/createApp'
import { createLogger } from './app/createLogger'
import { createRouter } from './app/router'
import { createDiscoursePlatform } from './platform/discourse/platform'
import { createStorageService } from './platform/tampermonkey/storage'
import { exportFeature } from './features/export/exportFeature'
import { autoReadFeature } from './features/autoRead/autoReadFeature'
import { filterFeature } from './features/filter/filterFeature'
import { uiFeature } from './features/ui/uiFeature'

function isTopWindow(): boolean {
  try {
    return window.top === window
  } catch {
    return true
  }
}

function isAlreadyLoaded(): boolean {
  const g = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : globalThis) as unknown as Record<
    string,
    unknown
  >
  const key = '__ld2_v2_loaded__'
  if (g[key]) return true
  g[key] = true
  return false
}

function main(): void {
  if (!isTopWindow()) return
  if (isAlreadyLoaded()) return

  const logger = createLogger('linuxdo-tool-v2')
  const router = createRouter()
  const discourse = createDiscoursePlatform()
  const storage = createStorageService('ld_v2')

  const app = createApp({
    ctx: { logger, router, discourse, storage },
    features: [uiFeature(), exportFeature(), filterFeature(), autoReadFeature()],
  })

  app.start()
  logger.info('loaded')
}

main()

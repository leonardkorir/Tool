import { combineDisposables, toDisposable } from '../shared/disposable'
import type { AppContext, Feature } from './types'

export function createApp(options: { ctx: AppContext; features: Feature[] }) {
  const { ctx, features } = options

  let mounted = false
  let featureDisposers = new Map<string, { dispose(): void }>()

  function mountAll(): void {
    if (mounted) return
    mounted = true
    ctx.logger.info(`mount ${features.length} features`)
    for (const feature of features) {
      try {
        const d = feature.mount(ctx)
        if (d) featureDisposers.set(feature.id, d)
      } catch (err) {
        ctx.logger.error(`feature mount failed: ${feature.id}`, err)
      }
    }
  }

  function disposeAll(): void {
    if (!mounted) return
    mounted = false
    for (const [id, d] of featureDisposers) {
      try {
        d.dispose()
      } catch (err) {
        ctx.logger.warn(`feature dispose failed: ${id}`, err)
      }
    }
    featureDisposers = new Map()
  }

  const routerSubscription = ctx.router.onChange((href) => {
    ctx.logger.debug(`route change: ${href}`)
  })

  return {
    start() {
      mountAll()
      return combineDisposables(routerSubscription, toDisposable(disposeAll))
    },
  }
}

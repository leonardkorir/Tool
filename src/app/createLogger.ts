import type { Logger } from './types'

export function createLogger(prefix: string): Logger {
  const tag = `[${prefix}]`
  return {
    debug: (message, ...args) => console.debug(tag, message, ...args),
    info: (message, ...args) => console.info(tag, message, ...args),
    warn: (message, ...args) => console.warn(tag, message, ...args),
    error: (message, ...args) => console.error(tag, message, ...args),
  }
}

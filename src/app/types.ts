import type { Disposable } from '../shared/disposable'

export interface Feature {
  id: string
  mount(ctx: AppContext): Disposable | undefined
}

export interface AppContext {
  logger: Logger
  storage: StorageService
  router: Router
  discourse: DiscoursePlatform
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export interface StorageService {
  get<T>(key: string, fallback: T): T
  set<T>(key: string, value: T): void
  remove(key: string): void
}

export interface Router {
  getHref(): string
  onChange(listener: (href: string) => void): Disposable
}

export interface DiscourseRouteInfo {
  href: string
  pathname: string
  isTopic: boolean
  topicId: number | null
  isUserActivity: boolean
  username: string | null
}

export interface DiscoursePlatform {
  getRouteInfo(href?: string): DiscourseRouteInfo
}

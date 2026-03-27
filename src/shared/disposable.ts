export type Dispose = () => void

export interface Disposable {
  dispose(): void
}

export function toDisposable(dispose: Dispose): Disposable {
  return { dispose }
}

export function combineDisposables(...disposables: Array<Disposable | undefined>): Disposable {
  return toDisposable(() => {
    for (const d of disposables) d?.dispose()
  })
}

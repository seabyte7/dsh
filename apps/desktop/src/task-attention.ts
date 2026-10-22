/** Process-local unread Session results, acknowledged only through a focused native Conversation. */
import type { BrowserWindow } from 'electron'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type {
  DesktopCompletionChange, DesktopCompletionSnapshot, DesktopCompletionView,
} from '@deepseek-ai/dsh-client-desktop-completions/types'

type NavigationListener = (event: Electron.Event, url: string, inPlace: boolean, mainFrame: boolean) => void
type AttentionWindow = Pick<BrowserWindow, 'isDestroyed' | 'isVisible' | 'isMinimized' | 'isFocused'> & {
  on(event: 'focus' | 'closed', listener: () => void): void
  off(event: 'focus' | 'closed', listener: () => void): void
  readonly webContents: {
    on(event: 'did-start-navigation', listener: NavigationListener): void
    on(event: 'render-process-gone', listener: () => void): void
    off(event: 'did-start-navigation', listener: NavigationListener): void
    off(event: 'render-process-gone', listener: () => void): void
  }
}

/**
 * Validate a renderer-owned loaded position before using it for acknowledgement.
 * @param value - untrusted IPC payload.
 * @returns whether the payload is a nullable Session identity and non-negative durable cursor.
 */
export function isDesktopCompletionView(value: unknown): value is DesktopCompletionView {
  return value === null || (typeof value === 'object' && 'sessionId' in value && 'seq' in value
    && typeof value.sessionId === 'string' && value.sessionId.length > 0
    && typeof value.seq === 'number' && Number.isSafeInteger(value.seq) && value.seq >= 0)
}

/** Owns Dock membership independently of renderer and Host replacement. */
export class DesktopTaskAttention {
  private readonly unread = new Map<SessionId, SessionSeq>()
  private readonly latest = new Map<SessionId, SessionSeq>()
  private snapshot: DesktopCompletionSnapshot = { revision: 0, unread: [] }
  private view: DesktopCompletionView = null
  private window: AttentionWindow | undefined
  private unbind: (() => void) | undefined

  /**
   * @param badge - native Dock setter; failure leaves unread state intact.
   * @param publish - complete snapshots delivered to the owned application renderer.
   */
  constructor(private readonly badge: (text: string) => void, private readonly publish: (snapshot: DesktopCompletionSnapshot) => void) {}

  /** @returns the latest immutable unread snapshot without acknowledging it. */
  status(): DesktopCompletionSnapshot { return this.snapshot }

  /**
   * Observe one active Host's live Session changes.
   * @param change - validated Host lifecycle message.
   */
  observe(change: DesktopCompletionChange): void {
    if (change.kind !== 'completed') {
      if (change.kind === 'removed') this.latest.delete(change.sessionId)
      if (this.unread.delete(change.sessionId)) this.changed()
      return
    }
    if (change.seq <= (this.latest.get(change.sessionId) ?? -1)) return
    this.latest.set(change.sessionId, change.seq)
    this.unread.set(change.sessionId, change.seq)
    this.acknowledge()
    this.changed()
  }

  /**
   * Bind native focus and navigation to the owned main window.
   * @param window - the application window; closing it to the background retains unread results.
   */
  bind(window: AttentionWindow): void {
    this.unbind?.()
    this.window = window
    this.view = null
    const focus = (): void => { if (this.acknowledge()) this.changed() }
    const clear = (): void => { this.view = null }
    const navigation = (_event: Electron.Event, _url: string, inPlace: boolean, mainFrame: boolean): void => {
      if (mainFrame && !inPlace) clear()
    }
    window.on('focus', focus)
    window.webContents.on('did-start-navigation', navigation)
    window.webContents.on('render-process-gone', clear)
    window.on('closed', clear)
    this.unbind = () => {
      window.off('focus', focus)
      window.webContents.off('did-start-navigation', navigation)
      window.webContents.off('render-process-gone', clear)
      window.off('closed', clear)
    }
  }

  /**
   * Record a validated loaded result; native focus and visibility decide acknowledgement.
   * @param view - current Conversation position, or null while its content is unavailable.
   */
  viewed(view: DesktopCompletionView): void {
    this.view = view
    if (this.acknowledge()) this.changed()
  }

  /** Clear old Host membership and viewing state before a replacement Host starts. */
  reset(): void {
    this.unread.clear()
    this.latest.clear()
    this.view = null
    this.changed()
  }

  /** Release native listeners and clear the process-owned badge on application exit. */
  dispose(): void {
    this.unbind?.()
    this.unbind = undefined
    this.window = undefined
    this.reset()
  }

  private acknowledge(): boolean {
    const window = this.window
    const view = this.view
    if (view === null || window === undefined || window.isDestroyed() || !window.isVisible()
      || window.isMinimized() || !window.isFocused()) return false
    const seq = this.unread.get(view.sessionId)
    return seq !== undefined && view.seq >= seq && this.unread.delete(view.sessionId)
  }

  private changed(): void {
    this.snapshot = { revision: this.snapshot.revision + 1,
      unread: [...this.unread].map(([sessionId, seq]) => ({ sessionId, seq })) }
    try { this.badge(this.unread.size === 0 ? '' : String(this.unread.size)) }
    catch (error) { console.warn('desktop completions: Dock badge unavailable; unread results retained', error) }
    this.publish(this.snapshot)
  }
}

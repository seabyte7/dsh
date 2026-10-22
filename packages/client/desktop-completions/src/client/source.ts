/** Shell-owned unread snapshots and the loaded result position of the main Conversation. */
import type { ISessions, SessionBinding, SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { HostObservable, StandardSourceBinding } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { DesktopCompletionsBridge, DesktopCompletionSnapshot, DesktopCompletionView } from '../types.ts'

/** One Client plugin lifetime; shell state survives replacement of this instance. */
export class DesktopCompletions {
  /** Complete native unread membership, shared by every Session status consumer. */
  readonly unread = createSnapshotStore<ReadonlySet<SessionId>>(new Set())
  private active = true
  private disposal: Promise<void> | undefined
  private revision = -1
  private binding: SessionBinding | undefined
  private readonly subscriptions: (() => void)[] = []
  private historySubscriptions: (() => void)[] = []
  private view: DesktopCompletionView = null
  private loadedThrough: SessionSeq | undefined
  private readonly pending = new Set<Promise<void>>()

  /**
   * @param bridge - owned macOS preload operations.
   * @param sessions - Controller-owned history and Session lifetimes.
   * @param main - retained main Session binding.
   * @param panel - selected main panel; a retained Conversation behind another panel is unread.
   * @param report - accessible diagnostic sink for failed native reads or acknowledgements.
   */
  constructor(
    private readonly bridge: DesktopCompletionsBridge,
    private readonly sessions: ISessions,
    private readonly main: HostObservable<StandardSourceBinding>,
    private readonly panel: HostObservable<PanelInfo>,
    private readonly report: (error: unknown) => void,
  ) {
    this.subscriptions.push(bridge.subscribe((snapshot) => { this.receive(snapshot) }))
    this.track(bridge.status().then((snapshot) => { this.receive(snapshot) }))
    this.subscriptions.push(main.subscribe(() => { this.retarget() }), panel.subscribe(() => { this.publishView() }))
    this.retarget()
  }

  /**
   * Detach sources and release the main viewing position after submitted IPC settles.
   * @returns completion of detachment and native acknowledgement cleanup.
   */
  dispose(): Promise<void> { return this.disposal ??= this.close() }

  private async close(): Promise<void> {
    this.active = false
    for (const dispose of [...this.subscriptions, ...this.historySubscriptions]) dispose()
    await Promise.all(this.pending)
    try { await this.bridge.viewed(null) }
    catch (error) { this.report(error) }
  }

  private receive(snapshot: DesktopCompletionSnapshot): void {
    if (!this.active || snapshot.revision <= this.revision) return
    this.revision = snapshot.revision
    this.unread.set(new Set(snapshot.unread.map(value => value.sessionId)))
  }

  private retarget(): void {
    const id = this.main.getSnapshot().key as SessionId | undefined
    const binding = id === undefined ? undefined : this.sessions.binding(id)
    if (binding !== this.binding) {
      for (const dispose of this.historySubscriptions) dispose()
      this.binding = binding
      this.loadedThrough = undefined
      this.historySubscriptions = binding === undefined ? [] : [
        binding.eventSource.subscribe(() => { this.observeHistory(binding) }),
        binding.session.subscribe(() => { this.publishView() }),
      ]
      if (binding !== undefined) this.consume(binding.eventSource.getSnapshot().entries)
    }
    this.publishView()
  }

  private publishView(): void {
    const binding = this.binding
    let view: DesktopCompletionView = null
    if (binding !== undefined && this.panel.getSnapshot().activePanelId === null
      && binding.session.getSnapshot().openState === 'open' && !binding.session.getSnapshot().removed) {
      if (this.loadedThrough !== undefined) view = { sessionId: binding.sessionId, seq: this.loadedThrough }
    }
    if (view?.sessionId === this.view?.sessionId && view?.seq === this.view?.seq) return
    this.view = view
    this.track(this.bridge.viewed(view))
  }

  private observeHistory(binding: SessionBinding): void {
    const change = binding.eventSource.getSnapshot().change
    if (change.kind === 'replace') this.loadedThrough = undefined
    if (change.kind !== 'settle-assistant') this.consume(change.entries)
    this.publishView()
  }

  private consume(entries: readonly SessionEventLikeEntry[]): void {
    const last = entries.findLast(entry => entry.type === 'event' && entry.event.type === 'turn/end')
    if (last?.type === 'event' && last.event.seq > (this.loadedThrough ?? -1)) this.loadedThrough = last.event.seq
  }

  private track(operation: Promise<void>): void {
    const pending = operation.catch((error: unknown) => { if (this.active) this.report(error) })
      .finally(() => { this.pending.delete(pending) })
    this.pending.add(pending)
  }
}

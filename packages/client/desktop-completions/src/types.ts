/** Process-local completion messages shared by the Desktop Host, shell, and Client. */
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'

/** A live top-level Session result awaiting acknowledgement. */
export interface DesktopCompletion {
  readonly sessionId: SessionId
  readonly seq: SessionSeq
}

/** Host lifecycle changes; historical Session reads never emit these messages. */
export type DesktopCompletionChange =
  | { readonly kind: 'started'; readonly sessionId: SessionId }
  | { readonly kind: 'completed'; readonly sessionId: SessionId; readonly seq: SessionSeq }
  | { readonly kind: 'removed'; readonly sessionId: SessionId }

/** Shell-owned unread results; revisions increase throughout one shell lifetime. */
export interface DesktopCompletionSnapshot {
  readonly revision: number
  readonly unread: readonly DesktopCompletion[]
}

/** Last completed turn loaded in the main Conversation; null means no visible result. */
export type DesktopCompletionView = DesktopCompletion | null

/** Isolated macOS preload API; ordinary browsers and other platforms omit it. */
export interface DesktopCompletionsBridge {
  /** @returns the current shell snapshot, without acknowledging any result. */
  status(): Promise<DesktopCompletionSnapshot>
  /**
   * Observe unread changes before requesting the initial snapshot.
   * @param listener - receives complete, revisioned unread snapshots.
   * @returns unsubscribe function.
   */
  subscribe(listener: (snapshot: DesktopCompletionSnapshot) => void): () => void
  /**
   * Report the main Conversation's loaded result; the shell also requires native focus and visibility.
   * @param view - loaded completion position, or null when the Conversation is unavailable.
   * @returns completion of the shell's update; stale positions cannot acknowledge newer results.
   */
  viewed(view: DesktopCompletionView): Promise<void>
}

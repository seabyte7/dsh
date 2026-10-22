/** Side-chat requests and log-derived snapshot metadata. Types only. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { OptionalSessionSeq, SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-projection/types'

/** Stable side-chat identity, retained across creation retries and view restoration. */
export type SideChatRequestId = Branded<'SideChatRequestId'>

/** Source conversation and optional side-chat identity; omission addresses its legacy association. */
export interface SideChatLookupRequest {
  readonly sourceSessionId: SessionId
  readonly requestId?: SideChatRequestId
}

/** Idempotent association creation request; it never submits a prompt. */
export interface SideChatEnsureRequest extends SideChatLookupRequest {
  readonly requestId: SideChatRequestId
}

/** Committed text snapshot facts; the referenced text remains in the Session log. */
export interface SideChatSnapshot {
  readonly sourceSessionId: SessionId
  readonly capturedThroughSeq: OptionalSessionSeq
  readonly capturedFormatVersion: number
  readonly truncated: boolean
  readonly omittedBytes: number
  readonly omittedMessages: number
}

/** Existing association and its first committed snapshot, when available. */
export interface SideChatLookupValue {
  readonly sessionId?: SessionId
  readonly snapshot?: SideChatSnapshot
}

/** The target assigned to this side-chat identity, including on repeated requests. */
export interface SideChatEnsureValue {
  readonly sessionId: SessionId
}

/** Internal fold state retains the recorded preset for client projection selection. */
export interface SideChatProjectionState {
  readonly agentPreset: string | null
  readonly snapshot: SideChatSnapshot | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** First reference committed by a question Session. */
    sideChat: SideChatProjectionState
  }
  interface SessionProjectionMap {
    /** Committed source text snapshot, absent before initialization. */
    sideChat: { readonly snapshot: SideChatSnapshot | null } | null
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Side-chat admission failed; no replacement Session or prompt is created. */
    'side-chat/unavailable': {
      readonly reason: 'closed' | 'owner-required' | 'not-found' | 'archived' | 'migration-required'
        | 'nested' | 'preset' | 'tools' | 'input' | 'association' | 'storage' | 'context'
      readonly sessionId?: SessionId
    }
  }
}

/** Unsent questions and creation feedback survive tab-body remounts. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

interface QuestionDraft {
  readonly text: string
  readonly requestId?: string
  readonly sending: boolean
  readonly error?: string
}

interface SideChatViewState {
  drafts: Readonly<Record<string, QuestionDraft>>
}

type SideChatViewActions = {
  setDraft: (draft: SideChatViewState, source: SessionId, text: string) => void
  begin: (draft: SideChatViewState, source: SessionId, text: string, requestId: string) => void
  failed: (draft: SideChatViewState, source: SessionId, error: string) => void
  handedOff: (draft: SideChatViewState, source: SessionId) => void
}

/**
 * Declare view-only drafts shared by source Session identity.
 * @returns the Slot store declaration.
 */
export function createSideChatStore(): EngineStoreHandle<SideChatViewState, SideChatViewActions> {
  return defineStore({
    init: (): SideChatViewState => ({ drafts: {} }),
    actions: {
      setDraft: (draft, source: SessionId, text: string) => {
        draft.drafts = { ...draft.drafts, [source]: { ...draft.drafts[source], text, sending: false } }
      },
      begin: (draft, source: SessionId, text: string, requestId: string) => {
        draft.drafts = { ...draft.drafts, [source]: { text, requestId, sending: true } }
      },
      failed: (draft, source: SessionId, error: string) => {
        const previous = draft.drafts[source]
        draft.drafts = { ...draft.drafts, [source]: { text: '', ...previous, sending: false, error } }
      },
      handedOff: (draft, source: SessionId) => {
        draft.drafts = { ...draft.drafts, [source]: { text: '', sending: false } }
      },
    },
  })
}

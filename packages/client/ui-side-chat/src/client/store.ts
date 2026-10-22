/** Unsent questions and creation feedback survive tab-body remounts. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

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
  setDraft: (draft: SideChatViewState, address: string, text: string) => void
  begin: (draft: SideChatViewState, address: string, text: string, requestId: string) => void
  failed: (draft: SideChatViewState, address: string, error: string) => void
  handedOff: (draft: SideChatViewState, address: string) => void
}

/**
 * Declare view-only drafts isolated by side-chat resource address.
 * @returns the Slot store declaration.
 */
export function createSideChatStore(): EngineStoreHandle<SideChatViewState, SideChatViewActions> {
  return defineStore({
    init: (): SideChatViewState => ({ drafts: {} }),
    actions: {
      setDraft: (draft, address: string, text: string) => {
        draft.drafts = { ...draft.drafts, [address]: { ...draft.drafts[address], text, sending: false } }
      },
      begin: (draft, address: string, text: string, requestId: string) => {
        draft.drafts = { ...draft.drafts, [address]: { text, requestId, sending: true } }
      },
      failed: (draft, address: string, error: string) => {
        const previous = draft.drafts[address]
        draft.drafts = { ...draft.drafts, [address]: { text: '', ...previous, sending: false, error } }
      },
      handedOff: (draft, address: string) => {
        draft.drafts = { ...draft.drafts, [address]: { text: '', sending: false } }
      },
    },
  })
}

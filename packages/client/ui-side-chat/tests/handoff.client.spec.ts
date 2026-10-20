import { describe, expect, it } from 'vitest'
import { sessionSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { waitForSubmission } from '../src/client/handoff.ts'
import { createSideChatStore } from '../src/client/store.ts'

const SOURCE = 'source' as SessionId

describe('side-chat question lifetime', () => {
  it('keeps the acquisition until ordinary input admission and echoes settle', async () => {
    const state = createSnapshotStore<InputState>({
      draft: 'Question', attachmentIds: [], draftRev: 1, phase: 'adjudicating', occurrences: [], queue: [],
    })
    const session = createSnapshotStore(sessionSnapshot(SOURCE))
    let done = false
    const waiting = waitForSubmission(session, { state }, new AbortController().signal)
      .then(() => { done = true })
    await Promise.resolve()
    expect(done).toBe(false)
    state.set({ ...state.getSnapshot(), phase: 'plain' })
    await waiting
    expect(done).toBe(true)
  })

  it('releases its Client hold when the plugin unloads', async () => {
    const state = createSnapshotStore<InputState>({
      draft: 'Question', attachmentIds: [], draftRev: 1, phase: 'submitting', occurrences: [], queue: [],
    })
    const session = createSnapshotStore(sessionSnapshot(SOURCE))
    const controller = new AbortController()
    const waiting = waitForSubmission(session, { state }, controller.signal)
    controller.abort()
    await waiting
  })

  it('keeps a failed creation identity and unsent draft through view remounts', () => {
    const instance = createSideChatStore().create()
    instance.actions.setDraft(SOURCE, 'Question')
    instance.actions.begin(SOURCE, 'Question', 'stable-request')
    instance.actions.failed(SOURCE, 'Unavailable')
    expect(instance.getSnapshot().drafts[SOURCE]).toEqual({
      text: 'Question', requestId: 'stable-request', sending: false, error: 'Unavailable',
    })
    instance.actions.handedOff(SOURCE)
    expect(instance.getSnapshot().drafts[SOURCE]?.text).toBe('')
  })
})

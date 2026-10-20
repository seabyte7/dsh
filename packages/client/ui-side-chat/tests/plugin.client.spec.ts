import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type {
  SessionBinding, SessionReference,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { createScope } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { FixtureSession, sessionSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'
import { SideChatComposer, type HeaderInjected, type PanelInjected, type ComposerInjected } from '../src/client/Panel.tsx'
import { SIDE_CHAT_ID, sideChatAddress } from '../src/client/address.ts'
import { createSideChatStore } from '../src/client/store.ts'
import type {} from '@deepseek-ai/dsh-side-chat/types'

const SOURCE = 'source' as SessionId
const TARGET = 'target' as SessionId

async function fixture() {
  const ctx = new Context()
  const session = createSnapshotStore({ ...sessionSnapshot(TARGET), openState: 'open' as const })
  const cancel = vi.fn().mockResolvedValue({ ok: true, value: { accepted: true } })
  const sessionFace = new FixtureSession(TARGET, session, { cancel })
  const scope = createScope(ctx, TARGET)
  const binding: SessionBinding = {
    sessionId: TARGET,
    session: sessionFace,
    eventSource: sessionFace.eventSource,
    ctx: scope.ctx,
  }
  const release = vi.fn()
  const reference: SessionReference = {
    sessionId: TARGET, binding, ready: Promise.resolve(binding), release, [Symbol.dispose]: release,
  }
  const submit = vi.fn()
  const input = {
    submit,
    state: createSnapshotStore({ phase: 'plain', attachmentIds: [] as DraftAttachmentId[] }),
  }
  const initialize = vi.fn().mockReturnValue('applied')
  const ensure = vi.fn().mockResolvedValue({ ok: true, value: { sessionId: TARGET } })
  const lookup = vi.fn().mockResolvedValue({ ok: true, value: {} })
  const openResource = vi.fn()
  const using = vi.fn(async (_target: SessionId, _options: object, operation: (value: SessionReference) => Promise<void>) => {
    try {
      await operation(reference)
    } finally {
      reference.release()
    }
  })
  ctx.provide('sessions', { using, binding: () => binding } as never)
  ctx.provide('conversation', { input: { requestDraftInitialization: initialize, for: () => input } } as never)
  ctx.provide('remote', { sideChat: { ensure, lookup } } as never)
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key } as never)
  ctx.provide('resources', { register: () => () => {} } as never)
  ctx.provide('sidebarRight', { openResource } as never)
  ctx.provide('sidebarRightTabs', { register: () => () => {} } as never)
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
      'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session' },
      'conversation.composer': { kind: 'chain', scope: 'session' },
    },
  } as never, () => null)
  const fork = ctx.plugin({ inject: inject.filter(name => name !== 'remote.sideChat'), apply })
  await fork.await()
  const panel = ctx.slots.entries('sidebar.right.pane.tab').find(entry => entry.options.key === SIDE_CHAT_ID)!
  const draft = createSideChatStore().create()
  const actions = Reflect.apply(panel.inject!, undefined, [SOURCE, draft.actions]) as PanelInjected
  return { ctx, fork, binding, cancel, initialize, ensure, lookup, openResource, submit, using, release, draft, actions, input }
}

describe('side-chat plugin registration', () => {
  it('opens the source-only tab from the header without creating a Session', async () => {
    const f = await fixture()
    try {
      const action = f.ctx.slots.entries('conversation.session.header.actions').find(entry => entry.options.id === 'side-chat')!
      const injected = Reflect.apply(action.inject!, undefined, [SOURCE]) as HeaderInjected
      injected.open()
      expect(f.openResource).toHaveBeenCalledWith(sideChatAddress(SOURCE), { kind: 'sidechat', preferNewPane: true })
      expect(f.ensure).not.toHaveBeenCalled()
      expect(f.using).not.toHaveBeenCalled()
    } finally {
      await f.ctx.fiber.dispose()
    }
  })

  it('hands the first question to the exact retained binding before ordinary input submission', async () => {
    const f = await fixture()
    try {
      f.draft.actions.setDraft(SOURCE, 'Question')
      f.actions.send(SOURCE, 'Question', undefined)
      await vi.waitFor(() => { expect(f.submit).toHaveBeenCalledWith('queue', 'click') })
      expect(f.initialize).toHaveBeenCalledWith(f.binding, { prompt: 'Question', clearPreviousDraft: false })
      expect(f.using).toHaveBeenCalledWith(TARGET, expect.objectContaining({ source: 'sideChatSubmit' }), expect.any(Function))
      expect(f.draft.getSnapshot().drafts[SOURCE]?.text).toBe('')
      await vi.waitFor(() => { expect(f.release).toHaveBeenCalledOnce() })
    } finally {
      await f.ctx.fiber.dispose()
    }
  })

  it.each(['preserved', 'blocked'])('keeps both drafts without submitting when initialization is %s', async (outcome) => {
    const f = await fixture()
    try {
      f.initialize.mockReturnValue(outcome)
      f.draft.actions.setDraft(SOURCE, 'Question')
      f.actions.send(SOURCE, 'Question', undefined)
      await vi.waitFor(() => { expect(f.draft.getSnapshot().drafts[SOURCE]?.error).toBe('handoffFailed') })
      expect(f.submit).not.toHaveBeenCalled()
      expect(f.draft.getSnapshot().drafts[SOURCE]?.text).toBe('Question')
    } finally {
      await f.ctx.fiber.dispose()
    }
  })

  it('preserves an initial question when the target holds unsupported attachments', async () => {
    const f = await fixture()
    try {
      f.input.state.update((state) => { state.attachmentIds = ['attachment'] as DraftAttachmentId[] })
      f.draft.actions.setDraft(SOURCE, 'Question')
      f.actions.send(SOURCE, 'Question', undefined)
      await vi.waitFor(() => { expect(f.draft.getSnapshot().drafts[SOURCE]?.error).toBe('attachmentsUnsupported') })
      expect(f.initialize).not.toHaveBeenCalled()
      expect(f.submit).not.toHaveBeenCalled()
      expect(f.draft.getSnapshot().drafts[SOURCE]?.text).toBe('Question')
      expect(f.input.state.getSnapshot().attachmentIds).toEqual(['attachment'])
    } finally {
      await f.ctx.fiber.dispose()
    }
  })

  it('claims a cold question Session from the reactive owner projection and cancels only that target', async () => {
    const f = await fixture()
    try {
      const entry = f.ctx.slots.entries('conversation.composer').find(value => value.component === SideChatComposer)!
      const select = entry.select as (owner: ComposerChainProps) => { sideChat: true } | null
      const owner: ComposerChainProps = {
        sessionId: TARGET, session: sessionSnapshot(TARGET), pendingInteraction: undefined,
        projectionValues: { sideChat: { snapshot: null } },
      }
      expect(select(owner)).toEqual({ sideChat: true })
      expect(select({ ...owner, projectionValues: { sideChat: null } })).toBeNull()
      const injected = Reflect.apply(entry.inject!, undefined, [TARGET]) as ComposerInjected
      injected.stop()
      expect(f.cancel).toHaveBeenCalledOnce()
    } finally {
      await f.ctx.fiber.dispose()
    }
  })

  it('disposes all foreign-slot contributions with the feature lifetime', async () => {
    const f = await fixture()
    try {
      await f.fork.dispose()
      expect(f.ctx.slots.entries('conversation.session.header.actions')).toHaveLength(0)
      expect(f.ctx.slots.entries('conversation.composer')).toHaveLength(0)
      expect(f.ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
    } finally {
      await f.ctx.fiber.dispose()
    }
  })
})

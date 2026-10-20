// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionReference, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { makeTranslate, sessionSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import type { DraftAttachmentId, InputActions, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ResourceSnapshot } from '@deepseek-ai/dsh-client-resources/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SideChatResource } from '../src/client/resources.ts'
import {
  FixedChatView, HeaderAction, SideChatComposer, SideChatConversation, SideChatPanel,
  type HeaderActionProps, type SideChatComposerProps, type SideChatConversationProps, type SideChatPanelProps,
} from '../src/client/Panel.tsx'
import { en, zh } from '../src/client/locales.ts'
import { sideChatAddress } from '../src/client/address.ts'
import { createSideChatStore } from '../src/client/store.ts'
import type {} from '../src/client/index.ts'

const SOURCE = 'source' as SessionId
const TARGET = 'target' as SessionId
const t = makeTranslate(en)

afterEach(cleanup)

describe('side-chat panel', () => {
  it('opens the empty view without sending and retains a typed question in the declared store', () => {
    const store = createSideChatStore().create()
    const send = vi.fn()
    const props = {
      t,
      useTabInfo: () => ({ tab: { id: 'tab', contentId: sideChatAddress(SOURCE) } }),
      useResource: () => ({ status: 'live', value: { sourceSessionId: SOURCE }, failure: undefined }),
      useStore: (select: (state: ReturnType<typeof store.getSnapshot>) => unknown) => select(store.getSnapshot()),
      actions: store.actions,
      send,
      refresh: vi.fn(),
      renderSlot: vi.fn(),
      SessionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    } as SideChatPanelProps
    const view = render(<SideChatPanel {...props} />)
    expect(send).not.toHaveBeenCalled()
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'Why?' } })
    view.rerender(<SideChatPanel {...props} />)
    expect(store.getSnapshot().drafts[SOURCE]?.text).toBe('Why?')
    fireEvent.click(view.getByRole('button', { name: 'Send' }))
    expect(send).toHaveBeenCalledWith(SOURCE, 'Why?', undefined)
  })

  it('keeps slash-prefixed questions as a visible validation error without calling send', () => {
    const store = createSideChatStore().create()
    store.actions.setDraft(SOURCE, '  /fork')
    const send = vi.fn()
    const props = {
      t,
      useTabInfo: () => ({ tab: { id: 'tab', contentId: sideChatAddress(SOURCE) } }),
      useResource: () => ({ status: 'live', value: { sourceSessionId: SOURCE }, failure: undefined }),
      useStore: (select: (state: ReturnType<typeof store.getSnapshot>) => unknown) => select(store.getSnapshot()),
      actions: store.actions, send, refresh: vi.fn(), renderSlot: vi.fn(),
      SessionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    } as SideChatPanelProps
    const view = render(<SideChatPanel {...props} />)
    expect(view.getByRole('alert').textContent).toContain('does not support slash commands')
    expect((view.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.submit(view.getByRole('textbox').closest('form')!)
    expect(send).not.toHaveBeenCalled()
    expect(store.getSnapshot().drafts[SOURCE]?.text).toBe('  /fork')
  })

  it('binds the target reference and keeps stale history beside a load failure', () => {
    const store = createSideChatStore().create()
    const reference = { sessionId: TARGET } as SessionReference
    const SessionProvider = vi.fn(({ children }: { children: ReactNode }) => <>{children}</>)
    const renderSlot = vi.fn(() => <p>Target history</p>)
    const resource = {
      status: 'failed', value: { sourceSessionId: SOURCE, reference },
      failure: new RemoteError('side-chat/unavailable', 'Host diagnostic: archived', { reason: 'archived' }),
    } as ResourceSnapshot<SideChatResource>
    const props = {
      t: makeTranslate(zh),
      useTabInfo: () => ({ tab: { id: 'tab', contentId: sideChatAddress(SOURCE) } }),
      useResource: () => resource,
      useStore: (select: (state: ReturnType<typeof store.getSnapshot>) => unknown) => select(store.getSnapshot()),
      actions: store.actions, send: vi.fn(), refresh: vi.fn(), renderSlot, SessionProvider,
    } as SideChatPanelProps
    const view = render(<SideChatPanel {...props} />)
    expect(view.getByText('Target history')).toBeTruthy()
    expect(view.getByRole('alert').textContent).toContain('聊天已归档，请取消归档后重试')
    expect(view.getByRole('alert').textContent).not.toContain('Host diagnostic')
    expect(SessionProvider).toHaveBeenCalledWith(expect.objectContaining({ session: reference }), {})
    expect(renderSlot).toHaveBeenCalledWith('sidechat.conversation', {})
  })
})

describe('side-chat embedded Conversation', () => {
  it('fixes Chat while displaying the committed source position and cropping notice', () => {
    const renderFactorySlot = vi.fn(() => null)
    const props = {
      t,
      useProjection: () => ({ snapshot: { capturedThroughSeq: 34, truncated: true } }),
      useSession: (select: (value: SessionSnapshot) => unknown) => select(sessionSnapshot(TARGET)),
      renderFactorySlot,
    } as SideChatConversationProps
    const view = render(<SideChatConversation {...props} />)
    expect(view.getByRole('status').textContent).toContain('through event 34')
    expect(view.getByRole('status').textContent).toContain('Context was cropped')
    expect(renderFactorySlot).toHaveBeenCalledWith('conversation.content', {
      variant: 'embedded', phase: 'active', hero: false,
    }, { slots: { views: FixedChatView } })
  })

  it('hides the nested header action even before the first source snapshot is committed', () => {
    const open = vi.fn()
    const view = render(<HeaderAction {...({ t, open, useProjection: () => ({ snapshot: null }) } as HeaderActionProps)} />)
    expect(view.queryByRole('button')).toBeNull()
    expect(open).not.toHaveBeenCalled()
  })
})

function composerFixture(options: { draft?: string; archived?: boolean; running?: boolean; attachmentIds?: DraftAttachmentId[] } = {}) {
  const submit = vi.fn()
  const stop = vi.fn()
  const setDraft = vi.fn()
  const removeAttachment = vi.fn()
  const input: InputState = {
    draft: options.draft ?? 'Follow up', attachmentIds: options.attachmentIds ?? [], draftRev: 1,
    phase: 'plain', occurrences: [], queue: [],
  }
  const props = {
    t, sessionId: TARGET,
    matched: { sideChat: true },
    useInput: (select: (value: InputState) => unknown) => select(input),
    useSession: (select: (value: SessionSnapshot) => unknown) => select({
      ...sessionSnapshot(TARGET), running: options.running ?? false, openState: 'open',
    }),
    useAccess: () => true,
    useWorkspaces: (select: (value: { archivedSessionIds: SessionId[] }) => unknown) => (
      select({ archivedSessionIds: options.archived ? [TARGET] : [] })
    ),
    inputActions: {
      submit, setDraft, removeAttachment,
      captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }),
      insertText: () => false,
      persistDraft: () => {},
      addAttachments: () => false,
      pruneAttachments: () => {},
    } satisfies InputActions,
    stop,
  } as SideChatComposerProps
  return { props, submit, stop, setDraft, removeAttachment }
}

describe('side-chat composer', () => {
  it('uses the bound ordinary input actions and independent Stop callback', () => {
    const f = composerFixture({ running: true })
    const view = render(<SideChatComposer {...f.props} />)
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'Another question' } })
    expect(f.setDraft).toHaveBeenCalledWith('Another question')
    fireEvent.click(view.getByRole('button', { name: 'Send' }))
    expect(f.submit).toHaveBeenCalledOnce()
    fireEvent.click(view.getByRole('button', { name: 'Stop side chat' }))
    expect(f.stop).toHaveBeenCalledOnce()
    expect(view.queryByText('Attach')).toBeNull()
  })

  it.each(['/fork', '  /compact'])('does not execute slash command %s', (draft) => {
    const f = composerFixture({ draft })
    const view = render(<SideChatComposer {...f.props} />)
    fireEvent.submit(view.getByRole('textbox').closest('form')!)
    expect(f.submit).not.toHaveBeenCalled()
    expect(view.getByRole('alert').textContent).toContain('does not support slash commands')
  })

  it('keeps unsupported attachments visible and removes them only on an explicit action', () => {
    const attachments = ['image-draft', 'file-draft'] as DraftAttachmentId[]
    const f = composerFixture({ attachmentIds: attachments })
    const view = render(<SideChatComposer {...f.props} />)
    expect(view.getByRole('alert').textContent).toContain('Remove existing attachments')
    fireEvent.submit(view.getByRole('textbox').closest('form')!)
    expect(f.submit).not.toHaveBeenCalled()
    expect(f.removeAttachment).not.toHaveBeenCalled()
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Follow up')
    fireEvent.click(view.getByRole('button', { name: 'Remove attachments' }))
    expect(f.removeAttachment.mock.calls).toEqual(attachments.map(id => [id]))
  })

  it('disables input for archived targets while preserving the question', () => {
    const f = composerFixture({ archived: true })
    const view = render(<SideChatComposer {...f.props} />)
    expect((view.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Follow up')
    expect(view.getByText('This side chat is currently read-only')).toBeTruthy()
    fireEvent.submit(view.getByRole('textbox').closest('form')!)
    expect(f.submit).not.toHaveBeenCalled()
  })
})

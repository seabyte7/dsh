// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionReference, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { makeTranslate, sessionSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import type { ComposerBarOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ResourceSnapshot } from '@deepseek-ai/dsh-client-resources/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SideChatRequestId } from '@deepseek-ai/dsh-side-chat/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SideChatResource } from '../src/client/resources.ts'
import {
  FixedChatView, HeaderAction, SideChatGuide, SideChatConversation, SideChatPanel,
  type HeaderActionProps, type SideChatConversationProps, type SideChatPanelProps,
} from '../src/client/Panel.tsx'
import { en, zh } from '../src/client/locales.ts'
import { sideChatAddress, parseSideChatAddress } from '../src/client/address.ts'
import { createSideChatStore } from '../src/client/store.ts'
import type {} from '../src/client/index.ts'

const SOURCE = 'source' as SessionId
const TARGET = 'target' as SessionId
const ADDRESS = sideChatAddress(SOURCE)
const t = makeTranslate(en)

afterEach(cleanup)

function factoryInput(props: SideChatPanelProps): ComposerBarOwnerProps {
  const call = vi.mocked(props.renderFactorySlot).mock.calls.findLast(([name]) => name === 'conversation.input')
  return call![1] as ComposerBarOwnerProps
}

describe('side-chat panel', () => {
  it('clears old history, failure, and draft when a new side chat opens on the same source', () => {
    const oldAddress = sideChatAddress(SOURCE, 'old' as SideChatRequestId)
    const freshAddress = sideChatAddress(SOURCE, 'fresh' as SideChatRequestId)
    const store = createSideChatStore().create()
    store.actions.setDraft(oldAddress, 'OLD_DRAFT')
    store.actions.failed(oldAddress, 'OLD_FAILURE')
    let address = oldAddress
    let resource: ResourceSnapshot<SideChatResource> = {
      status: 'live', value: { ...parseSideChatAddress(oldAddress)!, reference: { sessionId: TARGET } as SessionReference },
      failure: undefined,
    }
    const renderSlot = vi.fn(() => <p>OLD_HISTORY</p>)
    const renderFactorySlot = vi.fn(() => null)
    const props = {
      t, useTabInfo: () => ({ tab: { id: 'same-seat', contentId: address } }),
      useResource: () => resource,
      useStore: (select: (state: ReturnType<typeof store.getSnapshot>) => unknown) => select(store.getSnapshot()),
      actions: store.actions, send: vi.fn(), refresh: vi.fn(), renderSlot, renderFactorySlot,
      SessionProvider: ({ children, empty }: { children?: ReactNode; empty?: () => ReactNode }) => <>{empty?.() ?? children}</>,
    } as SideChatPanelProps
    const view = render(<SideChatPanel {...props} />)
    expect(view.getByText('OLD_HISTORY')).toBeTruthy()
    address = freshAddress
    view.rerender(<SideChatPanel {...props} />)
    expect(view.queryByText('OLD_HISTORY')).toBeNull()
    expect(view.queryByText('OLD_FAILURE')).toBeNull()
    resource = { status: 'live', value: parseSideChatAddress(freshAddress)!, failure: undefined }
    view.rerender(<SideChatPanel {...props} />)
    expect(factoryInput(props).pendingDraft?.text).toBe('')
    expect(store.getSnapshot().drafts[oldAddress]?.text).toBe('OLD_DRAFT')
    expect(store.getSnapshot().drafts[freshAddress]).toBeUndefined()
  })

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
      renderSlot: vi.fn(), renderFactorySlot: vi.fn(() => null),
      SessionProvider: ({ empty }: { empty?: () => ReactNode }) => <>{empty?.()}</>,
    } as SideChatPanelProps
    const view = render(<SideChatPanel {...props} />)
    expect(send).not.toHaveBeenCalled()
    factoryInput(props).pendingDraft!.onChange('Why?')
    view.rerender(<SideChatPanel {...props} />)
    expect(store.getSnapshot().drafts[ADDRESS]?.text).toBe('Why?')
    factoryInput(props).pendingDraft!.onSubmit()
    expect(send).toHaveBeenCalledWith(ADDRESS, 'Why?', undefined)
  })

  it('keeps slash-prefixed questions as a visible validation error without calling send', () => {
    const store = createSideChatStore().create()
    store.actions.setDraft(ADDRESS, '  /fork')
    const send = vi.fn()
    const props = {
      t,
      useTabInfo: () => ({ tab: { id: 'tab', contentId: sideChatAddress(SOURCE) } }),
      useResource: () => ({ status: 'live', value: { sourceSessionId: SOURCE }, failure: undefined }),
      useStore: (select: (state: ReturnType<typeof store.getSnapshot>) => unknown) => select(store.getSnapshot()),
      actions: store.actions, send, refresh: vi.fn(), renderSlot: vi.fn(), renderFactorySlot: vi.fn(() => null),
      SessionProvider: ({ empty }: { empty?: () => ReactNode }) => <>{empty?.()}</>,
    } as SideChatPanelProps
    const view = render(<SideChatPanel {...props} />)
    expect(view.getByRole('alert').textContent).toContain('does not support slash commands')
    expect(factoryInput(props).submissionBlocked).toContain('does not support slash commands')
    factoryInput(props).pendingDraft!.onSubmit()
    expect(send).not.toHaveBeenCalled()
    expect(store.getSnapshot().drafts[ADDRESS]?.text).toBe('  /fork')
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
      variant: 'embedded', phase: 'active', hero: false, input: { textOnly: true, placeholder: 'Ask about the main chat…' },
    }, { slots: { views: FixedChatView } })
  })

  it('hides the nested header action even before the first source snapshot is committed', () => {
    const open = vi.fn()
    const view = render(<HeaderAction {...({ t, open, useProjection: () => ({ snapshot: null }) } as HeaderActionProps)} />)
    expect(view.queryByRole('button')).toBeNull()
    expect(open).not.toHaveBeenCalled()
  })
})



it('opens side chat in the guide occurrence with its own source identity', () => {
  const openResource = vi.fn()
  const view = render(<SideChatGuide {...({
    sessionId: SOURCE, title: 'Side chat', description: 'Ask about this chat',
    useTabInfo: () => ({ tab: { actions: { openResource } } }),
    useProjection: () => null,
  } as Parameters<typeof SideChatGuide>[0])} />)
  fireEvent.click(view.getByRole('button', { name: 'Side chat Ask about this chat' }))
  expect(openResource).toHaveBeenCalledWith(expect.any(String), { replaceTab: true })
  const first = openResource.mock.calls[0]![0] as string
  expect(parseSideChatAddress(first)?.sourceSessionId).toBe(SOURCE)
  expect(parseSideChatAddress(first)?.requestId).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Side chat Ask about this chat' }))
  expect(openResource.mock.calls[1]![0]).not.toBe(first)
})

it('does not offer a nested side chat while the source projection is absent or already a side chat', () => {
  const props = {
    sessionId: TARGET, title: 'Side chat',
    useTabInfo: () => ({ tab: { actions: { openResource: vi.fn() } } }),
    useProjection: () => ({ snapshot: null }),
  } as Parameters<typeof SideChatGuide>[0]
  const view = render(<SideChatGuide {...props} />)
  expect(view.queryByRole('button')).toBeNull()
  view.rerender(<SideChatGuide {...props} useProjection={() => undefined} />)
  expect(view.queryByRole('button')).toBeNull()
})

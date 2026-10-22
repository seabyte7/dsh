// @vitest-environment jsdom
/** Native unread membership through the shipped Desktop roster and real Client Session Controller. */
import { afterEach, expect, vi } from 'vitest'
import { bundleRoster, createClientTest } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { ok } from '@deepseek-ai/dsh-remote-mock'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionFollowFrame, SessionFollowRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import type { DesktopCompletionsBridge, DesktopCompletionSnapshot } from '../src/types.ts'

const desktop = bundleRoster(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], undefined,
  { get: () => ({ name: 'desktop' }) })
const it = createClientTest({ roster: desktop.closure(['@deepseek-ai/dsh-client-desktop-completions']) })
afterEach(() => { vi.unstubAllGlobals() })

it('keeps the Client usable when reading native unread state fails', async ({ start }) => {
  const initial = Promise.withResolvers<DesktopCompletionSnapshot>()
  const bridge: DesktopCompletionsBridge = {
    status: () => initial.promise,
    viewed: async () => {},
    subscribe: () => () => {},
  }
  vi.stubGlobal('dshDesktop', { protocolVersion: 1, completions: bridge })
  const client = await start()
  try {
    initial.reject(new Error('native unread read unavailable'))
    await client.flush()
    expect(client.ctx.sessions.list.getSnapshot().phase).toBe('ready')
    expect([...client.ctx.uiSession.sessionStatus.getSnapshot().values()].some(value => value.completionUnread)).toBe(false)
  } finally {
    initial.resolve({ revision: 0, unread: [] })
    await client.dispose()
  }
})

it('shares background completion counts with the sidebar and acknowledges only loaded main results', async ({ mock, start }) => {
  let deliver: ((snapshot: DesktopCompletionSnapshot) => void) | undefined
  let snapshot: DesktopCompletionSnapshot = { revision: 0, unread: [] }
  const viewed = vi.fn<DesktopCompletionsBridge['viewed']>(async () => {})
  const bridge: DesktopCompletionsBridge = {
    status: async () => snapshot, viewed,
    subscribe: (listener) => { deliver = listener; return () => { deliver = undefined } },
  }
  const push = (ids: string[], seq = 3): void => {
    snapshot = { revision: snapshot.revision + 1, unread: ids.map(id => ({ sessionId: SessionId(id), seq: SessionSeq(seq) })) }
    deliver?.(snapshot)
  }
  vi.stubGlobal('dshDesktop', { protocolVersion: 1, completions: bridge })
  mock.remote.session.list.mockResolvedValue(ok({ items: ['first', 'second'].map(id => ({
    sessionId: SessionId(id), updatedAt: 1, running: false, blank: false, agentAvailable: true,
  })) }))
  mock.stream('session/follow', ([request], stream) => {
    const { address } = request as SessionFollowRequest
    if (address.kind !== 'session') throw new Error('fixture expects a top-level Session address')
    stream.push({ type: 'snapshot', header: { version: SESSION_FORMAT_VERSION, id: address.sessionId, createdAt: 1, isSeeded: false },
      cursor: 3, records: [
        { type: 'event', event: { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } },
        { type: 'event', event: { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } } },
        { type: 'event', event: { type: 'step/end', seq: 2, time: 1, data: { turn: 1, step: 1 } } },
        { type: 'event', event: { type: 'turn/end', seq: 3, time: 1, data: { turn: 1, reason: { kind: 'completed' } } } },
      ], hasMore: false, projections: { asOfSeq: 3, values: {} }, assistantStream: { revision: 0 },
    } satisfies SessionFollowFrame)
  })
  const observed: string[] = []
  const client = await start()
  try {
    const sessions = client.ctx.sessions
    await sessions.refresh()
    using reference = sessions.retain(SessionId('first'), { source: 'mainView' })
    await reference.ready
    await client.flush()
    expect(client.ctx.uiSession.adapter.current.getSnapshot().key).toBe('first')
    expect(reference.binding.session.getSnapshot().openError).toBeNull()
    expect(reference.binding.session.getSnapshot().openState).toBe('open')
    expect(reference.binding.eventSource.getSnapshot().entries).toHaveLength(4)
    expect(viewed).toHaveBeenLastCalledWith({ sessionId: 'first', seq: 3 })
    push(['first', 'second'])
    expect(client.ctx.uiSession.sessionStatus.getSnapshot().get(SessionId('first'))?.completionUnread).toBe(true)
    observed.push(`background: badge=${snapshot.unread.length}, first=unread, second=unread`)
    push(['second'])
    expect(client.ctx.uiSession.sessionStatus.getSnapshot().get(SessionId('first'))?.completionUnread).toBe(false)
    expect(client.ctx.uiSession.sessionStatus.getSnapshot().get(SessionId('second'))?.completionUnread).toBe(true)
    observed.push(`foreground first: badge=${snapshot.unread.length}, first=read, second=unread`)
    reference.release()
    using second = sessions.retain(SessionId('second'), { source: 'mainView' })
    await second.ready
    await client.flush()
    expect(viewed).toHaveBeenLastCalledWith({ sessionId: 'second', seq: 3 })
    push([])
    expect(client.ctx.uiSession.sessionStatus.getSnapshot().get(SessionId('second'))?.completionUnread).toBe(false)
    observed.push('foreground second: badge=empty, first=read, second=read')
    await expect(observed.join('\n') + '\n').toMatchFileSnapshot('./expected/completions.txt')
    push(['first'], 8)
    await client.reload('@deepseek-ai/dsh-client-desktop-completions')
    expect(snapshot.unread).toHaveLength(1)
    expect(client.ctx.uiSession.sessionStatus.getSnapshot().get(SessionId('first'))?.completionUnread).toBe(true)
    await client.unload('@deepseek-ai/dsh-client-desktop-completions')
    expect(deliver).toBeUndefined()
  } finally {
    await client.dispose()
  }
})

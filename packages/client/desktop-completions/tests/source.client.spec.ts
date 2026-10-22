import { Context } from '@deepseek-ai/cordis'
import { MutableSessionEventSource, type ISessions, type SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { AgentContext } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { StandardSourceBinding } from '@deepseek-ai/dsh-client-ui-slots'
import type { PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { afterEach, expect, it, vi } from 'vitest'
import type { DesktopCompletionSnapshot, DesktopCompletionsBridge } from '../src/types.ts'
import { DesktopCompletions } from '../src/client/source.ts'
import { apply } from '../src/client/index.ts'
import * as hostEntry from '../src/index.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

it.each([undefined, { protocolVersion: 0 }, { protocolVersion: 1 }])('leaves non-native clients on their existing policy (%j)', async (carrier) => {
  const ctx = new Context()
  vi.stubGlobal('dshDesktop', carrier)
  try {
    expect(() => { apply(ctx) }).not.toThrow()
    expect('default' in hostEntry).toBe(false)
    hostEntry.apply()
  } finally {
    await ctx.fiber.dispose()
    vi.unstubAllGlobals()
  }
})

function fixture(initial: Promise<DesktopCompletionSnapshot> = Promise.resolve({ revision: 0, unread: [] })) {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  let receive: ((value: DesktopCompletionSnapshot) => void) | undefined
  const detach = vi.fn(() => { receive = undefined })
  const bridge = {
    status: vi.fn(() => initial), viewed: vi.fn<DesktopCompletionsBridge['viewed']>(async () => {}),
    subscribe: (listener: (value: DesktopCompletionSnapshot) => void) => { receive = listener; return detach },
  } satisfies DesktopCompletionsBridge
  const bindings = new Map<SessionId, SessionBinding>()
  // The adapter observes Controller binding lookup, lifecycle snapshots and history only.
  const sessions = { binding: (id: SessionId) => bindings.get(id) } as ISessions
  const main = createSnapshotStore<StandardSourceBinding>({ key: undefined, hooks: {}, keyedHooks: {}, props: {} })
  const panel = createSnapshotStore<PanelInfo>({ activePanelId: null })
  const report = vi.fn()
  const source = new DesktopCompletions(bridge, sessions, main, panel, report)
  cleanups.push(() => source.dispose())
  const create = (id: string) => {
    const events = new MutableSessionEventSource()
    const state = createSnapshotStore({ openState: 'open', removed: false })
    const binding: SessionBinding = { sessionId: SessionId(id), eventSource: events, ctx: ctx as AgentContext,
      session: { getSnapshot: () => state.getSnapshot(), subscribe: listener => state.subscribe(listener) } as SessionBinding['session'] }
    bindings.set(binding.sessionId, binding)
    return { binding, state, events }
  }
  const select = (id?: string) => { main.set({ key: id, hooks: {}, keyedHooks: {}, props: {} }) }
  const push = (revision: number, ids: string[]) => receive?.({ revision,
    unread: ids.map(id => ({ sessionId: SessionId(id), seq: SessionSeq(4) })) })
  return { bridge, source, panel, report, create, select, push, detach }
}

function end(seq: number) {
  return { type: 'event' as const, event: { type: 'turn/end' as const, seq: SessionSeq(seq), time: 1,
    data: { turn: 1, reason: { kind: 'completed' as const } } } }
}

it('keeps newer pushed unread state when the initial native read arrives late', async () => {
  const initial = Promise.withResolvers<DesktopCompletionSnapshot>()
  const f = fixture(initial.promise)
  try {
    f.push(2, ['first', 'second'])
    initial.resolve({ revision: 1, unread: [] })
    await initial.promise
    expect([...f.source.unread.getSnapshot()]).toEqual(['first', 'second'])
    f.push(2, [])
    expect(f.source.unread.getSnapshot().size).toBe(2)
    f.push(3, ['second'])
    expect([...f.source.unread.getSnapshot()]).toEqual(['second'])
  } finally { initial.resolve({ revision: 0, unread: [] }) }
})

it('reports only loaded results in the visible main Conversation', () => {
  const f = fixture()
  const first = f.create('first')
  f.select('first')
  expect(f.bridge.viewed).not.toHaveBeenCalled()
  first.events.append(end(4))
  expect(f.bridge.viewed).toHaveBeenLastCalledWith({ sessionId: 'first', seq: 4 })
  f.panel.set({ activePanelId: 'files' as PanelInfo['activePanelId'] })
  expect(f.bridge.viewed).toHaveBeenLastCalledWith(null)
  first.events.append(end(8))
  f.panel.set({ activePanelId: null })
  expect(f.bridge.viewed).toHaveBeenLastCalledWith({ sessionId: 'first', seq: 8 })
  first.state.set({ openState: 'loading', removed: false })
  expect(f.bridge.viewed).toHaveBeenLastCalledWith(null)
  first.state.set({ openState: 'open', removed: false })
  expect(f.bridge.viewed).toHaveBeenLastCalledWith({ sessionId: 'first', seq: 8 })
  first.state.set({ openState: 'open', removed: true })
  expect(f.bridge.viewed).toHaveBeenLastCalledWith(null)
})

it('retargets history without acknowledging a retained previous Session', () => {
  const f = fixture()
  const first = f.create('first')
  const second = f.create('second')
  first.events.replace([end(4)], false)
  f.select('first')
  f.select('second')
  expect(f.bridge.viewed).toHaveBeenLastCalledWith(null)
  first.events.append(end(8))
  expect(f.bridge.viewed).toHaveBeenLastCalledWith(null)
  second.events.replace([end(12)], false)
  expect(f.bridge.viewed).toHaveBeenLastCalledWith({ sessionId: 'second', seq: 12 })
  second.events.prepend([end(3)], false)
  expect(f.bridge.viewed).toHaveBeenLastCalledWith({ sessionId: 'second', seq: 12 })
  second.events.settleAssistant('settled-attempt' as Parameters<typeof second.events.settleAssistant>[0])
  expect(f.bridge.viewed).toHaveBeenLastCalledWith({ sessionId: 'second', seq: 12 })
  second.events.append({ type: 'event', event: { type: 'step/end', seq: SessionSeq(13), time: 1, data: { turn: 2, step: 1 } } })
  second.events.replace([], false)
  expect(f.bridge.viewed).toHaveBeenLastCalledWith(null)
  f.select()
})

it('detaches native and history listeners and suppresses late snapshots', async () => {
  const f = fixture()
  const run = f.create('first')
  f.select('first')
  f.push(1, ['first'])
  await f.source.dispose()
  expect(f.detach).toHaveBeenCalledOnce()
  expect(f.bridge.viewed).toHaveBeenLastCalledWith(null)
  f.push(2, [])
  run.events.append(end(4))
  expect([...f.source.unread.getSnapshot()]).toEqual(['first'])
  expect(f.bridge.viewed).toHaveBeenLastCalledWith(null)
})

it('reports native failures without deleting the last known unread snapshot', async () => {
  const f = fixture(Promise.reject(new Error('native read failed')))
  f.push(1, ['first'])
  await vi.waitFor(() => { expect(f.report).toHaveBeenCalledWith(expect.objectContaining({ message: 'native read failed' })) })
  vi.mocked(f.bridge.viewed).mockRejectedValueOnce(new Error('native acknowledgement failed'))
  const run = f.create('first')
  run.events.replace([end(4)], false)
  f.select('first')
  await vi.waitFor(() => { expect(f.report).toHaveBeenCalledWith(expect.objectContaining({ message: 'native acknowledgement failed' })) })
  expect([...f.source.unread.getSnapshot()]).toEqual(['first'])
})

it.each([false, true])('ignores a baseline settled during disposal and reports a failed view release (read failure: %s)', async (failed) => {
  const initial = Promise.withResolvers<DesktopCompletionSnapshot>()
  const f = fixture(initial.promise)
  f.push(1, ['first'])
  f.bridge.viewed.mockRejectedValueOnce(new Error('native release failed'))
  const closing = f.source.dispose()
  if (failed) initial.reject(new Error('native read stopped during teardown'))
  else initial.resolve({ revision: 2, unread: [] })
  await closing
  expect([...f.source.unread.getSnapshot()]).toEqual(['first'])
  expect(f.report).toHaveBeenCalledWith(expect.objectContaining({ message: 'native release failed' }))
})

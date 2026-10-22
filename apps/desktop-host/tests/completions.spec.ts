import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type Session, type TurnEndReason, type UserMessage } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, expect, it, vi } from 'vitest'
import { installDesktopCompletions } from '../src/completions.ts'
import type { DesktopCompletionChange } from '@deepseek-ai/dsh-client-desktop-completions/types'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

async function fixture() {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionStore)
  const agents = new Map<SessionId, Agent>()
  // Completion policy reads only the owned Session, status and inbox lengths.
  ctx.provide('agents', { get: (id: SessionId) => agents.get(id) } as never)
  const publish = vi.fn<(change: DesktopCompletionChange) => void>()
  installDesktopCompletions(ctx, publish)
  const create = (id: string, origin?: 'subagent', parentSession?: SessionId) => {
    const session = ctx.sessions.create(SessionId(id), { meta: { ...(origin === undefined ? {} : { origin }),
      ...(parentSession === undefined ? {} : { parentSession }) } })
    const unsupported = (): never => { throw new Error('completion fixture supports observation only') }
    const inbox = { nextTurn: [] as UserMessage[], nextStep: [] as UserMessage[],
      clear: unsupported, append: unsupported, prepend: unsupported, replace: unsupported,
      remove: unsupported, splice: unsupported }
    const agent: Agent = { id: session.id, session, inbox, ctx, status: 'idle', options: { provider: 'unused', model: 'unused' },
      cancel: unsupported, whenIdle: unsupported, runMaintenance: unsupported, send: unsupported,
      followup: unsupported, steer: unsupported, inject: unsupported }
    agents.set(session.id, agent)
    return { session, inbox, idle: () => { ctx.emit('agent/status', { agent, status: 'idle' }) } }
  }
  return { ctx, agents, publish, create }
}

function turn(session: Session, reason: TurnEndReason = { kind: 'completed' }, number = 1, entered = true): number {
  session.append('turn/start', { turn: number })
  if (entered) {
    session.append('step/start', { turn: number, step: 1 })
    session.append('step/end', { turn: number, step: 1 })
  }
  return session.append('turn/end', { turn: number, reason }).seq
}

it('publishes a normal live result only once the whole agent is idle', async () => {
  const f = await fixture()
  const run = f.create('normal')
  const seq = turn(run.session)
  expect(f.publish.mock.calls).toEqual([[{ kind: 'started', sessionId: 'normal' }]])
  run.idle()
  run.idle()
  expect(f.publish.mock.calls).toEqual([
    [{ kind: 'started', sessionId: 'normal' }], [{ kind: 'completed', sessionId: 'normal', seq }],
  ])
})

it.each<TurnEndReason>([{ kind: 'error', error: { message: 'failed', code: 'UNKNOWN' } },
  { kind: 'aborted', reason: { kind: 'user' } }, { kind: 'blocked' }, { kind: 'max-tokens' },
  { kind: 'interrupted' }, { kind: 'forked' }])('does not announce %j as completed', async (reason) => {
  const f = await fixture()
  const run = f.create('not-completed')
  turn(run.session, reason)
  run.idle()
  expect(f.publish.mock.calls).toEqual([[{ kind: 'started', sessionId: 'not-completed' }]])
})

it('does not announce empty turns or work queued for another turn', async () => {
  const f = await fixture()
  const run = f.create('queued')
  turn(run.session, { kind: 'completed' }, 1, false)
  run.idle()
  turn(run.session, { kind: 'completed' }, 2)
  run.inbox.nextTurn.push({ id: 'queued' as UserMessage['id'], role: 'user', content: [], source: { kind: 'user' } })
  run.idle()
  run.inbox.nextTurn.length = 0
  const seq = turn(run.session, { kind: 'completed' }, 3)
  run.idle()
  expect(f.publish.mock.calls.filter(([change]) => change.kind === 'completed')).toEqual([
    [{ kind: 'completed', sessionId: 'queued', seq }],
  ])
})

it('excludes subagents while allowing ordinary forked Sessions', async () => {
  const f = await fixture()
  const child = f.create('child', 'subagent', SessionId('parent'))
  turn(child.session)
  child.idle()
  expect(f.publish).not.toHaveBeenCalled()
  const fork = f.create('fork', undefined, SessionId('parent'))
  turn(fork.session)
  fork.idle()
  expect(f.publish).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'completed', sessionId: 'fork' }))
})

it('removes disposed Sessions and detaches subscriptions when its owner is disposed', async () => {
  const f = await fixture()
  const run = f.create('removed')
  turn(run.session)
  run.idle()
  f.ctx.emit('session/disposed', run.session)
  expect(f.publish).toHaveBeenLastCalledWith({ kind: 'removed', sessionId: 'removed' })
  await f.ctx.fiber.dispose()
  f.publish.mockClear()
  f.ctx.emit('agent/status', { agent: f.agents.get(run.session.id)!, status: 'idle' })
  expect(f.publish).not.toHaveBeenCalled()
})

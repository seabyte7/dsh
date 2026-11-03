/** P0 feasibility probes only; this file registers no shipped side-chat feature. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installModelSelection, type Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Query from '@deepseek-ai/dsh-session-query-sqlite'
import References, { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { MockAdapter, textResponse } from '../packages/core/agent-loop/tests/mock-adapter.ts'
import { createSessionTestRemote } from '../packages/api/session-controller/tests/test-remote.ts'
import type { SessionRequestId } from '../packages/api/session-controller/src/types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    /** Non-owner identity used only by the P0 access negative control. */
    'p0-guest': { readonly kind: 'p0-guest' }
  }
}

const SOURCE = SessionId('p0-source')
const SIDE = SessionId('p0-side')
const PRESET = 'p0-question-only'
const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

function question(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

function isReference(message: UserMessage): boolean {
  return message.source.kind === 'session-reference'
    && message.source.references.some(reference => reference.sessionId === SOURCE)
}

function references(agent: Agent): UserMessage[] {
  return agent.session.deriveMessages().filter(
    (message): message is UserMessage => message.role === 'user' && isReference(message),
  )
}

async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-side-chat-p0-'))
  roots.push(root)
  return root
}

async function harness(root: string, script: ConstructorParameters<typeof MockAdapter>[0]) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  await ctx.plugin(TypertRegistry)
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions') })
  await ctx.plugin(Query, { path: ':memory:', openAt: 'never' })
  await ctx.plugin(References, { maxReferenceBytes: 65_536 })
  await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(AgentPresets, { default: PRESET })
  const referenceCommitted = await ctx.sessionProjections.register({
    key: 'p0ReferenceCommitted',
    stateSchema: z.boolean(),
    stateVersion: 1,
    init: () => false,
    apply: (state, event) => state || (event.type === 'user/message' && isReference(event.data)),
  })
  const prepare = vi.spyOn(ctx.sessionReferenceResolver, 'prepare')
  ctx.loader.builtins['side-chat-p0'] = {
    inject: ['tools', 'sessionReferenceResolver'],
    apply(scope: Context) {
      scope.effect(() => scope.tools.restrict({ allow: [] }), 'P0: inherited tools disabled')
      scope.on('agent/pre-step', async ({ agent, signal, modelSelection }, next) => {
        const decision = await next()
        if (decision.kind === 'reject'
          || referenceCommitted.stateOf(agent.session)
          || decision.messages.some(isReference)) return decision
        const direct = decision.messages.find(message => message.source.kind === 'user')
        if (direct === undefined) return decision
        const prepared = await scope.sessionReferenceResolver.prepare(
          agent, [...direct.content], [{ sessionId: SOURCE, label: 'P0 source' }], modelSelection, signal,
        )
        if (prepared.additionalContext === undefined) throw new Error('P0 expected a reference')
        const context = prepared.additionalContext
        return {
          ...decision,
          messages: decision.messages.flatMap(message => message === direct ? [message, context] : [message]),
        }
      }, { prepend: true })
    },
  }
  const declarations = ctx.plugin({
    inject: ['agentPresets'],
    async* apply(owner: Context) {
      yield await owner.agentPresets.register({
        id: PRESET,
        plugins: [{ name: 'cordis:side-chat-p0' }],
      })
      yield await owner.agentPresets.register({ id: 'p0-empty', plugins: [] })
    },
  })
  await declarations
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['p0-side'], adapter)
  const remote = await createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'p0-side', model: 'p0-model' }),
    cwd: root,
  })
  return { ctx, adapter, prepare, remote, declarations }
}

async function source(ctx: Context, root: string) {
  return ctx.agents.create({
    sessionId: SOURCE,
    meta: { cwd: root },
    agentOptions: { provider: 'p0-main', model: 'p0-model' },
  })
}

async function side(ctx: Context, root: string, preset = PRESET) {
  return ctx.agents.create({
    sessionId: SIDE,
    meta: { cwd: root, agentPreset: preset },
    agentOptions: { provider: 'p0-side', model: 'p0-model' },
    setup: async (scope) => {
      installModelSelection(scope)
      await ctx.agentPresets.mount(scope, preset)
    },
  })
}

describe('side-chat P0 composition', () => {
  it('keeps the main request running and preserves one committed snapshot across follow-ups', async () => {
    const root = await directory()
    const h = await harness(root, [textResponse('side one'), textResponse('side two')])
    const mainAdapter = new MockAdapter(['hang', textResponse('LATER_SOURCE_FACT')])
    h.ctx.llm.registerAdapter(['p0-main'], mainAdapter)
    const main = await source(h.ctx, root)
    main.agent.followup(question('INITIAL_SOURCE_FACT'))
    await vi.waitFor(() => { expect(mainAdapter.requests).toHaveLength(1) })
    const sourceCut = main.agent.session.snapshotEvents()
    const chat = await side(h.ctx, root)
    chat.agent.followup(question('Explain the current work'))
    await chat.agent.whenIdle()
    expect(main.agent.status).toBe('running')
    expect(h.ctx.agents.isOwnedBy(SIDE, main.agent)).toBe(false)
    expect(main.agent.session.snapshotEvents()).toEqual(sourceCut)
    expect(references(chat.agent)).toHaveLength(1)
    expect(JSON.stringify(h.adapter.requests[0]?.messages)).toContain('INITIAL_SOURCE_FACT')
    main.agent.cancel({ kind: 'user' })
    await main.agent.whenIdle()
    main.agent.followup(question('new main turn'))
    await main.agent.whenIdle()
    chat.agent.followup(question('Explain further'))
    await chat.agent.whenIdle()
    expect(references(chat.agent)).toHaveLength(1)
    expect(h.prepare).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(h.adapter.requests[1]?.messages)).not.toContain('LATER_SOURCE_FACT')
    expect(h.adapter.requests.every(request => (request.tools?.length ?? 0) === 0)).toBe(true)
  })

  it('cancels only the side-chat request', async () => {
    const root = await directory()
    const h = await harness(root, ['hang'])
    const mainAdapter = new MockAdapter(['hang'])
    h.ctx.llm.registerAdapter(['p0-main'], mainAdapter)
    const main = await source(h.ctx, root)
    main.agent.followup(question('main still working'))
    await vi.waitFor(() => { expect(mainAdapter.requests).toHaveLength(1) })
    const chat = await side(h.ctx, root)
    chat.agent.followup(question('side question'))
    await vi.waitFor(() => { expect(h.adapter.requests).toHaveLength(1) })
    chat.agent.cancel({ kind: 'user' })
    await chat.agent.whenIdle()
    expect(main.agent.status).toBe('running')
    expect(mainAdapter.requests[0]?.signal?.aborted).toBe(false)
  })

  it('restores the preset and committed reference through the ordinary Session Controller', async () => {
    const root = await directory()
    const first = await harness(root, [textResponse('before restart')])
    const main = await source(first.ctx, root)
    main.agent.session.append('user/message', question('persisted source fact'), { surfaceOp: 'append' })
    const chat = await side(first.ctx, root)
    chat.agent.followup(question('first question'))
    await chat.agent.whenIdle()
    expect(references(chat.agent)).toHaveLength(1)
    await first.ctx.sessions.flush(chat.agent.session)
    await first.ctx.fiber.dispose()
    const next = await harness(root, [textResponse('after restart')])
    const response = await next.remote.prompt({
      sessionId: SIDE,
      requestId: brandString<SessionRequestId>('p0-restart'),
      content: [{ type: 'text', text: 'continue the side chat' }],
      mode: 'queue',
    })
    if (!response.ok) throw response.error
    expect(response).toMatchObject({ ok: true, value: { accepted: true } })
    const resumed = next.ctx.agents.get(SIDE)
    expect(resumed).toBeDefined()
    if (resumed === undefined) throw new Error('P0 expected resumed Agent')
    await resumed.whenIdle()
    expect(resumed.session.header.agentPreset).toBe(PRESET)
    expect(next.ctx.agentPresets.inspectCompositions(resumed.ctx).map(row => row.id)).toEqual([PRESET])
    expect(references(resumed)).toHaveLength(1)
    expect(next.prepare).not.toHaveBeenCalled()
    expect(JSON.stringify(next.adapter.requests[0]?.messages)).toContain('persisted source fact')
  })

  it('does not inject a second source snapshot when the user already cited the source', async () => {
    const root = await directory()
    const h = await harness(root, [textResponse('answer')])
    const main = await source(h.ctx, root)
    main.agent.session.append('user/message', question('source fact'), { surfaceOp: 'append' })
    const chat = await side(h.ctx, root)
    chat.agent.followup(question(formatSessionReferenceMention({ sessionId: SOURCE, label: 'source' }) + ' explain'))
    await chat.agent.whenIdle()
    expect(references(chat.agent)).toHaveLength(1)
    expect(h.prepare).toHaveBeenCalledTimes(1)
  })

  it('refuses cold continuation when the persisted preset is unavailable', async () => {
    const root = await directory()
    const first = await harness(root, [textResponse('saved answer')])
    const main = await source(first.ctx, root)
    main.agent.session.append('user/message', question('source fact'), { surfaceOp: 'append' })
    const chat = await side(first.ctx, root)
    chat.agent.followup(question('first question'))
    await chat.agent.whenIdle()
    await first.ctx.sessions.flush(chat.agent.session)
    await first.ctx.fiber.dispose()
    const next = await harness(root, [])
    await next.declarations.dispose()
    const result = await next.remote.prompt({
      sessionId: SIDE,
      requestId: brandString<SessionRequestId>('p0-missing-preset'),
      content: [{ type: 'text', text: 'continue' }],
      mode: 'queue',
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('P0 expected the missing preset to reject continuation')
    expect(result.error.message).toContain(PRESET)
    expect(next.adapter.requests).toHaveLength(0)
    expect(next.ctx.agents.get(SIDE)).toBeUndefined()
  })

  it('requires an explicit scoped restriction because an empty preset inherits global tools', async () => {
    const root = await directory()
    const h = await harness(root, [])
    h.ctx.tools.register(defineContentToolFixture({
      name: 'p0_global_tool', description: 'Harmless P0 tool', parameters: {},
      execute: async () => [{ type: 'text', text: 'p0' }],
    }))
    const empty = await h.ctx.agents.create({
      sessionId: SessionId('p0-empty-agent'), meta: { cwd: root, agentPreset: 'p0-empty' },
      setup: async (scope) => { await h.ctx.agentPresets.mount(scope, 'p0-empty') },
    })
    expect(h.ctx.tools.schemas(empty.agent).map(tool => tool.name)).toContain('p0_global_tool')
    const chat = await side(h.ctx, root)
    expect(h.ctx.tools.schemas(chat.agent)).toEqual([])
    expect(h.ctx.tools.schemas(empty.agent).map(tool => tool.name)).toContain('p0_global_tool')
  })

  it('does not treat inherited-tool restrictions as a ban on scope-local tools', async () => {
    const root = await directory()
    const h = await harness(root, [])
    const chat = await side(h.ctx, root)
    chat.agent.ctx.tools.register(defineContentToolFixture({
      name: 'p0_local_tool', description: 'Harmless scoped P0 tool', parameters: {},
      execute: async () => [{ type: 'text', text: 'p0' }],
    }))
    expect(h.ctx.tools.schemas(chat.agent).map(tool => tool.name)).toEqual(['p0_local_tool'])
  })

  it('cannot use ambient allows outside a Remote invocation to authorize a source read', async () => {
    const root = await directory()
    const h = await harness(root, [])
    h.ctx.remoteAccess.registerPolicy('p0-guest', { bindings: () => [] })
    expect(h.ctx.remoteAccess.allows({ kind: 'session', id: SOURCE })).toBe(true)
    expect(h.ctx.remoteAccess.decide({
      principal: { kind: 'p0-guest' }, action: 'session/page',
      resources: [{ kind: 'session', id: SOURCE }],
    })).toEqual({ kind: 'deny', reason: 'no-allow' })
  })

  it('fails before a model request when reference preparation fails, then accepts an explicit retry', async () => {
    const root = await directory()
    const h = await harness(root, [textResponse('retried')])
    const main = await source(h.ctx, root)
    main.agent.session.append('user/message', question('source fact'), { surfaceOp: 'append' })
    h.prepare.mockRejectedValueOnce(new Error('P0 simulated source read failure'))
    const chat = await side(h.ctx, root)
    chat.agent.followup(question('first attempt'))
    await chat.agent.whenIdle()
    expect(h.adapter.requests).toHaveLength(0)
    expect(references(chat.agent)).toHaveLength(0)
    chat.agent.followup(question('explicit retry'))
    await chat.agent.whenIdle()
    expect(h.adapter.requests).toHaveLength(1)
    expect(references(chat.agent)).toHaveLength(1)
  })
})

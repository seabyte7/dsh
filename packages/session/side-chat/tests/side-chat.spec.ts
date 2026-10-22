/** Real Loader behavior of durable association, immutable context, and independent resource ownership. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import SideChat from '../src/index.ts'
import type { SideChatRequestId } from '../src/types.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { boot, removeRoot, temporaryRoot } from './harness.ts'

const roots: string[] = []
const hosts: Awaited<ReturnType<typeof boot>>[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.dispose()))
  await Promise.all(roots.splice(0).map(removeRoot))
  vi.restoreAllMocks()
})

async function host() {
  const root = await temporaryRoot()
  roots.push(root)
  const running = await boot(root)
  hosts.push(running)
  return { ...running, root }
}

const requestId = (value = 'first') => brandString<SideChatRequestId>(value)
const question = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

describe('side-chat Host', () => {
  it('starts an empty independent Session for a new side-chat identity on the same source', async () => {
    const { ctx, model, root, dispose } = await host()
    const source = await hosts[0]!.source()
    const first = await ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId('old-chat') })
    const old = ctx.agents.get(first.sessionId)!
    old.followup(question('OLD_SIDE_CHAT_QUESTION'))
    await old.whenIdle()
    old.ctx.tools.register(defineContentToolFixture({
      name: 'old-only', description: 'Old scoped fixture tool.', parameters: {}, execute: async () => [],
    }))
    old.followup(question('OLD_FAILED_QUESTION'))
    await old.whenIdle()
    const oldEvents = old.session.snapshotEvents()
    expect(oldEvents.some(event => event.type === 'turn/end' && event.data.reason.kind === 'error')).toBe(true)
    const fresh = await ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId('new-chat') })
    expect(fresh.sessionId).not.toBe(first.sessionId)
    const next = ctx.agents.get(fresh.sessionId)!
    expect(ctx.sessionProjections.snapshot(next.session).values.sideChat?.snapshot).toBeNull()
    expect(next.session.snapshotEvents().some(event => event.type === 'user/message' || (event.type === 'turn/end' && event.data.reason.kind === 'error'))).toBe(false)
    next.followup(question('NEW_SIDE_CHAT_QUESTION'))
    await next.whenIdle()
    expect(JSON.stringify(model.requests.at(-1)?.messages)).not.toContain('OLD_SIDE_CHAT_QUESTION')
    expect(old.session.snapshotEvents()).toEqual(oldEvents)
    expect(await ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId('new-chat') })).toEqual(fresh)
    await ctx.sessions.flush(next.session)
    await ctx.sessions.flush(old.session)
    await dispose()
    const cold = await boot(root)
    hosts.push(cold)
    expect(await cold.ctx.sideChat.lookup({ sourceSessionId: source.id, requestId: requestId('new-chat') }))
      .toMatchObject({ sessionId: fresh.sessionId })
    expect(await cold.ctx.sideChat.lookup({ sourceSessionId: source.id, requestId: requestId('old-chat') }))
      .toMatchObject({ sessionId: first.sessionId })
  })

  it('defers creation until ensure and serializes concurrent requests to one root Agent', async () => {
    const { ctx } = await host()
    const source = await hosts[0]!.source()
    expect(await ctx.sideChat.lookup({ sourceSessionId: source.id })).toEqual({})
    const results = await Promise.all(['first', 'first', 'first'].map(value => ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId(value) })))
    expect(new Set(results.map(result => result.sessionId)).size).toBe(1)
    const target = ctx.agents.get(results[0]!.sessionId)!
    expect(ctx.agents.roots()).toContain(target)
    expect(ctx.agents.isOwnedBy(target.id, source)).toBe(false)
    expect(ctx.tools.schemas(target)).toEqual([])
    expect(await ctx.sideChat.lookup({ sourceSessionId: source.id })).toEqual({ sessionId: target.id })
    await expect(ctx.sideChat.ensure({ sourceSessionId: target.id, requestId: requestId() }))
      .rejects.toMatchObject({ code: 'side-chat/unavailable', details: { reason: 'nested' } })
  })

  it('commits one source snapshot, preserves it through follow-ups, and rejects refreshing mentions', async () => {
    const { ctx, model } = await host()
    const source = await hosts[0]!.source()
    const before = source.session.snapshotEvents()
    const prepare = vi.spyOn(ctx.sessionReferenceResolver, 'prepare')
    const target = ctx.agents.get((await ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId() })).sessionId)!
    target.followup(question('Explain the source.'))
    await target.whenIdle()
    expect(model.requests).toHaveLength(1)
    expect(JSON.stringify(model.requests[0]!.messages)).toContain('SOURCE_FACT')
    expect(model.requests[0]).toMatchObject({ model: 'question' })
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(source.session.snapshotEvents()).toEqual(before)
    const snapshot = ctx.sessionProjections.snapshot(target.session).values.sideChat?.snapshot
    expect(snapshot).toMatchObject({ sourceSessionId: source.id, capturedThroughSeq: 0, truncated: false })
    source.session.append('user/message', question('LATER_SOURCE_FACT'), { surfaceOp: 'append' })
    target.followup(question('Continue.'))
    await target.whenIdle()
    expect(model.requests).toHaveLength(2)
    expect(JSON.stringify(model.requests[1]!.messages)).not.toContain('LATER_SOURCE_FACT')
    expect(prepare).toHaveBeenCalledTimes(1)
    target.followup(question('Refresh ' + formatSessionReferenceMention({ sessionId: source.id })))
    await target.whenIdle()
    expect(model.requests).toHaveLength(2)
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(ctx.sessionProjections.snapshot(target.session).values.sideChat?.snapshot).toEqual(snapshot)
  })

  it('uses an already-mentioned source once and rejects foreign references before reading them', async () => {
    const { ctx, model } = await host()
    const source = await hosts[0]!.source()
    const other = await hosts[0]!.source('other')
    const prepare = vi.spyOn(ctx.sessionReferenceResolver, 'prepare')
    const target = ctx.agents.get((await ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId() })).sessionId)!
    target.followup(question('Use ' + formatSessionReferenceMention({ sessionId: other.id })))
    await target.whenIdle()
    expect(prepare).not.toHaveBeenCalled()
    expect(model.requests).toHaveLength(0)
    target.followup(question('Use ' + formatSessionReferenceMention({ sessionId: source.id })))
    await target.whenIdle()
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(model.requests).toHaveLength(1)
    expect(ctx.sessionProjections.snapshot(target.session).values.sideChat?.snapshot?.sourceSessionId).toBe(source.id)
  })

  it('keeps the same allocated identity across creation failure and ready-write failure', async () => {
    const { ctx } = await host()
    const source = await hosts[0]!.source()
    const create = vi.spyOn(ctx.agents, 'create').mockRejectedValueOnce(new Error('creation failed'))
    await expect(ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId() })).rejects.toMatchObject({ details: { reason: 'storage' } })
    const domain = ctx.storageDomain.get('side_chat')!
    const table = domain.table('associations')
    const allocated = table.get(source.id) as { sessionId: string }
    create.mockRestore()
    const put = vi.spyOn(table, 'put')
    put.mockRejectedValueOnce(new Error('association write failed'))
    await expect(ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId() })).rejects.toMatchObject({ details: { reason: 'storage' } })
    const recovered = await ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId() })
    expect(recovered.sessionId).toBe(allocated.sessionId)
    expect(ctx.agents.list().filter(agent => agent.id === recovered.sessionId)).toHaveLength(1)
  })

  it('restores associations and the first snapshot after a cold Host restart', async () => {
    const { ctx, root, dispose } = await host()
    const source = await hosts[0]!.source()
    const ensured = await ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId() })
    const target = ctx.agents.get(ensured.sessionId)!
    target.followup(question('Explain.'))
    await target.whenIdle()
    await ctx.sessions.flush(target.session)
    const snapshot = ctx.sessionProjections.snapshot(target.session).values.sideChat?.snapshot
    await dispose()
    const cold = await boot(root)
    hosts.push(cold)
    expect(await cold.ctx.sideChat.lookup({ sourceSessionId: source.id })).toEqual({ sessionId: target.id, snapshot })
    const prepare = vi.spyOn(cold.ctx.sessionReferenceResolver, 'prepare')
    const resumed = await cold.ctx.agents.resume({ resumeSessionId: target.id, setup: async (agentCtx) => { await cold.ctx.agentPresets.mount(agentCtx, 'question') } })
    resumed.agent.followup(question('Continue after restart.'))
    await resumed.agent.whenIdle()
    expect(cold.model.requests).toHaveLength(1)
    expect(JSON.stringify(cold.model.requests[0]!.messages)).toContain('SOURCE_FACT')
    expect(prepare).not.toHaveBeenCalled()
  })

  it('rejects archived sources and never replaces a deleted ready target', async () => {
    const { ctx, root, dispose } = await host()
    const source = await hosts[0]!.source()
    await ctx.workspaceRegistry.archiveSession(source.id)
    await expect(ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId() }))
      .rejects.toMatchObject({ details: { reason: 'archived' } })
    await ctx.workspaceRegistry.unarchiveSession(source.id)
    const target = await ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId() })
    await dispose()
    const associations = JSON.parse(await readFile(join(root, 'data', 'side_chat.json'), 'utf8')) as { tables: { associations: Record<string, { sessionId: string }> } }
    associations.tables.associations[source.id]!.sessionId = 'deleted-target'
    await writeFile(join(root, 'data', 'side_chat.json'), JSON.stringify(associations))
    const cold = await boot(root)
    hosts.push(cold)
    await expect(cold.ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId() }))
      .rejects.toMatchObject({ details: { reason: 'not-found', sessionId: SessionId('deleted-target') } })
    expect(cold.ctx.agents.get(target.sessionId)).toBeUndefined()
  })

  it('denies tool execution even when a blank Session switches its preset', async () => {
    const { ctx, model } = await host()
    const source = await hosts[0]!.source()
    const target = ctx.agents.get((await ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId() })).sessionId)!
    await ctx.agentPresets.register({ id: 'other', plugins: [] })
    await ctx.agentPresets.select(target, 'other')
    target.followup(question('Do something.'))
    await target.whenIdle()
    expect(model.requests).toHaveLength(0)
    expect(ctx.tools.schemas(target)).toEqual([])
    const execute = vi.fn(async () => [])
    target.ctx.tools.register(defineContentToolFixture({ name: 'write', description: 'Fixture write.', parameters: {}, execute }))
    const result = await ctx.tools.execute({ agent: target, name: 'write', callId: ToolCallId('denied'), arguments: {}, signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('Side chat does not permit tools')
    expect(execute).not.toHaveBeenCalled()
  })

  it('reuses a committed reference during a model retry and retries explicit initialization failures', async () => {
    const { ctx, model } = await host()
    const source = await hosts[0]!.source()
    const prepare = vi.spyOn(ctx.sessionReferenceResolver, 'prepare').mockRejectedValueOnce(new Error('source unavailable'))
    const target = ctx.agents.get((await ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId() })).sessionId)!
    target.followup(question('Explain.'))
    await target.whenIdle()
    expect(model.requests).toHaveLength(0)
    expect(ctx.sessionProjections.snapshot(target.session).values.sideChat).toEqual({ snapshot: null })
    model.failNext = true
    target.ctx.on('agent/request-error', async (_payload, next) => {
      await next()
      return { kind: 'retry' }
    })
    target.followup(question('Try explicitly.'))
    await target.whenIdle()
    expect(model.requests).toHaveLength(2)
    expect(prepare).toHaveBeenCalledTimes(2)
    const references = target.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'session-reference')
    expect(references).toHaveLength(1)
    expect(model.requests[0]!.messages).toEqual(model.requests[1]!.messages)
  })

  it('rejects a preset without its initializer on every ensure and on direct cold resume', async () => {
    const { ctx, root, dispose } = await host()
    const source = await hosts[0]!.source()
    const ensured = await ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId() })
    await dispose()
    const cold = await boot(root)
    hosts.push(cold)
    const declaration = [...cold.ctx.loader.entries()].find(entry => entry.options.id === 'question-preset')!
    await declaration.fiber!.dispose()
    await cold.ctx.agentPresets.register({ id: 'question', plugins: [] })
    for (const stable of ['first', 'retry']) {
      await expect(cold.ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId(stable) }))
        .rejects.toMatchObject({ details: { reason: 'preset' } })
    }
    await expect(cold.ctx.agents.resume({
      resumeSessionId: ensured.sessionId,
      setup: async (agentCtx) => { await cold.ctx.agentPresets.mount(agentCtx, 'question') },
    })).rejects.toMatchObject({ details: { reason: 'preset' } })
    expect(cold.ctx.agents.get(ensured.sessionId)).toBeUndefined()
    const fresh = await cold.source('fresh-source')
    await expect(cold.ctx.sideChat.ensure({ sourceSessionId: fresh.id, requestId: requestId() }))
      .rejects.toMatchObject({ details: { reason: 'preset' } })
    expect(cold.ctx.agents.list()).toEqual([fresh])
  })

  it('keeps its creation handle independent of the calling plugin lifetime', async () => {
    const { ctx, model } = await host()
    const source = await hosts[0]!.source()
    const resolved = Promise.withResolvers<SessionId>()
    const caller = await ctx.plugin({
      name: 'temporary-side-chat-caller',
      inject: ['sideChat'],
      async apply(scope) {
        resolved.resolve((await scope.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId() })).sessionId)
      },
    })
    const targetId = await resolved.promise
    await caller.dispose()
    const target = ctx.agents.get(targetId)!
    expect(target).toBeDefined()
    target.followup(question('Continue after the caller closes.'))
    await target.whenIdle()
    expect(model.requests).toHaveLength(1)
  })

  it('unloads only its question Agent while a main task keeps running', async () => {
    const { ctx, model } = await host()
    const source = await hosts[0]!.source()
    const target = ctx.agents.get((await ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId() })).sessionId)!
    model.hold = true
    source.followup(question('Keep running.'))
    await vi.waitFor(() => { expect(model.requests).toHaveLength(1) })
    target.followup(question('Side question.'))
    await vi.waitFor(() => { expect(model.requests).toHaveLength(2) })
    const mainSignal = model.requests[0]!.signal!
    const sideSignal = model.requests[1]!.signal!
    const feature = [...ctx.loader.entries()].find(entry => entry.options.id === 'side-chat')!
    await feature.fiber!.dispose()
    expect(sideSignal.aborted).toBe(true)
    expect(mainSignal.aborted).toBe(false)
    expect(source.status).toBe('running')
    expect(ctx.agents.get(target.id)).toBeUndefined()
    expect(ctx.agents.get(source.id)).toBe(source)
    source.cancel({ kind: 'user' })
    await source.whenIdle()
  })

  it('drains an in-flight source preparation before releasing its domain', async () => {
    const { ctx, model } = await host()
    const source = await hosts[0]!.source()
    const service = ctx.sideChat
    const target = ctx.agents.get((await service.ensure({ sourceSessionId: source.id, requestId: requestId() })).sessionId)!
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const original = ctx.sessionReferenceResolver.prepare.bind(ctx.sessionReferenceResolver)
    vi.spyOn(ctx.sessionReferenceResolver, 'prepare').mockImplementation(async (...args) => {
      entered.resolve(undefined)
      await release.promise
      return original(...args)
    })
    target.followup(question('Prepare source context.'))
    await entered.promise
    const feature = [...ctx.loader.entries()].find(entry => entry.options.id === 'side-chat')!
    let disposed = false
    const unloading = feature.fiber!.dispose().then(() => { disposed = true })
    try {
      await vi.waitFor(async () => {
        await expect(service.lookup({ sourceSessionId: source.id })).rejects.toMatchObject({ details: { reason: 'closed' } })
      })
      expect(disposed).toBe(false)
      expect(ctx.storageDomain.get('side_chat')).toBeDefined()
    } finally {
      release.resolve(undefined)
    }
    await unloading
    expect(ctx.storageDomain.get('side_chat')).toBeUndefined()
    expect(model.requests).toHaveLength(0)
    expect(ctx.agents.get(source.id)).toBe(source)
  })

  it('cancels and drains a restored Agent without disposing its external owner handle', async () => {
    const { ctx, root, dispose } = await host()
    const source = await hosts[0]!.source()
    const ensured = await ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId() })
    await dispose()
    const cold = await boot(root)
    hosts.push(cold)
    const restored = await cold.ctx.agents.resume({
      resumeSessionId: ensured.sessionId,
      setup: async (agentCtx) => { await cold.ctx.agentPresets.mount(agentCtx, 'question') },
    })
    cold.model.hold = true
    restored.agent.followup(question('Wait for a response.'))
    await vi.waitFor(() => { expect(cold.model.requests).toHaveLength(1) })
    const feature = [...cold.ctx.loader.entries()].find(entry => entry.options.id === 'side-chat')!
    await feature.fiber!.dispose()
    expect(cold.model.requests[0]!.signal!.aborted).toBe(true)
    expect(restored.agent.status).toBe('idle')
    expect(cold.ctx.agents.get(restored.agent.id)).toBe(restored.agent)
    expect(cold.ctx.tools.schemas(restored.agent)).toEqual([])
    restored.agent.followup(question('Should be blocked after unload.'))
    await restored.agent.whenIdle()
    expect(cold.model.requests).toHaveLength(1)
    await restored.dispose()
    expect(cold.ctx.agents.get(ensured.sessionId)).toBeUndefined()
  })


  it('finishes its allocated identity after caller cancellation but rolls back Host unload during setup', async () => {
    const { ctx } = await host()
    const source = await hosts[0]!.source()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const original = ctx.agentPresets.mount.bind(ctx.agentPresets)
    const mount = vi.spyOn(ctx.agentPresets, 'mount').mockImplementationOnce(async (...args) => {
      entered.resolve(undefined)
      await release.promise
      return original(...args)
    })
    const cancellation = new AbortController()
    const pending = ctx.sideChat.ensure({ sourceSessionId: source.id, requestId: requestId() }, cancellation.signal)
    await entered.promise
    cancellation.abort()
    release.resolve(undefined)
    const target = await pending
    expect(ctx.agents.get(target.sessionId)).toBeDefined()
    mount.mockRestore()

    const nextSource = await hosts[0]!.source('next-source')
    const blocked = Promise.withResolvers<undefined>()
    const unblock = Promise.withResolvers<undefined>()
    vi.spyOn(ctx.agentPresets, 'mount').mockImplementationOnce(async (...args) => {
      blocked.resolve(undefined)
      await unblock.promise
      return original(...args)
    })
    const service = ctx.sideChat
    const creating = service.ensure({ sourceSessionId: nextSource.id, requestId: requestId() })
    const outcome = creating.then(() => undefined, (error: unknown) => error)
    await blocked.promise
    const feature = [...ctx.loader.entries()].find(entry => entry.options.id === 'side-chat')!
    let finished = false
    const unloading = feature.fiber!.dispose().then(() => { finished = true })
    try {
      await vi.waitFor(async () => {
        await expect(service.lookup({ sourceSessionId: source.id })).rejects.toMatchObject({ details: { reason: 'closed' } })
      })
      expect(finished).toBe(false)
    } finally {
      unblock.resolve(undefined)
    }
    expect(await outcome).toMatchObject({ code: 'side-chat/unavailable' })
    await unloading
    expect(ctx.agents.list()).toEqual([source, nextSource])
    expect(ctx.storageDomain.get('side_chat')).toBeUndefined()
  })

  it('closes a domain acquired after its owner begins unloading', async () => {
    const { ctx } = await host()
    const feature = [...ctx.loader.entries()].find(entry => entry.options.id === 'side-chat')!
    await feature.fiber!.dispose()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const original = ctx.storageDomain.open.bind(ctx.storageDomain)
    vi.spyOn(ctx.storageDomain, 'open').mockImplementationOnce(async (spec) => {
      entered.resolve(undefined)
      await release.promise
      return original(spec)
    })
    const mounting = ctx.plugin(SideChat, { agentPreset: 'question', provider: 'fixture', model: 'question' })
    const settled = Promise.resolve(mounting).then(() => undefined, (error: unknown) => error)
    await entered.promise
    const unloading = mounting.dispose()
    release.resolve(undefined)
    await Promise.all([settled, unloading])
    expect(ctx.storageDomain.get('side_chat')).toBeUndefined()
  })

})

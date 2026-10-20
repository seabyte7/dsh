/** Side-chat execution checks apply to the final scoped configuration and current Session admission. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SideChatRequestId } from '../src/types.ts'
import { boot, removeRoot, temporaryRoot } from './harness.ts'

const hosts: Awaited<ReturnType<typeof boot>>[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.dispose()))
  await Promise.all(roots.splice(0).map(removeRoot))
  vi.restoreAllMocks()
})

async function setup() {
  const root = await temporaryRoot()
  roots.push(root)
  const host = await boot(root)
  hosts.push(host)
  const source = await host.source()
  const request = { sourceSessionId: source.id, requestId: brandString<SideChatRequestId>('policy') }
  return { ...host, source, request }
}

describe('side-chat configured policy', () => {
  it('rejects Agent-local tools before a model request and denies their executable body', async () => {
    const { ctx, model, request } = await setup()
    const ensured = await ctx.sideChat.ensure(request)
    const target = ctx.agents.get(ensured.sessionId)!
    const execute = vi.fn(async () => [])
    target.ctx.tools.register(defineContentToolFixture({
      name: 'unexpected', description: 'Unexpected Agent capability.', parameters: {}, execute,
    }))
    expect(ctx.tools.schemas(target).map(schema => schema.name)).toContain('unexpected')
    target.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Use that tool.' }] }))
    await target.whenIdle()
    expect(model.requests).toHaveLength(0)
    const result = await ctx.tools.execute({
      agent: target, name: 'unexpected', callId: ToolCallId('policy-denied'), arguments: {}, signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('Side chat does not permit tools')
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects source and target migration without creating replacement identities', async () => {
    const { ctx, source, request } = await setup()
    const stat = ctx.sessionPersistence.stat.bind(ctx.sessionPersistence)
    const sourceStored = await stat(source.id)
    if (sourceStored === undefined) throw new Error('Expected durable source')
    const inspect = vi.spyOn(ctx.sessionPersistence, 'stat').mockResolvedValueOnce({ ...sourceStored, formatStatus: 'migration-required' })
    await expect(ctx.sideChat.ensure(request)).rejects.toMatchObject({ details: { reason: 'migration-required', sessionId: source.id } })
    expect(ctx.agents.list()).toEqual([source])
    inspect.mockRestore()
    const ensured = await ctx.sideChat.ensure(request)
    const targetStored = await stat(ensured.sessionId)
    if (targetStored === undefined) throw new Error('Expected durable target')
    vi.spyOn(ctx.sessionPersistence, 'stat').mockImplementation((sessionId, options) => sessionId === ensured.sessionId
      ? Promise.resolve({ ...targetStored, formatStatus: 'migration-required' })
      : stat(sessionId, options))
    await expect(ctx.sideChat.lookup(request)).rejects.toMatchObject({ details: { reason: 'migration-required', sessionId: ensured.sessionId } })
    await expect(ctx.sideChat.ensure(request)).rejects.toMatchObject({ details: { reason: 'migration-required', sessionId: ensured.sessionId } })
    expect(ctx.agents.list()).toHaveLength(2)
  })

  it('rejects principal-bearing direct input before preparing owner source context', async () => {
    const { ctx, model, request } = await setup()
    const ensured = await ctx.sideChat.ensure(request)
    const target = ctx.agents.get(ensured.sessionId)!
    const prepare = vi.spyOn(ctx.sessionReferenceResolver, 'prepare')
    const direct = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Read the source.' }] })
    const claimed = { ...direct, source: { kind: 'user' as const, principal: { kind: 'untrusted-peer' } } }
    target.followup(claimed)
    await target.whenIdle()
    expect(prepare).not.toHaveBeenCalled()
    expect(model.requests).toHaveLength(0)
    expect(ctx.sessionProjections.snapshot(target.session).values.sideChat?.snapshot).toBeNull()
  })
})

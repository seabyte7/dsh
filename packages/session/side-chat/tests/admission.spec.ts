/** Question policy precedes inherited model selection and source-reference preparation. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
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

async function questionSession() {
  const root = await temporaryRoot()
  roots.push(root)
  const host = await boot(root)
  hosts.push(host)
  const source = await host.source()
  const ensured = await host.ctx.sideChat.ensure({
    sourceSessionId: source.id, requestId: brandString<SideChatRequestId>('admission'),
  })
  const target = host.ctx.agents.get(ensured.sessionId)!
  return { ...host, source, target }
}

describe('side-chat admission', () => {
  it('releases an owned handle after its Agent has already been disposed', async () => {
    const { ctx, source } = await questionSession()
    const other = await hosts[0]!.source('other')
    const created = Promise.withResolvers<AgentHandle>()
    const original = ctx.agents.create.bind(ctx.agents)
    vi.spyOn(ctx.agents, 'create').mockImplementationOnce(async (options) => {
      const handle = await original(options)
      created.resolve(handle)
      return handle
    })
    await ctx.sideChat.ensure({ sourceSessionId: other.id, requestId: brandString<SideChatRequestId>('other') })
    const handle = await created.promise
    const dispose = vi.spyOn(handle, 'dispose')
    await handle.dispose()
    const feature = [...ctx.loader.entries()].find(entry => entry.options.id === 'side-chat')!
    await feature.fiber!.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(ctx.agents.get(source.id)).toBe(source)
  })

  it('does not inherit an effort setting from a different model route', async () => {
    const { target, model } = await questionSession()
    target.ctx.on('agent/request', async (_payload, next) => ({
      ...await next(),
      provider: 'another-provider',
      model: 'another-model',
      reasoningEffort: ReasoningEffortId('incompatible-effort'),
    }))
    target.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Explain.' }] }))
    await target.whenIdle()
    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]?.model).toBe('question')
    expect(model.requests[0]?.reasoningEffort).toBeUndefined()
  })

  it('rejects an archived source before an explicit mention reads its snapshot', async () => {
    const { ctx, target, source, model } = await questionSession()
    const prepare = vi.spyOn(ctx.sessionReferenceResolver, 'prepare')
    await ctx.workspaceRegistry.archiveSession(source.id)
    target.followup(createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: formatSessionReferenceMention({ sessionId: source.id }) + ' Explain.' }],
    }))
    await target.whenIdle()
    expect(prepare).not.toHaveBeenCalled()
    expect(model.requests).toHaveLength(0)
    expect(ctx.sessionProjections.snapshot(target.session).values.sideChat?.snapshot).toBeNull()
  })
})

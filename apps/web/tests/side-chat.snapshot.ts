/** Recorded side-chat questions cross the real Web Remote and optional Loader composition. */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-reference/types'
import type {} from '@deepseek-ai/dsh-tools'
import { expect, it, vi } from 'vitest'
import {
  fixtureUserPrompts, launchWebScaffold, type WebScaffold,
} from './scaffold.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/side-chat/session.v4.jsonl', import.meta.url))
const SOURCE = SessionId('side-chat-snapshot-source')

async function remote<T>(host: WebScaffold, method: string, request: object): Promise<T> {
  const response = await host.hostFetch(`/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request', rpcId: randomUUID(), method, payload: { args: { request } },
    }),
  })
  expect(response.status).toBe(200)
  const body = await response.json() as {
    result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
  }
  if (!body.result.ok) throw new Error(`${method}: ${body.result.error.code}: ${body.result.error.message}`)
  return body.result.value
}

it('persists one fixed source snapshot and follows up through an independent question Session', async () => {
  const prompts = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))
  expect(prompts).toHaveLength(2)
  const host = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('../../../packages/bundle/side-chat/cordis.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('../../../packages/bundle/side-chat/package.json', import.meta.url))],
    replayFixture: FIXTURE,
    compareReplaySession: true,
    replayProviders: [{ id: 'deepseek-official', models: [{ id: 'deepseek-flash', contextWindow: 128_000 }] }],
  })
  const failures: unknown[] = []
  try {
    const source = await host.ctx.agents.create({ sessionId: SOURCE, meta: { cwd: host.workspaceCwd } })
    source.agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'SOURCE_FACT: The task is replacing a parser while preserving its public API.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await vi.waitFor(() => {
      expect(source.agent.session.snapshotEvents().some(event => event.type === 'session/title')).toBe(true)
    })
    const sourceEvents = source.agent.session.snapshotEvents()
    expect(await remote(host, 'sideChat/lookup', { sourceSessionId: SOURCE })).toEqual({})
    const [first, concurrent] = await Promise.all([
      remote<{ sessionId: SessionId }>(host, 'sideChat/ensure', { sourceSessionId: SOURCE, requestId: randomUUID() }),
      remote<{ sessionId: SessionId }>(host, 'sideChat/ensure', { sourceSessionId: SOURCE, requestId: randomUUID() }),
    ])
    expect(concurrent).toEqual(first)
    expect(source.agent.session.snapshotEvents()).toEqual(sourceEvents)
    for (const [index, prompt] of prompts.entries()) {
      await remote(host, 'session/prompt', {
        sessionId: first.sessionId, requestId: `side-chat-snapshot-${index}`, mode: 'queue',
        content: [{ type: 'text', text: prompt }],
      })
      await vi.waitFor(() => {
        expect(host.ctx.agents.get(first.sessionId)?.session.snapshotEvents()
          .filter(event => event.type === 'assistant/message')).toHaveLength(index + 1)
      })
      await host.ctx.agents.get(first.sessionId)?.whenIdle()
      if (index === 0) {
        source.agent.session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'LATER_SOURCE_FACT: The main task has since changed.' }],
          source: { kind: 'user' },
        }), { surfaceOp: 'append' })
      }
    }
    const chat = host.ctx.agents.get(first.sessionId)
    expect(chat).toBeDefined()
    if (chat === undefined) throw new Error('side-chat Agent did not remain available')
    const references = chat.session.deriveMessages().filter(message => (
      message.role === 'user' && message.source.kind === 'session-reference'
    ))
    expect(references).toHaveLength(1)
    expect(JSON.stringify(chat.session.deriveMessages())).toContain('SOURCE_FACT:')
    expect(JSON.stringify(chat.session.deriveMessages())).not.toContain('LATER_SOURCE_FACT:')
    expect(chat.session.header.parentSession).toBeUndefined()
    expect(host.ctx.tools.schemas(chat)).toEqual([])
    expect(await remote(host, 'sideChat/lookup', { sourceSessionId: SOURCE })).toMatchObject({
      sessionId: first.sessionId, snapshot: { sourceSessionId: SOURCE, truncated: false },
    })
  } catch (error) {
    failures.push(error)
  } finally {
    try {
      await host.close()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'side-chat composition or teardown failed')
})

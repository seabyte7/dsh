/** Recorded side-chat questions cross the real Web Remote and optional Loader composition. */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-reference/types'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-experimental-agent-team'
import { expect, it, vi } from 'vitest'
import {
  fixtureUserPrompts, launchWebScaffold, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage } from './support.ts'

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
    extraOverlayPath: [
      fileURLToPath(new URL('../../../packages/bundle/side-chat/cordis.patch.yml', import.meta.url)),
      fileURLToPath(new URL('../../../packages/experimental/agent-team-profile/cordis.patch.yml', import.meta.url)),
    ],
    extraInstallAnchors: [
      fileURLToPath(new URL('../../../packages/bundle/side-chat/package.json', import.meta.url)),
      fileURLToPath(new URL('../../../packages/experimental/agent-team-profile/package.json', import.meta.url)),
    ],
    replayFixture: FIXTURE,
    compareReplaySession: true,
    replayProviders: [{ id: 'deepseek-official', models: [{ id: 'deepseek-flash', contextWindow: 128_000 }] }],
  })
  const failures: unknown[] = []
  let browser: Browser | undefined
  try {
    const source = await host.ctx.agents.create({
      sessionId: SOURCE, meta: { cwd: host.workspaceCwd, agentPreset: 'standard' },
      setup: async (scope) => { await host.ctx.agentPresets.mount(scope, 'standard') },
    })
    expect(host.ctx.agentTeams.tryMembership(source.agent)?.role).toBe('lead')
    expect(host.ctx.tools.schemas(source.agent).some(tool => tool.name === 'spawn_teammate')).toBe(true)
    source.agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'SOURCE_FACT: The task is replacing a parser while preserving its public API.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await vi.waitFor(() => {
      expect(source.agent.session.snapshotEvents().some(event => event.type === 'session/title')).toBe(true)
    })
    const sourceEvents = source.agent.session.snapshotEvents()
    expect(await remote(host, 'sideChat/lookup', { sourceSessionId: SOURCE })).toEqual({})
    const sideChatRequestId = randomUUID()
    const [first, concurrent] = await Promise.all([
      remote<{ sessionId: SessionId }>(host, 'sideChat/ensure', { sourceSessionId: SOURCE, requestId: sideChatRequestId }),
      remote<{ sessionId: SessionId }>(host, 'sideChat/ensure', { sourceSessionId: SOURCE, requestId: sideChatRequestId }),
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
    expect(host.ctx.agentTeams.tryMembership(chat)).toBeUndefined()
    expect(() => host.ctx.agentTeams.listMembers(chat)).toThrow('not a member')
    expect(await remote(host, 'sideChat/lookup', { sourceSessionId: SOURCE, requestId: sideChatRequestId })).toMatchObject({
      sessionId: first.sessionId, snapshot: { sourceSessionId: SOURCE, truncated: false },
    })
    const oldEvents = chat.session.snapshotEvents()
    // The reference fixture has no main turn; give the browser an ordinary completed source conversation.
    source.agent.session.append('turn/start', { turn: 1 })
    source.agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Show the side-chat controls.' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    source.agent.session.append('step/start', { turn: 1, step: 1 })
    source.agent.session.append('assistant/message', {
      turn: 1, step: 1, stream: [], message: createAssistantMessage({
        content: [{ type: 'text', text: 'Browser source ready.' }], source: { provider: 'fixture', model: 'fixture' },
      }),
    }, { surfaceOp: 'append' })
    source.agent.session.append('step/end', { turn: 1, step: 1 })
    source.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await host.ctx.sessions.flush(source.agent.session)
    const workspace = await host.ctx.workspaceRegistry.create(host.workspaceCwd)
    await workspace.attachSession(SOURCE)
    await host.ctx.sessionController.rename({ sessionId: SOURCE, title: 'Fresh side-chat source' })
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    await page.goto(host.authenticatedUrl, { waitUntil: 'load' })
    const group = page.getByRole('treeitem').first()
    await group.waitFor()
    if (await group.getAttribute('aria-expanded') === 'false') await group.click()
    await page.getByRole('treeitem').filter({ has: page.getByText('Fresh side-chat source', { exact: true }) }).click()
    const open = page.getByRole('button', { name: 'Side chat', exact: true })
    await open.click()
    const panel = page.locator('[data-side-chat]:visible')
    const input = panel.getByRole('textbox')
    await input.waitFor()
    expect(await input.innerText()).toBe('')
    for (const prompt of prompts) expect(await panel.innerText()).not.toContain(prompt)
    await input.fill('OLD_UNSENT_SIDE_CHAT_DRAFT')
    await open.click()
    await expect.poll(() => input.innerText()).toBe('')
    expect(await panel.innerText()).not.toContain('OLD_UNSENT_SIDE_CHAT_DRAFT')
    expect(chat.session.snapshotEvents()).toEqual(oldEvents)
  } catch (error) {
    failures.push(error)
  } finally {
    try { await browser?.close() } catch (error) { failures.push(error) }
    try {
      await host.close()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'side-chat composition or teardown failed')
})

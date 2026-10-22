/** Built, keyless Desktop profile qualification with real agent-loop and completion publication. */
import assert from 'node:assert/strict'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createPluginProfile } from '../../lib/types/project-manager.js'
import { installDesktopCompletions } from '../../../desktop-host/lib/types/completions.js'
import { ready } from './completion-control.mjs'

const root = process.cwd()
const repo = fileURLToPath(new URL('../../../..', import.meta.url))
const project = join(root, 'project')
createPluginProfile(project)
await symlink(join(repo, 'node_modules/.pnpm/node_modules'), join(project, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
await writeFile(join(project, 'cordis.patch.yml'), JSON.stringify([
  { id: 'webserver', config: { host: '127.0.0.1', port: 0 } },
  { id: 'llm-deepseek', disabled: true }, { id: 'session-title-llm', disabled: true },
  { id: 'session-telemetry-otel', disabled: true }, { id: 'desktop-product-telemetry', disabled: true },
  { insert: [{ id: 'completion-control', name: new URL('./completion-control.mjs', import.meta.url).href }] },
]))
const require = createRequire(join(project, 'package.json'))
const load = name => import(pathToFileURL(require.resolve(name)).href)
const { runProfile } = await load('@deepseek-ai/dsh/profile-boot')
const { loadLayeredEnv, loadProfileDirectory } = await load('@deepseek-ai/dsh-app-boot')
const { LlmAdapter, createUserMessage } = await load('@deepseek-ai/dsh-llm')
const installAnchor = require.resolve('@deepseek-ai/dsh/package.json')
const running = await runProfile({ environment: loadLayeredEnv('dsh'), profile: 'desktop',
  resolvedProfile: { profile: loadProfileDirectory('dsh', project, installAnchor), installAnchor },
  patchFiles: [], args: ['--no-open', '--host', '127.0.0.1', '--port', '0'] })
const events = []
try {
  const ctx = await ready.promise
  installDesktopCompletions(ctx, change => events.push(change))
  class Model extends LlmAdapter {
    failed = false
    async *stream() {
      if (this.failed) {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', message: 'qualification failure' } } }
        return
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Complete' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Complete' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const model = new Model()
  ctx.effect(() => ctx.llm.registerAdapter(['completion-qualification'], model))
  const owner = await ctx.agents.create({ sessionId: 'completion-qualification', meta: { cwd: root },
    agentOptions: { provider: 'completion-qualification', model: 'keyless' },
    setup: async scope => { await ctx.agentPresets.mount(scope, 'standard') } })
  try {
    const send = () => owner.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Finish this qualification turn' }], source: { kind: 'user' } }))
    send()
    await owner.agent.whenIdle()
    const completed = events.filter(event => event.kind === 'completed')
    assert.equal(completed.length, 1)
    assert.equal(completed[0].sessionId, owner.agent.id)
    assert.ok(Number.isSafeInteger(completed[0].seq))
    const afterSuccess = events.length
    model.failed = true
    send()
    await owner.agent.whenIdle()
    assert.equal(events.slice(afterSuccess).filter(event => event.kind === 'completed').length, 0)
    await mkdir(join(root, 'evidence'), { recursive: true })
    await writeFile(join(root, 'evidence/result.json'), JSON.stringify({ normalCompletions: completed.length,
      failedCompletions: 0, completionSeq: completed[0].seq, profile: 'desktop' }) + '\n')
  } finally { await owner.dispose() }
} finally { await running.shutdown.shutdown(0) }

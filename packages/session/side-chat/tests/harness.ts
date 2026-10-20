/** Test-only Loader boot of the complete Host feature with a deterministic external model. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Agents from '@deepseek-ai/dsh-agent'
import Loop from '@deepseek-ai/dsh-agent-loop'
import Presets from '@deepseek-ai/dsh-agent-preset-registry'
import * as Preset from '@deepseek-ai/dsh-agent-preset'
import Access from '@deepseek-ai/dsh-api-remote-access'
import Llm, { createUserMessage } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Query from '@deepseek-ai/dsh-session-query-sqlite'
import References from '@deepseek-ai/dsh-session-reference'
import Storage from '@deepseek-ai/dsh-storage'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import * as Json from '@deepseek-ai/dsh-storage-json'
import System from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Workspaces from '@deepseek-ai/dsh-workspace'
import SideChat from '../src/index.ts'
import * as Question from '../src/question.ts'
import { QuestionModel } from './fixtures/model.ts'

/** Persistent root for one test; callers dispose both boot instances before removing it. */
export async function temporaryRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-side-chat-'))
}

/**
 * Boot production plugins through a test-only YAML file.
 * @param root - test-owned storage directory, reusable across cold boots.
 * @returns context, scriptable external model, source helper, and teardown.
 */
export async function boot(root: string) {
  const ctx = new Context()
  try {
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    Object.assign(ctx.loader.builtins, {
      include: Include, llm: Llm, agents: Agents, loop: Loop, sessions: Sessions, projections: Projections,
      system: System, tools: Tools, persistence: Persistence, query: Query, storage: Storage,
      'storage-json': Json, domain: Domain, workspaces: Workspaces, access: Access,
      references: References, 'preset-registry': Presets, preset: Preset,
      'side-chat': SideChat, 'side-chat-question': Question,
    })
    const fixture = await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8')
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, fixture.replaceAll('{{root}}', root.replaceAll('\\', '/')))
    const tree = await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    const model = new QuestionModel()
    ctx.llm.registerAdapter(['fixture'], model)
    return {
      ctx, model, tree,
      async source(id = 'source', text = 'SOURCE_FACT') {
        const handle = await ctx.agents.create({ sessionId: SessionId(id), meta: { cwd: root }, agentOptions: { provider: 'fixture', model: 'main' } })
        handle.agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }), { surfaceOp: 'append' })
        await ctx.sessions.flush(handle.agent.session)
        return handle.agent
      },
      dispose: () => ctx.fiber.dispose(),
    }
  } catch (error: unknown) {
    await ctx.fiber.dispose()
    throw error
  }
}

/** Remove only a test-owned temporary root after its contexts have drained. */
export async function removeRoot(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true })
}

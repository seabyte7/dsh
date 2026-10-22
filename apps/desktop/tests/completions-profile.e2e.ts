/** Built-artifact qualification; run after build:artifacts. */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('publishes real normal Desktop turns and suppresses failed turns through a Loader profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-completion-profile-'))
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/completion-profile.mjs', import.meta.url))], {
    cwd: root, env: { ...process.env, DSH_HOME: join(root, 'home'), DEEPSEEK_API_KEY: '', DEEPSEEK_BASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  let timedOut = false
  child.stdout.resume()
  child.stderr.setEncoding('utf8').on('data', (data: string) => { stderr += data })
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => { resolve({ code, signal }) })
  })
  const deadline = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, 30_000)
  try {
    const result = await exited
    expect(timedOut, stderr).toBe(false)
    expect(result.signal, stderr).toBeNull()
    expect(result.code, stderr).toBe(0)
    const evidence = JSON.parse(await readFile(join(root, 'evidence/result.json'), 'utf8')) as {
      normalCompletions: number
      failedCompletions: number
      completionSeq: number
      profile: string
    }
    expect(evidence).toMatchObject({ normalCompletions: 1, failedCompletions: 0, profile: 'desktop' })
    expect(evidence.completionSeq).toBeGreaterThan(0)
  } finally {
    clearTimeout(deadline)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await exited.catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

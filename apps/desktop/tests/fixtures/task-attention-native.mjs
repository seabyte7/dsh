/** Real macOS Dock API smoke over the built completion owner, with a private Electron profile. */
import assert from 'node:assert/strict'
import { app, BrowserWindow } from 'electron'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DesktopTaskAttention } from '../../lib/types/task-attention.js'

assert.equal(process.platform, 'darwin')
const evidence = fileURLToPath(new URL('../../.desktop-build/qualification/', import.meta.url))
mkdirSync(evidence, { recursive: true })
const root = mkdtempSync(join(evidence, 'dock-completion-'))
mkdirSync(join(root, 'userData'))
app.setPath('userData', join(root, 'userData'))
app.on('window-all-closed', () => {})
let phase = 'application ready'
const deadline = setTimeout(() => {
  console.error(`Dock completion smoke exceeded 20 seconds: ${phase}`)
  app.exit(1)
}, 20_000)

async function main() {
  await app.whenReady()
  phase = 'native badge'
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } })
  const attention = new DesktopTaskAttention(text => app.dock.setBadge(text), () => {})
  attention.bind(window)
  const rows = []
  try {
    attention.viewed({ sessionId: 'first', seq: 4 })
    attention.observe({ kind: 'completed', sessionId: 'first', seq: 4 })
    attention.observe({ kind: 'completed', sessionId: 'second', seq: 8 })
    assert.equal(app.dock.getBadge(), '2')
    assert.equal(attention.status().unread.length, 2)
    rows.push({ scenario: 'hidden-window-two-completions', badge: app.dock.getBadge() })
    attention.observe({ kind: 'completed', sessionId: 'first', seq: 4 })
    assert.equal(app.dock.getBadge(), '2')
    attention.observe({ kind: 'started', sessionId: 'first' })
    assert.equal(app.dock.getBadge(), '1')
    rows.push({ scenario: 'same-session-restarted', badge: app.dock.getBadge() })
    attention.reset()
    assert.equal(app.dock.getBadge(), '')
    rows.push({ scenario: 'reset', badge: app.dock.getBadge() })
    phase = 'evidence write'
    await writeFile(join(root, 'result.json'), JSON.stringify({ electron: process.versions.electron, rows }, null, 2) + '\n')
    console.log(`Dock completion evidence: ${join(root, 'result.json')}`)
  } finally {
    attention.dispose()
    window.destroy()
  }
}
main().then(() => { clearTimeout(deadline); app.exit(0) }, error => {
  clearTimeout(deadline)
  console.error(error)
  app.exit(1)
})

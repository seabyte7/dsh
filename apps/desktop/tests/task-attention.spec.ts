import { EventEmitter } from 'node:events'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopTaskAttention, isDesktopCompletionView } from '../src/task-attention.ts'

const owned: DesktopTaskAttention[] = []
afterEach(() => { for (const attention of owned.splice(0)) attention.dispose(); vi.restoreAllMocks() })

function fixture() {
  const native = Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(), focused: false, visible: true, minimized: false, destroyed: false,
    isFocused() { return this.focused }, isVisible() { return this.visible },
    isMinimized() { return this.minimized }, isDestroyed() { return this.destroyed },
  })
  const badge = vi.fn<(text: string) => void>()
  const changed = vi.fn()
  const attention = new DesktopTaskAttention(badge, changed)
  // Only native focus, visibility and window events belong to this fixture.
  attention.bind(native)
  owned.push(attention)
  const completed = (id = 'first', seq = 4) => { attention.observe({ kind: 'completed', sessionId: SessionId(id), seq: SessionSeq(seq) }) }
  const viewed = (id = 'first', seq = 4) => { attention.viewed({ sessionId: SessionId(id), seq: SessionSeq(seq) }) }
  return { attention, native, badge, changed, completed, viewed }
}

it('keeps background completions unread even when that Conversation remains selected', () => {
  const f = fixture()
  f.viewed()
  f.completed()
  expect(f.badge).toHaveBeenLastCalledWith('1')
  expect(f.attention.status().unread).toEqual([{ sessionId: 'first', seq: 4 }])
  f.native.focused = true
  f.native.emit('focus')
  expect(f.badge).toHaveBeenLastCalledWith('')
  expect(f.attention.status().unread).toEqual([])
})

it('counts Sessions once, acknowledges only the viewed result, and ignores old confirmations', () => {
  const f = fixture()
  f.completed('first', 4)
  f.completed('first', 8)
  f.completed('second', 9)
  expect(f.badge).toHaveBeenLastCalledWith('2')
  f.native.focused = true
  f.viewed('first', 4)
  expect(f.attention.status().unread).toHaveLength(2)
  f.viewed('first', 8)
  expect(f.badge).toHaveBeenLastCalledWith('1')
  expect(f.attention.status().unread).toEqual([{ sessionId: 'second', seq: 9 }])
  f.completed('first', 8)
  expect(f.attention.status().unread).toHaveLength(1)
  f.viewed('second', 9)
  expect(f.badge).toHaveBeenLastCalledWith('')
})

it.each(['visible', 'minimized', 'destroyed'] as const)('requires an available native window (%s)', (field) => {
  const f = fixture()
  f.native.focused = true
  if (field === 'visible') f.native.visible = false
  else f.native[field] = true
  f.viewed()
  f.completed()
  expect(f.attention.status().unread).toHaveLength(1)
})

it('does not create unread state for a focused Conversation that already loaded the completed turn', () => {
  const f = fixture()
  f.native.focused = true
  f.viewed()
  f.completed()
  expect(f.attention.status().unread).toEqual([])
  expect(f.badge).toHaveBeenLastCalledWith('')
})

it('clears obsolete results on another run, removal, and Host replacement', () => {
  const f = fixture()
  f.completed()
  f.attention.observe({ kind: 'started', sessionId: SessionId('first') })
  expect(f.badge).toHaveBeenLastCalledWith('')
  f.completed('first', 8)
  f.attention.observe({ kind: 'removed', sessionId: SessionId('first') })
  expect(f.attention.status().unread).toEqual([])
  f.completed('first', 4)
  f.attention.reset()
  expect(f.badge).toHaveBeenLastCalledWith('')
  expect(f.attention.status().unread).toEqual([])
})

it('invalidates viewing on reload or renderer loss and releases all native listeners', () => {
  const f = fixture()
  f.viewed()
  f.native.webContents.emit('did-start-navigation', {}, 'frame', false, false)
  f.native.webContents.emit('did-start-navigation', {}, '#hash', true, true)
  f.completed()
  f.native.webContents.emit('did-start-navigation', {}, 'dsh-app://app/', false, true)
  f.native.focused = true
  f.native.emit('focus')
  expect(f.attention.status().unread).toHaveLength(1)
  f.viewed()
  f.native.webContents.emit('render-process-gone')
  f.completed('first', 8)
  expect(f.attention.status().unread).toHaveLength(1)
  f.attention.dispose()
  expect(f.native.listenerCount('focus')).toBe(0)
  expect(f.native.listenerCount('closed')).toBe(0)
  expect(f.native.webContents.eventNames()).toEqual([])
  expect(f.badge).toHaveBeenLastCalledWith('')
})

it('retains unread results and publishes them when the native badge fails', () => {
  const f = fixture()
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  f.badge.mockImplementation(() => { throw new Error('permission denied') })
  f.completed()
  expect(f.attention.status().unread).toHaveLength(1)
  expect(f.changed).toHaveBeenCalledWith(f.attention.status())
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('unread results retained'), expect.any(Error))
})

it.each([undefined, {}, [], { sessionId: '', seq: 1 }, { sessionId: 'id', seq: -1 },
  { sessionId: 'id', seq: 1.5 }, { sessionId: 'id', seq: '1' }])('rejects malformed viewed IPC: %j', (value) => {
  expect(isDesktopCompletionView(value)).toBe(false)
})

it('accepts a null view or a complete durable position', () => {
  expect(isDesktopCompletionView(null)).toBe(true)
  expect(isDesktopCompletionView({ sessionId: 'session', seq: 0 })).toBe(true)
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionBinding, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { createSideChatResources } from '../src/client/resources.ts'
import { parseSideChatAddress, sideChatAddress } from '../src/client/address.ts'
import type {} from '@deepseek-ai/dsh-side-chat/types'

const SOURCE = 'source/a?#' as SessionId
const TARGET = 'target' as SessionId
const aborts: AbortController[] = []

afterEach(() => {
  for (const controller of aborts.splice(0)) controller.abort()
})

function fixture() {
  const release = vi.fn()
  const reference: SessionReference = {
    sessionId: TARGET,
    binding: {} as SessionBinding,
    ready: Promise.resolve({} as SessionBinding),
    release,
    [Symbol.dispose]: release,
  }
  const retain = vi.fn(() => reference)
  const sessions = { retain }
  const lookup = vi.fn<Parameters<typeof createSideChatResources>[1]>()
  const resources = createSideChatResources(sessions, lookup)
  const controller = new AbortController()
  aborts.push(controller)
  const stream = resources.provider.open(sideChatAddress(SOURCE), { signal: controller.signal })[Symbol.asyncIterator]()
  return { reference, retain, release, lookup, resources, controller, stream }
}

describe('side-chat addresses', () => {
  it('contains only an encoded source identity and accepts canonical spelling', () => {
    expect(sideChatAddress(SOURCE)).toBe('dsh-resource://sidechat/session/source%2Fa%3F%23')
    expect(parseSideChatAddress(sideChatAddress(SOURCE))).toBe(SOURCE)
  })

  it.each([
    'invalid',
    'https://sidechat/session/source',
    'dsh-resource://sidechat/session/',
    'dsh-resource://sidechat/session/source?question=secret',
    'dsh-resource://sidechat/session/source#secret',
    'dsh-resource://sidechat/session/source/target',
    'dsh-resource://sidechat/session/%',
    'dsh-resource://sidechat/session/%73ource',
  ])('rejects noncanonical or payload-bearing address %s', (address) => {
    expect(parseSideChatAddress(address)).toBeUndefined()
  })
})

describe('side-chat resource lifetime', () => {
  it('looks up an empty association without retaining or creating a Session', async () => {
    const f = fixture()
    f.lookup.mockResolvedValue({ ok: true, value: {} })
    expect(await f.stream.next()).toEqual({ done: false, value: { ok: true, value: { sourceSessionId: SOURCE } } })
    expect(f.lookup).toHaveBeenCalledWith(SOURCE, f.controller.signal)
    expect(f.retain).not.toHaveBeenCalled()
    const done = f.stream.next()
    f.controller.abort()
    expect((await done).done).toBe(true)
    expect(f.release).not.toHaveBeenCalled()
  })

  it('retains the existing target and releases only the Client reference when closed', async () => {
    const f = fixture()
    f.lookup.mockResolvedValue({ ok: true, value: { sessionId: TARGET } })
    expect((await f.stream.next()).value).toEqual({ ok: true, value: { sourceSessionId: SOURCE, reference: f.reference } })
    expect(f.retain).toHaveBeenCalledWith(TARGET, { source: 'sideChat', signal: f.controller.signal })
    f.resources.bind(SOURCE, TARGET)
    expect((await f.stream.next()).value).toEqual({ ok: true, value: { sourceSessionId: SOURCE, reference: f.reference } })
    expect(f.retain).toHaveBeenCalledOnce()
    const done = f.stream.next()
    f.controller.abort()
    await done
    expect(f.release).toHaveBeenCalledOnce()
  })

  it('rechecks associations on reconnect without replacing an existing reference', async () => {
    const f = fixture()
    f.lookup.mockResolvedValue({ ok: true, value: { sessionId: TARGET } })
    await f.stream.next()
    await f.resources.refreshAll()
    expect((await f.stream.next()).value).toEqual({ ok: true, value: { sourceSessionId: SOURCE, reference: f.reference } })
    expect(f.lookup).toHaveBeenCalledTimes(2)
    expect(f.retain).toHaveBeenCalledOnce()
  })

  it('reports archived or deleted associations without substituting another Session', async () => {
    const f = fixture()
    f.lookup.mockResolvedValueOnce({ ok: true, value: { sessionId: TARGET } })
    await f.stream.next()
    const failure = new RemoteError('side-chat/unavailable', 'The source is archived', { reason: 'archived' })
    f.lookup.mockResolvedValue({ ok: false, error: failure })
    await f.resources.refresh(SOURCE)
    expect((await f.stream.next()).value).toEqual({ ok: false, error: failure })
    expect(f.retain).toHaveBeenCalledOnce()
    expect(f.release).not.toHaveBeenCalled()
  })

  it('turns a missing Remote assembly into a visible failed resource', async () => {
    const f = fixture()
    f.lookup.mockRejectedValue(new Error('Side-chat namespace is missing'))
    expect(await f.stream.next()).toMatchObject({
      value: { ok: false, error: { code: 'gateway/internal', message: 'Side-chat namespace is missing' } },
    })
    expect(f.retain).not.toHaveBeenCalled()
  })

  it('publishes a failed target acquisition when an empty resource refreshes', async () => {
    const f = fixture()
    f.lookup.mockResolvedValueOnce({ ok: true, value: {} })
    await f.stream.next()
    f.lookup.mockResolvedValue({ ok: true, value: { sessionId: TARGET } })
    f.retain.mockImplementationOnce(() => { throw new Error('Session scope unavailable') })
    await expect(f.resources.refresh(SOURCE)).resolves.toBeUndefined()
    expect((await f.stream.next()).value).toMatchObject({
      ok: false, error: { code: 'gateway/internal', message: 'Session scope unavailable' },
    })
  })

  it('drops a lookup that completes after the resource closes', async () => {
    const f = fixture()
    let complete!: (value: { ok: true; value: { sessionId: SessionId } }) => void
    f.lookup.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
    const initial = f.stream.next()
    f.controller.abort()
    complete({ ok: true, value: { sessionId: TARGET } })
    expect((await initial).done).toBe(true)
    expect(f.retain).not.toHaveBeenCalled()
  })
})

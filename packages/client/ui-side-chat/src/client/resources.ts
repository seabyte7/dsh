/** Side-chat resources retain Client Session references without owning Host Agents. */
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { SideChatLookupRequest } from '@deepseek-ai/dsh-side-chat/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { parseSideChatAddress } from './address.ts'

/** One resource occurrence's source and independently retained target. */
export interface SideChatResource extends SideChatLookupRequest {
  readonly reference?: SessionReference
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    sideChat: unknown
    sideChatSubmit: unknown
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    sidechat: SideChatResource
  }
}

interface LiveResource {
  readonly signal: AbortSignal
  readonly publish: (value: RemoteResult<SideChatResource>) => void
  version: number
  reference: SessionReference | undefined
}

interface SideChatResources {
  readonly provider: ResourceProvider<'sidechat'>
  readonly knownTargets: ReadonlySet<SessionId>
  readonly bind: (address: string, target: SessionId) => void
  readonly refresh: (address: string) => Promise<void>
  readonly refreshAll: () => Promise<void>
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/**
 * Create an address provider and association refresh actions for one plugin lifetime.
 * @param sessions - Client Session reference owner.
 * @param lookup - generated side-chat lookup operation.
 * @returns the provider, refresh actions, and discovered target identities.
 */
export function createSideChatResources(
  sessions: Pick<ISessions, 'retain'>,
  lookup: (request: SideChatLookupRequest, signal: AbortSignal) => Promise<RemoteResult<{ sessionId?: SessionId }>>,
): SideChatResources {
  const live = new Map<string, LiveResource>()
  const knownTargets = new Set<SessionId>()

  const bind = (address: string, sessionId: SessionId): void => {
    const request = parseSideChatAddress(address)
    if (request === undefined) throw new Error(`ui-side-chat: invalid resource address "${address}"`)
    knownTargets.add(sessionId)
    const resource = live.get(address)
    if (resource === undefined || resource.signal.aborted) return
    if (resource.reference?.sessionId !== sessionId) {
      const reference = sessions.retain(sessionId, { source: 'sideChat', signal: resource.signal })
      resource.reference?.release()
      resource.reference = reference
    }
    resource.version += 1
    resource.publish({ ok: true, value: { ...request, reference: resource.reference } })
  }

  const refresh = async (address: string): Promise<void> => {
    const resource = live.get(address)
    if (resource === undefined || resource.signal.aborted) return
    const request = parseSideChatAddress(address)
    if (request === undefined) throw new Error(`ui-side-chat: invalid resource address "${address}"`)
    const version = ++resource.version
    try {
      const result = await lookup(request, resource.signal)
      if (isAborted(resource.signal) || live.get(address) !== resource || resource.version !== version) return
      if (!result.ok) {
        resource.publish(result)
      } else if (result.value.sessionId !== undefined) {
        bind(address, result.value.sessionId)
      } else {
        resource.publish({ ok: true, value: request })
      }
    } catch (error) {
      if (isAborted(resource.signal) || live.get(address) !== resource || resource.version !== version) return
      resource.publish({
        ok: false, error: new RemoteError('gateway/internal', error instanceof Error ? error.message : String(error), {}),
      })
    }
  }

  const provider: ResourceProvider<'sidechat'> = {
    protocol: 'sidechat',
    async *open(address, { signal }) {
      const source = parseSideChatAddress(address)
      if (source === undefined) throw new Error(`ui-side-chat: invalid resource address "${address}"`)
      if (signal.aborted) return
      const frames: RemoteResult<SideChatResource>[] = []
      let wake: (() => void) | undefined
      const publish = (frame: RemoteResult<SideChatResource>): void => {
        if (signal.aborted) return
        frames.push(frame)
        wake?.()
      }
      const resource: LiveResource = { signal, publish, version: 0, reference: undefined }
      live.set(address, resource)
      const abort = (): void => { wake?.() }
      signal.addEventListener('abort', abort, { once: true })
      const initial = refresh(address)
      try {
        await initial
        while (!signal.aborted) {
          const frame = frames.shift()
          if (frame !== undefined) {
            yield frame
          } else {
            await new Promise<void>((resolve) => { wake = resolve })
            wake = undefined
          }
        }
      } finally {
        signal.removeEventListener('abort', abort)
        if (live.get(address) === resource) live.delete(address)
        resource.reference?.release()
      }
    },
  }

  return {
    provider, bind, refresh, knownTargets,
    refreshAll: async () => { await Promise.all([...live.keys()].map(refresh)) },
  }
}

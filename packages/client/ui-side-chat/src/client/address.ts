/** Canonical addresses identify a source and an independently opened side chat. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SideChatLookupRequest, SideChatRequestId } from '@deepseek-ai/dsh-side-chat/types'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'

/** Stable implementation identity for the Sidebar tab. */
export const SIDE_CHAT_ID = '@deepseek-ai/dsh-client-ui-side-chat'
/** Resource-address prefix for a source Session. */
export const SIDE_CHAT_PREFIX = 'dsh-resource://sidechat/session/'

/**
 * Address a side chat, or a legacy source-only association when the request id is omitted.
 * @param sourceSessionId - source conversation identity.
 * @param requestId - stable identity of this independently opened side chat.
 * @returns the canonical resource address.
 */
export function sideChatAddress(sourceSessionId: SessionId, requestId?: SideChatRequestId): string {
  const source = `${SIDE_CHAT_PREFIX}${encodeURIComponent(sourceSessionId)}`
  return requestId === undefined ? source : `${source}/request/${encodeURIComponent(requestId)}`
}

/**
 * Allocate an empty side-chat address without creating a Session.
 * @param sourceSessionId - conversation supplying the first question's snapshot.
 * @returns a fresh address, stable for the lifetime of its tab.
 */
export function newSideChatAddress(sourceSessionId: SessionId): string {
  return sideChatAddress(sourceSessionId, brandString<SideChatRequestId>(randomUUID()))
}

/**
 * Read canonical addresses without question text, query parameters, or fragments.
 * @param address - possible side-chat resource address.
 * @returns its lookup identity, or undefined for another or malformed address.
 */
export function parseSideChatAddress(address: string): SideChatLookupRequest | undefined {
  if (!address.startsWith(SIDE_CHAT_PREFIX)) return undefined
  const parts = address.slice(SIDE_CHAT_PREFIX.length).split('/')
  if (parts.length !== 1 && (parts.length !== 3 || parts[1] !== 'request')) return undefined
  const encodedSource = parts[0]
  if (encodedSource === undefined || parts.some(part => part === '' || /[?#]/u.test(part))) return undefined
  try {
    const sourceSessionId = decodeURIComponent(encodedSource) as SessionId
    const requestId = parts[2] === undefined ? undefined : brandString<SideChatRequestId>(decodeURIComponent(parts[2]))
    if (requestId?.trim() === '') return undefined
    return sideChatAddress(sourceSessionId, requestId) === address
      ? { sourceSessionId, ...requestId === undefined ? {} : { requestId } } : undefined
  } catch (_invalidEncoding) {
    return undefined
  }
}

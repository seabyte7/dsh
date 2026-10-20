/** Canonical addresses contain only the source Session identity. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable implementation identity for the Sidebar tab. */
export const SIDE_CHAT_ID = '@deepseek-ai/dsh-client-ui-side-chat'
/** Resource-address prefix for a source Session. */
export const SIDE_CHAT_PREFIX = 'dsh-resource://sidechat/session/'

/**
 * Address the single side chat associated with one source.
 * @param sourceSessionId - source conversation identity.
 * @returns the canonical resource address.
 */
export function sideChatAddress(sourceSessionId: SessionId): string {
  return `${SIDE_CHAT_PREFIX}${encodeURIComponent(sourceSessionId)}`
}

/**
 * Read only canonical addresses with no query, fragment, or question payload.
 * @param address - possible side-chat resource address.
 * @returns its source identity, or undefined for another or malformed address.
 */
export function parseSideChatAddress(address: string): SessionId | undefined {
  if (!address.startsWith(SIDE_CHAT_PREFIX)) return undefined
  const encoded = address.slice(SIDE_CHAT_PREFIX.length)
  if (encoded === '' || /[/?#]/u.test(encoded)) return undefined
  try {
    const source = decodeURIComponent(encoded) as SessionId
    return sideChatAddress(source) === address ? source : undefined
  } catch (_invalidEncoding) {
    return undefined
  }
}

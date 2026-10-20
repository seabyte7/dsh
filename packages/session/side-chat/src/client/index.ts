/** Optional Client contribution for the Host-owned sideChat Remote namespace. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import sideChatRemote from '@deepseek-ai/dsh-side-chat/remote'

/** Cordis plugin name. */
export const name = 'side-chat-remote'
/** Client Remote provider; the feature UI waits for this namespace separately. */
export const inject = ['remote']

/**
 * Mount only this optional capability's generated Remote contribution.
 * @param ctx - Client context owning the contribution.
 * @returns the namespace disposer after registration completes.
 */
export function apply(ctx: Context): Promise<() => Promise<void>> {
  return ctx.remote.$mount(sideChatRemote)
}

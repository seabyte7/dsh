/** Connects the Desktop shell's unread results to Session status and main Conversation viewing. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { DesktopCompletionsBridge } from '../types.ts'
import { DesktopCompletions } from './source.ts'

/** Session status, retained history, and main-panel navigation are the Client inputs. */
export const inject = ['sessions', 'uiSession', 'layout']

/**
 * Install the macOS completion adapter when the owned preload provides it.
 * @param ctx - Client context; browsers without the bridge retain their existing completion policy.
 */
export function apply(ctx: Context): void {
  const carrier = (globalThis as typeof globalThis & {
    dshDesktop?: { protocolVersion: number; completions?: DesktopCompletionsBridge }
  }).dshDesktop
  if (carrier?.protocolVersion !== 1 || carrier.completions === undefined) return
  const source = new DesktopCompletions(carrier.completions, ctx.sessions, ctx.uiSession.adapter.current,
    ctx.layout.panelInfo, (error) => { ctx.logger('desktop-completions').warn(error) })
  ctx.effect(() => () => source.dispose(), 'desktop-completions: shell subscription')
  ctx.effect(() => ctx.uiSession.registerCompletionSource(source.unread), 'desktop-completions: Session status')
}

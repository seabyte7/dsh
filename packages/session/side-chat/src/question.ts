/** Scoped question preset entry. The Host owns admission and per-Agent resource tracking. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from './index.ts'

/** Cordis plugin name. */
export const name = 'side-chat-question'
/** Missing Host support prevents the question preset from activating. */
export const inject = ['sideChat', 'tools']

/**
 * Attach only Agents joining this preset; the preset generation can serve several Agents.
 * @param ctx - question preset scope.
 */
export function apply(ctx: Context): void {
  ctx.sideChat.registerQuestion(ctx)
  ctx.tools.restrict({ allow: [] })
  ctx.on('agent/created', ({ agent }) => { ctx.sideChat.attachQuestion(agent) })
}

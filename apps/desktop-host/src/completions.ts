/** Publishes live, normally completed top-level turns to the Electron shell. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { DesktopCompletionChange } from '@deepseek-ai/dsh-client-desktop-completions/types'

/**
 * Observe live turns without replaying stored results or changing the agent driver.
 * @param ctx - Desktop Host context; its fiber owns every subscription and pending result.
 * @param publish - private IPC delivery to the shell.
 */
export function installDesktopCompletions(ctx: Context, publish: (change: DesktopCompletionChange) => void): void {
  ctx.inject(['agents'], (scope) => {
    const turns = new Map<SessionId, { session: Session; turn: number; entered: boolean; completed?: SessionSeq }>()
    scope.on('session/event', (session, event) => {
      if (session.header.origin === 'subagent' || scope.agents.get(session.id)?.session !== session) return
      switch (event.type) {
        case 'turn/start':
          turns.set(session.id, { session, turn: event.data.turn, entered: false })
          publish({ kind: 'started', sessionId: session.id })
          break
        case 'step/start': {
          const current = turns.get(session.id)
          if (current?.turn === event.data.turn) current.entered = true
          break
        }
        case 'turn/end': {
          const current = turns.get(session.id)
          if (current?.turn === event.data.turn && current.entered && event.data.reason.kind === 'completed') {
            current.completed = event.seq
          } else turns.delete(session.id)
          break
        }
        default:
          // Other Session events do not establish an entered or completed turn.
          break
      }
    })
    scope.on('agent/status', ({ agent, status }) => {
      if (status !== 'idle') return
      const current = turns.get(agent.id)
      turns.delete(agent.id)
      if (current?.session === agent.session && current.completed !== undefined
        && agent.inbox.nextTurn.length === 0 && agent.inbox.nextStep.length === 0) {
        publish({ kind: 'completed', sessionId: agent.id, seq: current.completed })
      }
    })
    scope.on('session/disposed', (session) => {
      turns.delete(session.id)
      publish({ kind: 'removed', sessionId: session.id })
    })
    scope.effect(() => () => { turns.clear() })
  })
}

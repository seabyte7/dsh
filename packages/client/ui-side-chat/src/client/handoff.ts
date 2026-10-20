/** Initial questions enter the existing input machine on an independently retained target. */
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * Keep a submission reference through the existing input and echo settlement.
 * @param session - independently retained target Session.
 * @param input - its ordinary input facade after submit has started.
 * @param signal - plugin lifetime; closing a view does not abort it.
 * @returns completion after input admission settles or the plugin unloads.
 */
export function waitForSubmission(
  session: Pick<SessionFace, 'subscribe' | 'getSnapshot'>,
  input: Pick<SessionInput, 'state'>,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      unsubscribeInput()
      unsubscribeSession()
      signal.removeEventListener('abort', check)
      resolve()
    }
    const check = (): void => {
      const phase = input.state.getSnapshot().phase
      if (signal.aborted || (phase !== 'adjudicating' && phase !== 'submitting'
        && session.getSnapshot().pendingSubmissions.length === 0)) finish()
    }
    const unsubscribeInput = input.state.subscribe(check)
    const unsubscribeSession = session.subscribe(check)
    signal.addEventListener('abort', check, { once: true })
    check()
  })
}

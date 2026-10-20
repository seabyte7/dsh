/** Replayable snapshot facts from the existing session-reference message source. */
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-reference'
import { z, type ZodType } from 'zod'
import type { SideChatProjectionState, SideChatSnapshot } from './types.ts'

const snapshotSchema: ZodType<SideChatSnapshot | null> = z.object({
  sourceSessionId: z.string().min(1).transform(SessionId),
  capturedThroughSeq: z.number().int().nonnegative().transform(SessionSeq).nullable(),
  capturedFormatVersion: z.number().int().nonnegative(),
  truncated: z.boolean(),
  omittedBytes: z.number().int().nonnegative(),
  omittedMessages: z.number().int().nonnegative(),
}).strict().nullable()

type SideChatProjectionDefinition = ProjectionDefinition<'sideChat', SideChatProjectionState>
  & Required<Pick<ProjectionDefinition<'sideChat', SideChatProjectionState>, 'wire'>>

/**
 * Register one configured question preset's client view without retaining source text.
 * @param agentPreset - preset whose independent Sessions carry side-chat context.
 * @returns the pure fold and cropped wire view.
 */
export function sideChatProjection(agentPreset: string): SideChatProjectionDefinition {
  return {
    key: 'sideChat',
    stateVersion: 1,
    stateSchema: z.object({ agentPreset: z.string().nullable(), snapshot: snapshotSchema }).strict(),
    init: header => ({ agentPreset: header.agentPreset ?? null, snapshot: null }),
    apply(state, event) {
      if (state.snapshot !== null || event.type !== 'user/message' || event.data.source.kind !== 'session-reference') return state
      const reference = event.data.source.references[0]
      if (reference === undefined) return state
      return { ...state, snapshot: {
        sourceSessionId: SessionId(reference.sessionId),
        capturedThroughSeq: reference.capturedThroughSeq,
        capturedFormatVersion: reference.capturedFormatVersion ?? 0,
        truncated: reference.truncated,
        omittedBytes: reference.omittedBytes,
        omittedMessages: reference.omittedMessages,
      } }
    },
    wire: {
      viewSchema: z.object({ snapshot: snapshotSchema }).strict().nullable(),
      view: state => state.agentPreset === agentPreset ? { snapshot: state.snapshot } : null,
    },
  } satisfies ProjectionDefinition<'sideChat', SideChatProjectionState>
}

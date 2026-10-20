/** Durable source-to-target allocation; phase writes follow Session durability. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { SideChatRequestId } from './types.ts'

const associationSchema = z.object({
  sourceSessionId: z.string().min(1).transform(SessionId),
  sessionId: z.string().min(1).transform(SessionId),
  requestId: z.string().min(1).transform(brandString<SideChatRequestId>),
  agentPreset: z.string().min(1),
  cwd: z.string().min(1),
  phase: z.enum(['allocated', 'created', 'ready']),
}).strict()

/** One durable allocation. Missing ready targets are never silently replaced. */
export type SideChatAssociation = z.infer<typeof associationSchema>

/** Authoritative association domain; message content is owned by Session persistence. */
export const sideChatDomain = defineDomain({
  name: 'side_chat',
  version: 1,
  tables: { associations: domainTable<ReturnType<typeof SessionId>, SideChatAssociation>(associationSchema) },
})

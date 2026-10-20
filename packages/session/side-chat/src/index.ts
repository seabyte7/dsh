/** Independent, owner-only question Sessions with durable same-identity allocation. */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import { scopeOf, scopeParentOf, type ScopeKey } from '@deepseek-ai/dsh-scope'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-query'
import { parseSessionReferenceText } from '@deepseek-ai/dsh-session-reference'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Remote, RemoteError, TypertRemoteService, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import { sideChatProjection } from './projection.ts'
import { sideChatDomain, type SideChatAssociation } from './storage.ts'
import type {
  SideChatEnsureRequest, SideChatEnsureValue, SideChatLookupRequest, SideChatLookupValue, SideChatSnapshot,
} from './types.ts'

export type * from './types.ts'

/** Deployment policy for the question preset and fixed model route. */
export interface Config {
  /** Required preset containing this package's question entry and native presentation. */
  agentPreset: string
  /** Provider route used by every side-chat model request. */
  provider: string
  /** Provider-owned model used by every side-chat model request. */
  model: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Independent question-session association and initialization owner. */
    sideChat: SideChat
  }
}

type Reason = RemoteError<'side-chat/unavailable'>['details']['reason']

/** One Host owns association writes, creation handles, and admission of restored question Agents. */
export class SideChat extends TypertRemoteService {
  static inject = [
    'agents', 'agentPresets', 'remoteAccess', 'sessions', 'sessionPersistence',
    'sessionProjections', 'sessionQuery', 'sessionReferenceResolver', 'storageDomain', 'tools', 'workspaceRegistry',
  ]
  static Config: z<Config> = z.object({
    agentPreset: z.string().required(), provider: z.string().required(), model: z.string().required(),
  })

  private readonly owner: Context
  private domain?: Domain<typeof sideChatDomain>
  private associations?: KvTable<SessionId, SideChatAssociation>
  private readonly chains = new Map<SessionId, Promise<void>>()
  private readonly handles = new Set<AgentHandle>()
  private readonly questions = new Set<Agent>()
  private readonly questionScopes = new Set<ScopeKey>()
  private readonly operations = new Set<Promise<unknown>>()
  private readonly lifetime = new AbortController()

  /** @param ctx - Host capabilities, retained until admitted work and owned Agents drain. @param config - fixed question policy. */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'sideChat')
    this.owner = ctx
    for (const field of ['agentPreset', 'provider', 'model'] as const) {
      if (config[field].trim() === '') throw new Error(`side-chat: ${field} must not be empty`)
    }
  }

  protected async [Service.init](): Promise<void> {
    this.owner.effect(() => async () => {
      this.lifetime.abort(new Error('Side chat was disabled'))
      for (const agent of this.questions) agent.cancel({ kind: 'user' })
      await Promise.allSettled([...this.operations])
      const idle = await Promise.allSettled([...this.questions].map(agent => agent.whenIdle()))
      const disposed = await Promise.allSettled([...this.handles].map(handle => handle.dispose()))
      this.handles.clear()
      this.questions.clear()
      this.questionScopes.clear()
      const closed = await Promise.allSettled([this.domain?.close()])
      const failures = [...idle, ...disposed, ...closed].filter(result => result.status === 'rejected')
      if (failures.length > 0) {
        throw new AggregateError(failures.map((result): unknown => result.reason), 'Side-chat resources did not all dispose')
      }
    }, 'side-chat resources')
    const acquire = (async () => {
      this.domain = await this.owner.storageDomain.open(sideChatDomain)
      this.associations = this.domain.table('associations')
    })()
    this.operations.add(acquire)
    try { await acquire } finally { this.operations.delete(acquire) }
    this.assertOpen()
    this.owner.sessionProjections.register(sideChatProjection(this.config.agentPreset))
    this.owner.on('agent/created', ({ agent }) => {
      if (this.recordForTarget(agent.id) !== undefined) this.attachQuestion(agent)
    })
  }

  /**
   * Find an existing association without creating or resuming an Agent.
   * Missing, archived, migrating, nested, and inaccessible Sessions reject explicitly.
   * @param request - source Session identity.
   * @param signal - optional caller cancellation before reads complete.
   * @returns its associated Session and committed snapshot, or an empty object.
   */
  @Remote({ resources: { session: (request: SideChatLookupRequest) => request.sourceSessionId } })
  async lookup(request: SideChatLookupRequest, signal?: AbortSignal): Promise<SideChatLookupValue> {
    signal?.throwIfAborted()
    this.assertOwner()
    return this.track(async () => {
      await this.sourceHeader(request.sourceSessionId)
      signal?.throwIfAborted()
      const record = this.table().get(request.sourceSessionId)
      if (record === undefined) return {}
      this.assertResource(record.sessionId)
      const target = await this.header(record.sessionId)
      if (target === undefined && record.phase !== 'allocated') this.fail('not-found', record.sessionId)
      if (target === undefined) return {}
      await this.admissible(record.sessionId)
      this.checkTarget(record, target)
      const snapshot = await this.snapshot(record.sessionId)
      return { sessionId: record.sessionId, ...(snapshot === undefined ? {} : { snapshot }) }
    })
  }

  /**
   * Allocate and create the sole question Session for a source. Concurrent and repeated calls reuse
   * the durable target identity; this operation never submits a prompt or replaces a missing ready target.
   * @param request - source identity and stable creation request identity.
   * @param signal - optional caller cancellation before durable allocation; later creation remains Host-owned.
   * @returns the same target after Session durability and association commit.
   */
  @Remote({ resources: { session: (request: SideChatEnsureRequest) => request.sourceSessionId } })
  async ensure(request: SideChatEnsureRequest, signal?: AbortSignal): Promise<SideChatEnsureValue> {
    signal?.throwIfAborted()
    this.assertOwner()
    if (!request.requestId.trim()) this.fail('input', request.sourceSessionId)
    return this.track(() => this.inOrder(request.sourceSessionId, async () => {
      signal?.throwIfAborted()
      const source = await this.sourceHeader(request.sourceSessionId)
      await this.preset()
      signal?.throwIfAborted()
      let record = this.table().get(source.id)
      if (record === undefined) {
        if (source.cwd === undefined) this.fail('association', source.id)
        record = {
          sourceSessionId: source.id, sessionId: SessionId(randomUUID()), requestId: request.requestId,
          agentPreset: this.config.agentPreset, cwd: source.cwd, phase: 'allocated',
        }
        await this.table().put(source.id, record)
      }
      this.assertOpen()
      this.assertResource(record.sessionId)
      const existing = await this.header(record.sessionId)
      if (existing === undefined) {
        if (record.phase !== 'allocated') this.fail('not-found', record.sessionId)
        const agentPreset = record.agentPreset
        const handle = await this.owner.agents.create({
          sessionId: record.sessionId,
          meta: { cwd: record.cwd, agentPreset: record.agentPreset },
          agentOptions: { provider: this.config.provider, model: this.config.model },
          signal: this.lifetime.signal,
          setup: async (agentCtx, agent) => {
            await this.owner.agentPresets.mount(agentCtx, agentPreset)
            this.assertQuestionScope(agent)
            this.assertTools(agent)
          },
        })
        this.handles.add(handle)
        if (this.lifetime.signal.aborted) {
          await handle.dispose()
          this.fail('closed', record.sessionId)
        }
        if (!this.questions.has(handle.agent)) {
          await handle.dispose()
          this.fail('preset', record.sessionId)
        }
        await this.ctx.sessions.flush(handle.agent.session)
      } else {
        await this.admissible(record.sessionId)
        this.checkTarget(record, existing)
        const live = this.ctx.agents.get(record.sessionId)
        if (live !== undefined) {
          if (!this.questions.has(live)) this.fail('preset', record.sessionId)
          await this.ctx.sessions.flush(live.session)
        }
      }
      this.assertOpen()
      if (record.phase === 'ready') return { sessionId: record.sessionId }
      record = { ...record, phase: 'created' }
      await this.table().put(source.id, record)
      await this.table().put(source.id, { ...record, phase: 'ready' })
      return { sessionId: record.sessionId }
    }))
  }

  /**
   * Register the scoped question initializer before a preset can create Sessions.
   * @param scope - preset-generation context mounting the question entry.
   */
  registerQuestion(scope: Context): void {
    this.assertOpen()
    const key = scopeOf(scope)
    if (key === undefined) this.fail('preset')
    scope.effect(() => {
      this.questionScopes.add(key)
      return () => { this.questionScopes.delete(key) }
    }, 'side-chat question initializer')
  }

  /**
   * Install question admission on an Agent announced inside the question preset. The Agent owns
   * these effects, so restrictions survive preset removal; Controller-restored handles remain Controller-owned.
   * @param agent - newly created or restored independent Agent.
   */
  attachQuestion(agent: Agent): void {
    this.assertOpen()
    const record = this.recordForTarget(agent.id)
    if (record === undefined || record.agentPreset !== this.config.agentPreset) this.fail('association', agent.id)
    if (this.questions.has(agent)) return
    const scope = agent.ctx
    scope.tools.restrict({ allow: [] })
    scope.tools.guard(() => 'Side chat does not permit tools')
    this.questions.add(agent)
    scope.effect(() => () => {
      this.questions.delete(agent)
      for (const handle of this.handles) {
        if (handle.agent === agent) this.handles.delete(handle)
      }
    }, 'side-chat question lifetime')
    const admit = (): void => {
      this.assertOpen()
      if (this.ctx.agentPresets.composedPreset(scope) !== record.agentPreset) this.fail('preset', agent.id)
      this.assertQuestionScope(agent)
      this.assertTools(agent)
    }
    admit()
    scope.on('system-prompt/assemble', async (_assembly, _context, next) => {
      admit()
      const assembled = await next()
      admit()
      return { ...assembled, variables: { ...assembled.variables, provider: this.config.provider, model: this.config.model } }
    }, { prepend: true })
    scope.on('agent/request', async (_payload, next) => {
      admit()
      const resolved = await next()
      admit()
      const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
      return { ...withoutInheritedEffort, provider: this.config.provider, model: this.config.model }
    }, { prepend: true })
    scope.on('agent/pre-step', (payload, next) => this.track(async () => {
      admit()
      const initial = this.owner.sessionProjections.stateOf(agent.session, 'sideChat')
      if (initial === undefined) this.fail('context', agent.id)
      for (const message of payload.messages) this.validateInput(message, record.sourceSessionId, initial.snapshot !== null)
      await this.sourceHeader(record.sourceSessionId)
      await this.admissible(agent.id)
      const decision = await next()
      if (decision.kind === 'reject') return decision
      admit()
      this.assertOpen()
      const projection = this.owner.sessionProjections.stateOf(agent.session, 'sideChat')
      if (projection === undefined) this.fail('context', agent.id)
      if (projection.snapshot !== null) return decision
      if (decision.messages.some(message => message.source.kind === 'session-reference'
        && message.source.references.some(reference => reference.sessionId === record.sourceSessionId))) return decision
      const direct = decision.messages.find(message => message.source.kind === 'user')
      if (direct === undefined) return decision
      const prepared = await this.ctx.sessionReferenceResolver.prepare(
        agent, [...direct.content], [{ sessionId: record.sourceSessionId }],
        AbortSignal.any([payload.signal, this.lifetime.signal]),
      )
      this.assertOpen()
      if (prepared.additionalContext === undefined) this.fail('context', agent.id)
      return { ...decision, messages: [...decision.messages, prepared.additionalContext] }
    }, 'context'), { prepend: true })
  }

  private validateInput(message: UserMessage, sourceSessionId: SessionId, initialized: boolean): void {
    if (message.source.kind !== 'user') return
    if ('principal' in message.source && message.source.principal !== undefined) this.fail('owner-required', sourceSessionId)
    if (message.content.some(block => block.type !== 'text')) this.fail('input', sourceSessionId)
    for (const block of message.content) {
      if (block.type !== 'text') continue
      const references = parseSessionReferenceText(block.text).references
      if ((initialized && references.length > 0) || references.some(reference => reference.sessionId !== sourceSessionId)) this.fail('input', sourceSessionId)
    }
  }

  private assertTools(agent: Agent): void {
    if (this.ctx.tools.schemas(agent).length !== 0) this.fail('tools', agent.id)
  }

  private assertQuestionScope(agent: Agent): void {
    this.assertOpen()
    const key = scopeOf(agent.ctx)
    const parent = key === undefined ? undefined : scopeParentOf(key)
    if (parent === undefined || !this.questionScopes.has(parent)) this.fail('preset', agent.id)
  }

  private async preset(): Promise<void> {
    try {
      const preset = await this.ctx.agentPresets.resolve(this.config.agentPreset)
      if (preset.broken !== undefined) this.fail('preset')
      await using lease = await this.owner.agentPresets.acquireScope(this.config.agentPreset)
      if (!this.questionScopes.has(lease.key)) this.fail('preset')
    } catch (error: unknown) {
      this.fail('preset', undefined, error)
    }
  }

  private async sourceHeader(sessionId: SessionId): Promise<SessionHeader> {
    this.assertOpen()
    this.assertResource(sessionId)
    if (this.recordForTarget(sessionId) !== undefined) this.fail('nested', sessionId)
    const header = await this.admissible(sessionId)
    if (header.agentPreset === this.config.agentPreset) this.fail('nested', sessionId)
    return header
  }

  private async admissible(sessionId: SessionId): Promise<SessionHeader> {
    this.assertOpen()
    if (this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)) this.fail('archived', sessionId)
    const persisted = await this.ctx.sessionPersistence.stat(sessionId)
    if (persisted?.formatStatus === 'migration-required') this.fail('migration-required', sessionId)
    const header = this.ctx.sessions.get(sessionId)?.header ?? persisted?.header
    if (header === undefined) this.fail('not-found', sessionId)
    for (const workspace of this.ctx.workspaceRegistry.list()) {
      if (workspace.sessionIds.includes(sessionId) && !this.ctx.remoteAccess.allows({ kind: 'workspace', id: workspace.id })) {
        this.fail('owner-required', sessionId)
      }
    }
    return header
  }

  private async header(sessionId: SessionId): Promise<SessionHeader | undefined> {
    return this.ctx.sessions.get(sessionId)?.header ?? (await this.ctx.sessionPersistence.stat(sessionId))?.header
  }

  private checkTarget(record: SideChatAssociation, header: SessionHeader): void {
    if (header.cwd !== record.cwd || header.agentPreset !== record.agentPreset || header.origin === 'subagent') {
      this.fail('association', record.sessionId)
    }
    if (record.agentPreset !== this.config.agentPreset) this.fail('preset', record.sessionId)
  }

  private async snapshot(sessionId: SessionId): Promise<SideChatSnapshot | undefined> {
    using observation = await this.ctx.sessionQuery.observeSession(sessionId)
    return observation.projections?.values.sideChat?.snapshot ?? undefined
  }

  private table(): KvTable<SessionId, SideChatAssociation> {
    this.assertOpen()
    if (this.associations === undefined) throw new Error('side-chat domain is not initialized')
    return this.associations
  }

  private recordForTarget(sessionId: SessionId): SideChatAssociation | undefined {
    return [...this.table().entries()].find(([, record]) => record.sessionId === sessionId)?.[1]
  }

  private assertOwner(): void {
    this.assertOpen()
    const invocation = this.ctx.invocation
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- other packages merge non-owner kinds into PrincipalMap.
    if (invocation !== undefined && invocation.peer.principal.kind !== 'owner') this.fail('owner-required')
  }

  private assertResource(sessionId: SessionId): void {
    if (!this.ctx.remoteAccess.allows({ kind: 'session', id: sessionId })) this.fail('owner-required', sessionId)
  }

  private assertOpen(): void {
    if (this.lifetime.signal.aborted) this.fail('closed')
  }

  private fail(reason: Reason, sessionId?: SessionId, cause?: unknown): never {
    const descriptions: Record<Reason, string> = {
      closed: 'Side chat is disabled. Enable its plugin before continuing.',
      'owner-required': 'Side chat is available only to the owner of this personal installation.',
      'not-found': 'The source or side-chat Session is missing. Restore it before continuing.',
      archived: 'The source or side-chat Session is archived. Unarchive it before continuing.',
      'migration-required': 'Open the Session to complete its migration before using side chat.',
      nested: 'A side chat cannot start another side chat. Open its source conversation.',
      preset: 'The question preset is missing or changed. Restore its configured composition.',
      tools: 'The question preset exposes tools. Configure native presentation without tools.',
      input: 'Side chat accepts text only. Session references cannot refresh an existing snapshot.',
      association: 'The side-chat association does not match this Session. Restore its original configuration.',
      storage: 'The side chat could not read or save its state. Check storage before trying again.',
      context: 'The source snapshot could not be initialized. Check the source Session and try again explicitly.',
    }
    throw new RemoteError('side-chat/unavailable', descriptions[reason], {
      reason, ...(sessionId === undefined ? {} : { sessionId }),
    }, cause === undefined ? undefined : { cause })
  }

  private async track<T>(operation: () => Promise<T>, reason: Reason = 'storage'): Promise<T> {
    this.assertOpen()
    const work = operation()
    this.operations.add(work)
    try { return await work } catch (error: unknown) {
      if (remoteErrorOf(error) !== undefined) throw error
      this.fail(reason, undefined, error)
    } finally { this.operations.delete(work) }
  }

  private async inOrder<T>(sourceSessionId: SessionId, operation: () => Promise<T>): Promise<T> {
    const work = (this.chains.get(sourceSessionId) ?? Promise.resolve()).then(operation)
    const settled = work.then(() => {}, () => {})
    this.chains.set(sourceSessionId, settled)
    try { return await work } finally {
      if (this.chains.get(sourceSessionId) === settled) this.chains.delete(sourceSessionId)
    }
  }
}

export default SideChat

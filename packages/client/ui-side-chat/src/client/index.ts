/** Optional side-chat header, resource lifecycle, and embedded question UI. */
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SideChatRequestId } from '@deepseek-ai/dsh-side-chat/types'
import type {} from '@deepseek-ai/dsh-side-chat/remote'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SIDE_CHAT_ID, SIDE_CHAT_PREFIX, parseSideChatAddress, sideChatAddress } from './address.ts'
import { createSideChatResources } from './resources.ts'
import { createSideChatStore } from './store.ts'
import { en, NS, zh, type SideChatKey } from './locales.ts'
import {
  HeaderAction, SideChatComposer, SideChatConversation, SideChatPanel, SideChatTitle,
  type PanelInjected, type SideChatActions,
} from './Panel.tsx'
import { waitForSubmission } from './handoff.ts'
import { failureMessage } from './errors.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Side-chat questions, context state, and local failure copy. */
    sideChat: SideChatKey
  }
  interface SlotMap {
    /** Independently bound Session content in a side-chat tab. */
    'sidechat.conversation': { kind: 'single'; scope: 'session' }
  }
}

/** Services needed by the optional side-chat browser plugin. */
export const inject = ['slots', 'locale', 'sessions', 'conversation', 'resources', 'sidebarRight', 'sidebarRightTabs', 'remote', 'remote.sideChat']

/**
 * Register side-chat presentation without changing the main Session input.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: Context): void {
  const drafts = createSideChatStore()
  const controller = new AbortController()
  const pending = new Map<SessionId, Promise<void>>()
  const resources = createSideChatResources(ctx.sessions, (sourceSessionId, signal) => (
    ctx.remote.sideChat.lookup({ sourceSessionId }, signal)
  ))
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-side-chat: dictionaries')
  ctx.effect(() => async () => {
    controller.abort()
    await Promise.allSettled([...pending.values()])
  }, 'ui-side-chat: submitted question holds')
  ctx.effect(() => ctx.resources.register(resources.provider), 'ui-side-chat: resources')
  ctx.on('connection/reset', () => { void resources.refreshAll() })
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: SIDE_CHAT_ID,
    kind: 'sidechat',
    priority: 'builtin',
    patterns: [`${SIDE_CHAT_PREFIX}**`],
    canOpen: address => parseSideChatAddress(address) !== undefined,
    title: () => t('title'),
  }), 'ui-side-chat: tab type')

  const send = async (
    sourceSessionId: SessionId, text: string, previousRequestId: string | undefined, actions: SideChatActions,
  ): Promise<void> => {
    if (pending.has(sourceSessionId) || text.trim() === '' || text.trimStart().startsWith('/')) return
    const requestId = brandString<SideChatRequestId>(previousRequestId ?? randomUUID())
    actions.begin(sourceSessionId, text, requestId)
    const operation = (async (): Promise<void> => {
      try {
        const result = await ctx.remote.sideChat.ensure({ sourceSessionId, requestId }, controller.signal)
        if (!result.ok) {
          actions.failed(sourceSessionId, t('failed', { reason: failureMessage(result.error, t) }))
          return
        }
        resources.bind(sourceSessionId, result.value.sessionId)
        await ctx.sessions.using(result.value.sessionId, { source: 'sideChatSubmit', signal: controller.signal }, async (reference) => {
          const binding = await reference.ready
          if (controller.signal.aborted) return
          const input = ctx.conversation.input.for(binding.ctx)
          if (input.state.getSnapshot().attachmentIds.length > 0) {
            actions.failed(sourceSessionId, t('attachmentsUnsupported'))
            return
          }
          const initialized = ctx.conversation.input.requestDraftInitialization(binding, { prompt: text, clearPreviousDraft: false })
          if (initialized !== 'applied') {
            actions.failed(sourceSessionId, t('handoffFailed'))
            return
          }
          input.submit('queue', 'click')
          actions.handedOff(sourceSessionId)
          await waitForSubmission(binding.session, input, controller.signal)
        })
      } catch (error) {
        actions.failed(sourceSessionId, t('failed', { reason: error instanceof Error ? error.message : String(error) }))
      }
    })()
    pending.set(sourceSessionId, operation)
    try {
      await operation
    } finally {
      if (pending.get(sourceSessionId) === operation) pending.delete(sourceSessionId)
    }
  }

  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'side-chat',
    order: 15,
    locale: NS,
    inject: sourceSessionId => ({ open: () => { ctx.sidebarRight.openResource(sideChatAddress(sourceSessionId), { kind: 'sidechat', preferNewPane: true }) } }),
  }, HeaderAction)), 'ui-side-chat: header action')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: SIDE_CHAT_ID,
    locale: NS,
    store: drafts,
    children: { 'sidechat.conversation': { kind: 'single', scope: 'session' } },
    inject: (_sessionId, actions): PanelInjected => ({
      send: (source, text, requestId) => { void send(source, text, requestId, actions) },
      refresh: (source) => { void resources.refresh(source) },
    }),
  }, SideChatPanel)), 'ui-side-chat: tab body')
  ctx.effect(() => ctx.slots.inject('sidechat.conversation', () => ctx.slots.register({
    name: 'sidechat.conversation', locale: NS,
  }, SideChatConversation)), 'ui-side-chat: embedded conversation')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title', key: SIDE_CHAT_ID, locale: NS,
  }, SideChatTitle)), 'ui-side-chat: tab title')
  ctx.effect(() => ctx.slots.inject('conversation.composer', () => ctx.slots.register({
    name: 'conversation.composer',
    priority: -20,
    locale: NS,
    select: (owner: ComposerChainProps) => owner.sessionId !== undefined
      && (owner.projectionValues?.sideChat != null || resources.knownTargets.has(owner.sessionId))
      ? { sideChat: true as const } : null,
    inject: sessionId => ({
      stop: () => {
        const binding = ctx.sessions.binding(sessionId)
        if (binding !== undefined) void binding.session.cancel()
      },
    }),
  }, SideChatComposer)), 'ui-side-chat: text question composer')
}

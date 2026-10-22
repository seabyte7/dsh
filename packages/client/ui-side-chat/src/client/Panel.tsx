/** Side-chat presentation uses existing Session scopes, resources, and input actions. */
import type {
  ConversationViewsProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button, StateDot, Tooltip, IconNewChatOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsLocale, PropsRenderFactories, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-side-chat/types'
import type { NS } from './locales.ts'
import type { createSideChatStore } from './store.ts'
import { parseSideChatAddress, newSideChatAddress } from './address.ts'
import { failureMessage } from './errors.ts'
import css from './SideChat.module.css'

/** Open the source Session's associated side-chat tab. */
export interface HeaderInjected {
  open: () => void
}

/** Source-bound header action shares. */
export type HeaderActionProps = PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS> & InjectFace<HeaderInjected>

/**
 * Offer side chat only after the source is known to be an ordinary Session.
 * @param props - source projection, navigation action, and localized copy.
 * @returns the header action or nothing inside a side chat.
 */
export function HeaderAction({ useProjection, open, t }: HeaderActionProps) {
  const snapshot = useProjection('sideChat')
  if (snapshot !== null) return null
  return (
    <Tooltip label={t('title')} side="bottom">
      <Button variant="toolbar" size="sm" onClick={open} aria-label={t('title')}>
        <IconNewChatOutlineRegular />
        <span>{t('title')}</span>
      </Button>
    </Tooltip>
  )
}

/** Declared view store shared by tab-body occurrences. */
export type SideChatStore = ReturnType<typeof createSideChatStore>
/** The view store's complete mutation face. */
export type SideChatActions = PropsStore<SideChatStore>['actions']

/** First-question handoff and explicit association read actions. */
export interface PanelInjected {
  send: (address: string, text: string, requestId: string | undefined) => void
  refresh: (address: string) => void
}

/** Sidebar-owned data, draft store, target scope, and actions. */
export type SideChatPanelProps = PropsRuntime<'sidebar.right.pane.tab'>
  & PropsRenderSlots<'sidechat.conversation'> & PropsRenderFactories & PropsStore<SideChatStore>
  & PropsLocale<typeof NS> & InjectFace<PanelInjected>

/**
 * Present an unsent source question or an independently bound target Conversation.
 * @param props - tab, resource, view store, and target content shares.
 * @returns the side-chat panel with retained history beside read failures.
 */
export function SideChatPanel({
  useTabInfo, useResource, useStore, actions, send, refresh, SessionProvider, renderSlot, renderFactorySlot, t,
}: SideChatPanelProps) {
  const { tab } = useTabInfo()
  const address = tab.contentId
  const source = parseSideChatAddress(address)
  const draft = useStore(state => source === undefined ? undefined : state.drafts[address])
  const resource = useResource<'sidechat'>(tab.contentId)
  const stale = resource.value !== undefined && (resource.value.sourceSessionId !== source?.sourceSessionId
    || resource.value.requestId !== source.requestId)
  const reference = stale ? undefined : resource.value?.reference
  const loading = stale || resource.status === 'loading'
  const unavailable = !stale && resource.status === 'none'
  const failed = !stale && resource.status === 'failed'
  const showDraft = reference === undefined || (draft?.text ?? '') !== ''
  const command = (draft?.text.trimStart() ?? '').startsWith('/')
  return (
    <section className={css.root} data-side-chat="" aria-label={t('title')}>
      {(failed || unavailable) && (
        <div role="alert" className={css.notice}>
          <span>{resource.failure !== undefined ? t('failed', { reason: failureMessage(resource.failure, t) }) : t('unavailable')}</span>
          {source !== undefined && !unavailable && (
            <Button size="sm" onClick={() => { refresh(address) }}>{t('retry')}</Button>
          )}
        </div>
      )}
      {draft?.error !== undefined && <p role="alert" className={css.notice}>{draft.error}</p>}
      {loading && <div className={css.loading} role="status" aria-label={t('loading')}><StateDot state="ongoing" /></div>}
      {source !== undefined && showDraft && !loading && (
        <div className={css.empty}>
          {reference === undefined && <p>{t('empty')}</p>}
          <p className={css.context}>{t('snapshot.pending')}</p>
          {command && <p role="alert" className={css.context}>{t('slashUnsupported')}</p>}
          <SessionProvider key={address} session={undefined} children={null} empty={() => renderFactorySlot('conversation.input', {
            variant: 'composer', textOnly: true, placeholder: t('placeholder'),
            disabled: failed || unavailable,
            ...(command ? { submissionBlocked: t('slashUnsupported') } : {}),
            pendingDraft: {
              text: draft?.text ?? '', sending: draft?.sending ?? false,
              onChange: (text) => { actions.setDraft(address, text) },
              onSubmit: () => {
                if (!command && !draft?.sending && !failed && !unavailable && (draft?.text.trim() ?? '') !== '') {
                  send(address, draft?.text ?? '', draft?.requestId)
                }
              },
            },
          })} />
        </div>
      )}
      {reference !== undefined && (
        <SessionProvider session={reference}>
          {renderSlot('sidechat.conversation', {})}
        </SessionProvider>
      )}
    </section>
  )
}

/** Session-bound embedded Conversation and snapshot presentation shares. */
export type SideChatConversationProps = PropsRuntime<'sidechat.conversation'>
  & PropsRenderFactories & PropsLocale<typeof NS>

/**
 * Keep the embedded Conversation on its Chat view.
 * @param props - Factory-local Conversation view shares.
 * @returns the ordinary Chat Session slot.
 */
export function FixedChatView(props: ConversationViewsProps) {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

/**
 * Render the public embedded Conversation with its committed snapshot facts.
 * @param props - bound Session state, projection, and Factory rendering shares.
 * @returns the snapshot note and embedded Conversation.
 */
export function SideChatConversation({
  useProjection, useSession, renderFactorySlot, t,
}: SideChatConversationProps) {
  const snapshot = useProjection('sideChat')?.snapshot
  const session = useSession(value => value)
  return (
    <div className={css.conversation}>
      <p className={css.snapshot} role="status">
        {snapshot == null
          ? t(session.lastAgentError === null ? 'snapshot.pending' : 'snapshot.incomplete')
          : t('snapshot.ready', { seq: snapshot.capturedThroughSeq })}
        {snapshot?.truncated === true && <span>{t('snapshot.cropped')}</span>}
      </p>
      {session.lastAgentError !== null && <p className={css.notice} role="alert">{t('sendFailed', { reason: session.lastAgentError })}</p>}
      {renderFactorySlot('conversation.content', {
        variant: 'embedded',
        phase: session.openState === 'loading' ? 'settling' : 'active',
        hero: false, input: { textOnly: true, placeholder: t('placeholder') },
      }, { slots: { views: FixedChatView } })}
    </div>
  )
}

/** Localized tab-title shares. */
export type SideChatTitleProps = PropsRuntime<'sidebar.right.pane.tab.title'> & PropsLocale<typeof NS>

/**
 * Label the side-chat tab with its existing chat glyph.
 * @param props - localized tab-title copy.
 * @returns the tab icon and title.
 */
export function SideChatTitle({ t }: SideChatTitleProps) {
  return <span className={css.tabTitle}><IconNewChatOutlineRegular /><span>{t('title')}</span></span>
}

/**
 * Open the source-bound side chat from the Sidebar guide's own pane.
 * @param props - source identity, guide labels, and occurrence-bound actions.
 * @returns the side-chat guide capsule.
 */
export function SideChatGuide({ sessionId, title, description, useTabInfo, useProjection }: PropsRuntime<'sidebar.right.tab.guide.entry'>) {
  const { tab } = useTabInfo()
  const snapshot = useProjection('sideChat')
  if (snapshot !== null) return null
  return <Button variant="ghost" className={css.guide} aria-label={description === undefined ? title : `${title} ${description}`} onClick={() => {
    tab.actions.openResource(newSideChatAddress(sessionId), { replaceTab: true })
  }}>
    <IconNewChatOutlineRegular />
    <span><span>{title}</span>{description !== undefined && <span className={css.context}>{description}</span>}</span>
  </Button>
}

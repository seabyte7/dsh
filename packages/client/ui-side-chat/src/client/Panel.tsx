/** Side-chat presentation uses existing Session scopes, resources, and input actions. */
import type {
  ConversationViewsProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button, StateDot, Tooltip, IconNewChatOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsLocale, PropsRenderFactories, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-side-chat/types'
import type { NS } from './locales.ts'
import type { createSideChatStore } from './store.ts'
import { parseSideChatAddress } from './address.ts'
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
  send: (source: SessionId, text: string, requestId: string | undefined) => void
  refresh: (source: SessionId) => void
}

/** Sidebar-owned data, draft store, target scope, and actions. */
export type SideChatPanelProps = PropsRuntime<'sidebar.right.pane.tab'>
  & PropsRenderSlots<'sidechat.conversation'> & PropsStore<SideChatStore>
  & PropsLocale<typeof NS> & InjectFace<PanelInjected>

/**
 * Present an unsent source question or an independently bound target Conversation.
 * @param props - tab, resource, view store, and target content shares.
 * @returns the side-chat panel with retained history beside read failures.
 */
export function SideChatPanel({
  useTabInfo, useResource, useStore, actions, send, refresh, SessionProvider, renderSlot, t,
}: SideChatPanelProps) {
  const { tab } = useTabInfo()
  const source = parseSideChatAddress(tab.contentId)
  const draft = useStore(state => source === undefined ? undefined : state.drafts[source])
  const resource = useResource<'sidechat'>(tab.contentId)
  const reference = resource.value?.reference
  const loading = resource.status === 'loading'
  const unavailable = resource.status === 'none'
  const failed = resource.status === 'failed'
  const showDraft = reference === undefined || (draft?.text ?? '') !== ''
  const command = (draft?.text.trimStart() ?? '').startsWith('/')
  return (
    <section className={css.root} data-side-chat="" aria-label={t('title')}>
      {(failed || unavailable) && (
        <div role="alert" className={css.notice}>
          <span>{resource.failure !== undefined ? t('failed', { reason: failureMessage(resource.failure, t) }) : t('unavailable')}</span>
          {source !== undefined && !unavailable && (
            <Button size="sm" onClick={() => { refresh(source) }}>{t('retry')}</Button>
          )}
        </div>
      )}
      {draft?.error !== undefined && <p role="alert" className={css.notice}>{draft.error}</p>}
      {loading && <div className={css.loading} role="status" aria-label={t('loading')}><StateDot state="ongoing" /></div>}
      {source !== undefined && showDraft && !loading && (
        <form className={css.empty} onSubmit={(event) => {
          event.preventDefault()
          if (!command && !draft?.sending && !failed && !unavailable && (draft?.text.trim() ?? '') !== '') {
            send(source, draft?.text ?? '', draft?.requestId)
          }
        }}>
          {reference === undefined && <p>{t('empty')}</p>}
          <p className={css.context}>{t('snapshot.pending')}</p>
          {command && <p role="alert" className={css.context}>{t('slashUnsupported')}</p>}
          <label className={css.label} htmlFor={`side-chat-question-${tab.id}`}>{t('question')}</label>
          <textarea
            id={`side-chat-question-${tab.id}`}
            className={css.input}
            value={draft?.text ?? ''}
            placeholder={t('placeholder')}
            disabled={draft?.sending || failed || unavailable}
            onChange={(event) => { actions.setDraft(source, event.target.value) }}
          />
          <div className={css.actions}>
            <Button variant="primary" type="submit" aria-label={t('send')} disabled={command || draft?.sending || failed || unavailable || (draft?.text.trim() ?? '') === ''}>
              {draft?.sending ? <StateDot state="ongoing" /> : t('send')}
            </Button>
          </div>
        </form>
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
      {renderFactorySlot('conversation.content', {
        variant: 'embedded',
        phase: session.openState === 'loading' ? 'settling' : 'active',
        hero: false,
      }, { slots: { views: FixedChatView } })}
    </div>
  )
}

/** Target-scoped Stop action. */
export interface ComposerInjected {
  stop: () => void
}

/** Standard input and Session shares for the elected question composer. */
export type SideChatComposerProps = PropsRuntime<'conversation.composer'> & PropsLocale<typeof NS>
  & { matched: { sideChat: true } } & InjectFace<ComposerInjected>

/**
 * Submit text questions through the existing Session input actions.
 * @param props - bound input, access, archive state, and Stop action.
 * @returns the text-only question composer with visible failure and read-only reasons.
 */
export function SideChatComposer({
  sessionId, useInput, inputActions, useSession, useAccess, useWorkspaces, stop, t,
}: SideChatComposerProps) {
  const input = useInput(value => value)
  const session = useSession(value => value)
  const canPrompt = useAccess('session/prompt')
  const canStop = useAccess('session/cancel')
  const archived = useWorkspaces(value => value.archivedSessionIds.includes(sessionId))
  const readonly = !canPrompt || archived || session.removed || session.openState !== 'open'
  const busy = input.phase === 'adjudicating' || input.phase === 'submitting'
  const command = input.draft.trimStart().startsWith('/') || input.claim !== undefined
  const attachments = input.attachmentIds.length > 0
  const error = session.promptError?.error.message ?? session.openError?.message ?? session.lastAgentError
  return (
    <form className={css.composer} onSubmit={(event) => {
      event.preventDefault()
      if (!command && !attachments && !readonly && !busy && input.draft.trim() !== '') inputActions.submit()
    }}>
      {error != null && <p className={css.notice} role="alert">{t('sendFailed', { reason: error })}</p>}
      {readonly && error == null && <p className={css.context}>{t('readonly')}</p>}
      {command && <p className={css.context} role="alert">{t('slashUnsupported')}</p>}
      {attachments && (
        <div className={css.notice} role="alert">
          <span>{t('attachmentsUnsupported')}</span>
          <Button size="sm" disabled={busy} onClick={() => {
            for (const id of input.attachmentIds) inputActions.removeAttachment(id)
          }}>{t('removeAttachments')}</Button>
        </div>
      )}
      <label className={css.label} htmlFor={`side-chat-followup-${sessionId}`}>{t('question')}</label>
      <textarea
        id={`side-chat-followup-${sessionId}`}
        className={css.input}
        value={input.draft}
        placeholder={t('placeholder')}
        disabled={readonly || busy}
        onChange={(event) => { inputActions.setDraft(event.target.value) }}
      />
      <div className={css.actions}>
        {session.running && <Button size="sm" onClick={stop} disabled={!canStop}>{t('stop')}</Button>}
        <Button type="submit" variant="primary" size="sm" disabled={command || attachments || readonly || busy || input.draft.trim() === ''}>{t('send')}</Button>
      </div>
    </form>
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

/** Component-owned editor for a draft that has no target Session yet. */
import { useEffect, useMemo, useRef } from 'react'
import type { InputState } from '../../contract/input.ts'
import type { ComposerKeyboard } from '../../contract/draft-editor.ts'
import type { ComposerBarOwnerProps } from '../../contract/slots.ts'
import { DraftEditorRuntime } from './runtime.ts'

/**
 * Bind a feature-owned draft to the ordinary editor and keymap without allocating a Session.
 * @param draft - draft values and callbacks supplied by the hosting feature.
 * @returns component-owned keyboard operations, absent for Session-bound input.
 */
export function usePendingComposer(draft: ComposerBarOwnerProps['pendingDraft']): ComposerKeyboard | undefined {
  const current = useRef(draft)
  current.current = draft
  const active = draft !== undefined
  const model = useMemo(() => {
    if (!active) return undefined
    const lexicon = new Map<'/' | '@', readonly string[]>()
    const runtime = new DraftEditorRuntime({
      onUpdate: () => {
        runtime.refreshProjection()
        const text = runtime.projection.clipboardText
        if (text !== current.current?.text) current.current?.onChange(text)
      },
      openReference: () => false,
      lexicon: () => lexicon,
      resolveLexicon: () => undefined,
    })
    const keyboard: ComposerKeyboard = {
      editor: runtime.editor,
      get snapshot(): InputState {
        return {
          draft: current.current?.text ?? '', draftRev: 0, occurrences: [], attachmentIds: [], queue: [],
          phase: current.current?.sending ? 'submitting' : 'plain',
        }
      },
      submit: () => { if (!current.current?.sending) current.current?.onSubmit() },
      paste: (text) => { runtime.paste(text) },
      caretSpan: () => runtime.caretSpan(),
      arbitrate: () => 'pass',
      space: () => false,
      dismissPopup: () => {},
      // A draft without a Session has neither an inbox nor attachment intake.
      steerQueue: () => {},
      bindFilePicker: () => () => {},
    }
    return { runtime, keyboard }
  }, [active])
  useEffect(() => model?.runtime.register(), [model])
  useEffect(() => {
    if (draft !== undefined) model?.runtime.setDraft(draft.text)
  }, [model, draft?.text])
  return model?.keyboard
}

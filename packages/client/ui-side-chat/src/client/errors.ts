/** Localized recovery guidance for typed side-chat admission failures. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-side-chat/types'
import type { NS } from './locales.ts'

/**
 * Resolve known admission failures to locale-owned guidance and preserve other diagnostics.
 * @param failure - remote operation failure.
 * @param t - side-chat dictionary translator.
 * @returns a localized reason or the unrelated operation's diagnostic.
 */
export function failureMessage(failure: RemoteFailure, t: PropsLocale<typeof NS>['t']): string {
  return failure.code === 'side-chat/unavailable' ? t(`failure.${failure.details.reason}`) : failure.message
}

/** Session-routed request emitted after a non-React command popup edits the draft. */
export interface ComposerFocusRequest {
  readonly sessionId: string
  readonly expectedDraft: string
  readonly caret: number
}

export const COMPOSER_FOCUS_EVENT = 'dsh-skill-importer/composer-focus'

/** Ask the mounted picker in one session to restore its composer focus. */
export function requestComposerFocus(request: ComposerFocusRequest): void {
  window.dispatchEvent(new CustomEvent<ComposerFocusRequest>(COMPOSER_FOCUS_EVENT, { detail: request }))
}

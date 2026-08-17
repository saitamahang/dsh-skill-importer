/** One safe, collapsed-caret Backspace rewrite over a leading skill token. */
export interface AtomicSkillDeleteEdit {
  readonly draft: string
  readonly caret: number
}

interface LeadingSkillToken {
  readonly tokenEnd: number
  readonly boundaryEnd: number
}

function leadingSkillToken(draft: string, names: readonly string[]): LeadingSkillToken | undefined {
  const ordered = [...new Set(names)].sort((a, b) => b.length - a.length)
  for (const name of ordered) {
    if (name.length === 0) continue
    const token = `/${name}`
    if (!draft.startsWith(token)) continue
    const following = draft[token.length]
    if (following !== undefined && !/\s/u.test(following)) continue
    return {
      tokenEnd: token.length,
      boundaryEnd: token.length + (following === ' ' ? 1 : 0),
    }
  }
  return undefined
}

/**
 * Delete one exact, leading, installed `/name` token as a single edit.
 *
 * This deliberately handles only the common boundary gesture. Selections,
 * token-internal edits, unknown names, leading whitespace, and non-boundary
 * carets fall through to the textarea's normal behavior.
 */
export function atomicSkillBackspace(
  draft: string,
  caret: number,
  names: readonly string[],
): AtomicSkillDeleteEdit | undefined {
  if (!Number.isInteger(caret) || caret < 0 || caret > draft.length) return undefined

  const token = leadingSkillToken(draft, names)
  if (token === undefined) return undefined
  if (caret !== token.tokenEnd && caret !== token.boundaryEnd) return undefined
  return { draft: draft.slice(token.boundaryEnd), caret: 0 }
}

/**
 * Resolve one whole-token horizontal caret jump.
 * Left from anywhere inside/just after the leading skill goes before it;
 * right from before/inside it goes after its single separator.
 */
export function atomicSkillArrow(
  draft: string,
  caret: number,
  direction: 'left' | 'right',
  names: readonly string[],
): number | undefined {
  if (!Number.isInteger(caret) || caret < 0 || caret > draft.length) return undefined
  const token = leadingSkillToken(draft, names)
  if (token === undefined) return undefined
  if (direction === 'left' && caret > 0 && caret <= token.boundaryEnd) return 0
  if (direction === 'right' && caret >= 0 && caret < token.boundaryEnd) return token.boundaryEnd
  return undefined
}

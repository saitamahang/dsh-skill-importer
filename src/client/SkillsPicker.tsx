/**
 * Composer skill picker: a compact pill trigger in the composer's tool row
 * (`conversation.input.left`, right after the resident chrome), styled like
 * the permission (access-mode) select beside it. Opens a top-anchored panel
 * with a name-filter search box; each row shows a first-letter avatar and
 * the bare skill name (no leading `/`). Picking a skill prefixes the draft
 * with `/name ` — the native text gesture — highlighted via the plugin's
 * lexicon contribution.
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import { IconChecklistOutline14, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillImporterInjected } from './index.ts'
import { atomicSkillArrow, atomicSkillBackspace } from './atomicSkillDelete.ts'
import { COMPOSER_FOCUS_EVENT, type ComposerFocusRequest } from './composerFocus.ts'

/** Find the one composer textarea owned by the picker nearest in the slot tree. */
function composerTextareaFor(root: HTMLElement | null): HTMLTextAreaElement | undefined {
  let node = root?.parentElement
  while (node !== null && node !== undefined) {
    const textareas = node.querySelectorAll('textarea')
    if (textareas.length > 0) return textareas.length === 1 ? textareas[0] : undefined
    node = node.parentElement
  }
  return undefined
}

/** Props the renderer binds for the picker. */
export type SkillsPickerProps =
  PropsRuntime<'conversation.input.left'>
  & PropsLocale<'skills.importer'>
  & InjectFace<SkillImporterInjected>

/** One row of the composer skill picker. */
export function SkillsPicker({ t, sessionId, useInput, inputActions, actions }: SkillsPickerProps): ReactNode {
  const input = useInput((value) => value.draft)

  const [skills, setSkills] = useState<Awaited<ReturnType<typeof actions.refreshSkillsForSession>>>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef(input)
  const skillNamesRef = useRef<readonly string[]>([])
  const caretFrameRef = useRef<number>()

  // Load once so the trigger can render, refresh on every open using the
  // session's latest cwd, then keep an open picker synchronized without
  // leaving a permanent background poll behind.
  useEffect(() => {
    let cancelled = false
    const refresh = (showLoading: boolean): void => {
      if (showLoading) setLoading(true)
      void actions.refreshSkillsForSession(sessionId).then(
        (rows) => {
          if (!cancelled) {
            setSkills(rows)
            setLoading(false)
          }
        },
        () => {
          if (!cancelled) {
            setSkills([])
            setLoading(false)
          }
        },
      )
    }
    refresh(true)
    const timer = open ? window.setInterval(() => refresh(false), 2000) : undefined
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [actions, sessionId, open])

  // Close on outside pointer-down; reset the filter each open.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  // Keep the entry stable even when the current project has no skills; the
  // open panel owns the loading and empty states instead of disappearing.
  const usable = skills.filter((skill) => skill.userInvocable)
  draftRef.current = input
  skillNamesRef.current = usable.map((skill) => skill.name)

  const scheduleComposerFocus = (expectedDraft: string, caret: number): void => {
    const textarea = composerTextareaFor(rootRef.current)
    if (caretFrameRef.current !== undefined) window.cancelAnimationFrame(caretFrameRef.current)
    caretFrameRef.current = window.requestAnimationFrame(() => {
      caretFrameRef.current = undefined
      if (textarea === undefined || !textarea.isConnected || textarea.value !== expectedDraft) return
      textarea.focus({ preventScroll: true })
      textarea.setSelectionRange(caret, caret)
    })
  }

  // `/skills` is owned by DSH's popupSelect shell rather than this component.
  // Route its post-selection focus request back to the matching session only.
  useEffect(() => {
    const onFocusRequest = (event: Event): void => {
      const request = (event as CustomEvent<ComposerFocusRequest>).detail
      if (request.sessionId !== sessionId) return
      scheduleComposerFocus(request.expectedDraft, request.caret)
    }
    window.addEventListener(COMPOSER_FOCUS_EVENT, onFocusRequest)
    return () => window.removeEventListener(COMPOSER_FOCUS_EVENT, onFocusRequest)
  }, [sessionId])

  // DSH does not expose the private composer keyboard face to plugins. Keep
  // this enhancement deliberately narrow: one captured Backspace over the
  // active textarea, only when this session's picker and draft own it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!['Backspace', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.shiftKey && event.key !== 'Backspace') return
      const textarea = event.target
      if (!(textarea instanceof HTMLTextAreaElement) || document.activeElement !== textarea) return
      if (composerTextareaFor(rootRef.current) !== textarea || textarea.value !== draftRef.current) return
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      if (start === null || end === null || start !== end) return

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const caret = atomicSkillArrow(
          draftRef.current,
          start,
          event.key === 'ArrowLeft' ? 'left' : 'right',
          skillNamesRef.current,
        )
        if (caret === undefined) return
        event.preventDefault()
        event.stopPropagation()
        textarea.setSelectionRange(caret, caret)
        return
      }

      const edit = atomicSkillBackspace(draftRef.current, start, skillNamesRef.current)
      if (edit === undefined) return
      event.preventDefault()
      event.stopPropagation()
      inputActions.setDraft(edit.draft)

      if (caretFrameRef.current !== undefined) window.cancelAnimationFrame(caretFrameRef.current)
      caretFrameRef.current = window.requestAnimationFrame(() => {
        caretFrameRef.current = undefined
        if (!textarea.isConnected || document.activeElement !== textarea || textarea.value !== edit.draft) return
        textarea.setSelectionRange(edit.caret, edit.caret)
      })
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (caretFrameRef.current !== undefined) window.cancelAnimationFrame(caretFrameRef.current)
    }
  }, [inputActions])

  const filtered = query.trim().length === 0
    ? usable
    : usable.filter((skill) => skill.name.toLowerCase().includes(query.trim().toLowerCase()))

  const onSelect = (name: string): void => {
    const prefix = `/${name} `
    const nextDraft = `${prefix}${input}`
    setOpen(false)
    // Prefix the draft with the `/name ` gesture, preserving what the user
    // already typed. setDraft is the input machine's single public write path.
    inputActions.setDraft(nextDraft)

    // The custom picker owns its search focus, unlike DSH's popupSelect shell.
    // Return focus explicitly and place the caret immediately after the skill.
    scheduleComposerFocus(nextDraft, prefix.length)
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label={t('pickerLabel')}
        aria-expanded={open}
        onClick={() => {
          if (!open) setLoading(true)
          setOpen((value) => !value)
        }}
        style={triggerStyle}
      >
        <span style={triggerIconStyle} aria-hidden="true"><IconChecklistOutline14 /></span>
        <span style={triggerLabelStyle}>{t('pickerPlaceholder')}</span>
        <span style={{ ...chevronStyle, transform: open ? 'rotate(180deg)' : undefined }} aria-hidden="true">
          <IconChevronDownOutline14 />
        </span>
      </button>

      {open ? (
        <div style={panelStyle}>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('pickerSearchPlaceholder')}
            style={searchStyle}
          />
          {loading ? <div style={emptyStyle}>{t('pickerLoading')}</div> : <ul style={listStyle}>
              {filtered.map((skill) => (
                <li key={skill.name}>
                  <button type="button" onClick={() => onSelect(skill.name)} style={rowStyle}>
                    <span style={avatarStyle} aria-hidden="true">{skill.name.charAt(0).toUpperCase()}</span>
                    <span style={rowCopyStyle}>
                      <span style={rowLabelStyle}>{skill.name}</span>
                      <span style={rowDetailStyle}>{skill.source === 'project-dsh' ? t('pickerSourceProjectDsh') : skill.source === 'project-agents' ? t('pickerSourceProjectAgents') : skill.source === 'user-dsh' ? t('pickerSourceUserDsh') : t('pickerSourceUserAgents')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>}
          {!loading && filtered.length === 0 ? (
            <div style={emptyStyle}>{t('pickerEmpty')}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ---- Trigger: same pill as the access-mode select ----

const triggerStyle: CSSProperties = {
  minWidth: 0,
  maxWidth: 220,
  height: 28,
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  borderRadius: 24,
  outline: 'none',
  alignItems: 'center',
  gap: 4,
  padding: '0 4px 0 8px',
  fontSize: 13,
  fontWeight: 500,
  lineHeight: '20px',
  display: 'inline-flex',
}

const triggerIconStyle: CSSProperties = { flex: 'none', display: 'inline-flex' }

const triggerLabelStyle: CSSProperties = {
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  overflow: 'hidden',
}

const chevronStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-caption)',
  flex: 'none',
  transition: 'transform .12s',
  display: 'inline-flex',
}

// ---- Panel: top-anchored dropdown with search + avatar rows ----

const panelStyle: CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 8px)',
  left: 0,
  zIndex: 100,
  boxSizing: 'border-box',
  width: 264,
  maxHeight: 320,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 8,
  border: '1px solid var(--dsw-alias-border-inverted)',
  borderRadius: 12,
  background: 'var(--dsw-specific-menu)',
  boxShadow: 'var(--dsw-shadow-lv3)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 13,
  lineHeight: '20px',
}

const searchStyle: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)',
  font: 'inherit',
  fontSize: 13,
  color: 'var(--dsw-alias-label-primary)',
  outline: 'none',
}

const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
  maxHeight: 260,
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '5px 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  font: 'inherit',
  fontSize: 13,
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
  textAlign: 'left',
}

const avatarStyle: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: 999,
  background: 'var(--dsw-alias-interactive-bg-hover)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  fontWeight: 600,
}

const rowLabelStyle: CSSProperties = {
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  overflow: 'hidden',
}

const rowCopyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  flex: 1,
  lineHeight: '18px',
}

const rowDetailStyle: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--dsw-alias-label-caption)',
  fontSize: 11,
  lineHeight: '16px',
}

const emptyStyle: CSSProperties = {
  padding: '8px 10px',
  fontSize: 12,
  color: 'var(--dsw-alias-label-caption)',
}

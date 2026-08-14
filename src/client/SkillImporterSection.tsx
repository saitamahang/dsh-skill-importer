/**
 * Skill importer settings section, styled after the harness's General
 * settings rows: one Setting-Cell per block (title + control, hairline
 * separator), design tokens throughout, full zh/en copy.
 *
 * Rows: entry-points description · installed list · file/URL import · target
 * directory · import action. Pure presentation — all data and actions arrive
 * through the four props shares.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import { parseSkillFile, validateSkillFile } from '../frontmatter.ts'
import type { DeleteRequest, ImportTarget, SkillListEntry } from '../types.ts'
import { nameFromUrl } from './name.ts'
import type { SkillImporterInjected } from './index.ts'

/** Props the renderer binds for the section. */
export type SkillImporterProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'skills.importer'>
  & InjectFace<SkillImporterInjected>

/** One parsed file awaiting import. */
interface FileDraft {
  readonly fileName: string
  readonly text: string
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly userInvocable: boolean
  readonly modelInvocable: boolean
}

const MAX_FILE_BYTES = 256 * 1024

/** Read a picked file's text (browser-local; nothing crosses the wire except the import itself). */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('FileReader failed'))
    reader.readAsText(file)
  })
}

/** The settings section's page body. */
export function SkillImporterSection({ t, useSkills, useWorkspaces, actions }: SkillImporterProps): ReactNode {
  const skills = useSkills((value) => value)
  const workspaces = useWorkspaces((value) => value)

  // The "current workspace": the most recently active one, else the first
  // registered. Project targets write under its canonical path (host-validated).
  const workspace = useMemo(
    () => workspaces.items.find((item) => item.workspaceId === workspaces.recentWorkspaceId) ?? workspaces.items[0],
    [workspaces.items, workspaces.recentWorkspaceId],
  )

  // List lifecycle: refresh on mount and on demand.
  const [listState, setListState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [listError, setListError] = useState<string>()
  const [listEpoch, setListEpoch] = useState(0)
  useEffect(() => {
    let cancelled = false
    setListState('loading')
    actions.refreshSkills().then(
      () => {
        if (!cancelled) setListState('idle')
      },
      (error: unknown) => {
        if (!cancelled) {
          setListState('error')
          setListError(String(error))
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [listEpoch, actions])

  // Import form state.
  const [mode, setMode] = useState<'file' | 'url'>('file')
  const [target, setTarget] = useState<ImportTarget>('project-agents')
  const [fileDraft, setFileDraft] = useState<FileDraft | undefined>()
  const [fileError, setFileError] = useState<string>()
  const [url, setUrl] = useState('')
  const [urlName, setUrlName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [messageError, setMessageError] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const onFilePicked = async (file: File | undefined): Promise<void> => {
    setFileDraft(undefined)
    setFileError(undefined)
    if (file === undefined) return
    if (file.size > MAX_FILE_BYTES) {
      setFileError(t('fileTooLarge'))
      return
    }
    let text: string
    try {
      text = await readFileText(file)
    } catch (error) {
      setFileError(`${t('unreadableFile')}: ${String(error)}`)
      return
    }
    const problem = validateSkillFile(text)
    if (problem !== undefined) {
      setFileError(problem)
      return
    }
    const { frontmatter } = parseSkillFile(text)
    setFileDraft({
      fileName: file.name,
      text,
      name: frontmatter.name ?? '',
      description: frontmatter.description ?? '',
      whenToUse: frontmatter.whenToUse,
      userInvocable: frontmatter.userInvocable !== false,
      modelInvocable: frontmatter.disableModelInvocation !== true,
    })
  }

  const effectiveUrlName = urlName.trim() || nameFromUrl(url)

  // Poll until the imported skill shows up in the catalog (the host write is
  // synchronous, but the skill-filesystem watcher may lag a moment). Stops
  // on first sighting.
  const pollForSkill = (name: string, attemptsLeft: number): void => {
    if (attemptsLeft <= 0) return
    window.setTimeout(() => {
      void actions.refreshSkills().then(
        (rows) => {
          if (!rows.some((skill) => skill.name === name)) pollForSkill(name, attemptsLeft - 1)
        },
        () => pollForSkill(name, attemptsLeft - 1),
      )
    }, 2000)
  }

  const removeSkill = async (skill: SkillListEntry): Promise<void> => {
    const ok = window.confirm(t('deleteConfirm', { name: skill.name }))
    if (!ok) return
    setBusy(true)
    setMessage(undefined)
    setMessageError(false)
    try {
      const removed = await actions.deleteSkill({
        name: skill.name,
        source: skill.source,
        workspacePath: workspace?.path,
      } satisfies DeleteRequest)
      if (removed) setMessage(t('deleted'))
      setListEpoch((epoch) => epoch + 1)
    } catch (error) {
      setMessageError(true)
      setMessage(`${t('deleteFailed')}：${String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setMessage(undefined)
    setMessageError(false)
    try {
      let path: string
      if (mode === 'file') {
        if (fileDraft === undefined) return
        path = await actions.importSkill({
          name: fileDraft.name,
          target,
          content: fileDraft.text,
          workspacePath: workspace?.path,
        })
        pollForSkill(fileDraft.name, 10)
      } else {
        path = await actions.importUrl({
          name: effectiveUrlName,
          target,
          url: url.trim(),
          workspacePath: workspace?.path,
        })
        pollForSkill(effectiveUrlName, 10)
      }
      setMessage(`${t('imported')}${path}`)
      // Reset the import form so the next import starts clean.
      setFileDraft(undefined)
      setFileError(undefined)
      if (fileInput.current !== null) fileInput.current.value = ''
      setUrl('')
      setUrlName('')
      setListEpoch((epoch) => epoch + 1)
    } catch (error) {
      setMessageError(true)
      setMessage(`${t('importFailed')}：${String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = busy
    || (mode === 'file' && fileDraft === undefined)
    || (mode === 'url' && (url.trim().length === 0 || !/^https?:\/\//i.test(url.trim())))
    || (target !== 'user' && workspace === undefined)

  const flags = (skill: SkillListEntry): string | undefined => {
    if (!skill.modelInvocable && skill.userInvocable) return t('userOnly')
    if (skill.modelInvocable && !skill.userInvocable) return t('modelOnly')
    return undefined
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      {/* Entry points */}
      <div style={rowStyle}>
        <div style={rowTextStyle}>
          <div style={titleStyle}>{t('entryTitle')}</div>
          <div style={descriptionStyle}>{t('entryDescription')}</div>
        </div>
      </div>

      {/* Installed skills */}
      <div style={rowStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ ...titleStyle, flex: 1 }}>{t('installedTitle')}</div>
          <button type="button" onClick={() => setListEpoch((epoch) => epoch + 1)} style={pillStyle}>
            {listState === 'loading' ? '…' : t('refresh')}
          </button>
        </div>
        {listState === 'error' ? (
          <div style={{ ...descriptionStyle, color: 'var(--dsw-alias-state-error-primary)' }}>
            {t('installedFailed')}: {listError}
          </div>
        ) : null}
        {listState === 'idle' && skills.length === 0 ? (
          <div style={descriptionStyle}>{t('installedEmpty')}</div>
        ) : null}
        {skills.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {(['project-agents', 'project-dsh', 'user'] as const).map((source) => {
              const rows = skills.filter((skill) => skill.source === source)
              if (rows.length === 0) return null
              return (
                <div key={source} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ ...descriptionStyle, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 8 }}>
                    {t(`source${source === 'project-agents' ? 'Agents' : source === 'project-dsh' ? 'Dsh' : 'User'}`)}
                  </div>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
                    {rows.map((skill) => {
                      const flag = flags(skill)
                      return (
                        <li key={skill.source + ':' + skill.name}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>
                              /{skill.name}
                              {flag !== undefined ? <span style={{ opacity: 0.6, fontWeight: 400, marginLeft: 8 }}>{flag}</span> : null}
                            </span>
                            <span style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }}>{skill.description}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => { void removeSkill(skill) }}
                            style={{ ...pillStyle, flex: 'none', color: 'var(--dsw-alias-state-error-primary)' }}
                          >
                            {t('delete')}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>

      {/* Import */}
      <div style={rowStyle}>
        <div style={rowTextStyle}>
          <div style={titleStyle}>{t('importTitle')}</div>

          {/* File / URL mode tabs */}
          <div role="tablist" style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="button" role="tab" aria-selected={mode === 'file'} onClick={() => setMode('file')}
              style={segmentStyle(mode === 'file')}>
              {t('fileTab')}
            </button>
            <button type="button" role="tab" aria-selected={mode === 'url'} onClick={() => setMode('url')}
              style={segmentStyle(mode === 'url')}>
              {t('urlTab')}
            </button>
          </div>

          {mode === 'file' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              <input
                ref={fileInput}
                type="file"
                accept=".md,.markdown,text/markdown,text/plain"
                onChange={(event) => { void onFilePicked(event.target.files?.[0]) }}
                style={{ ...controlStyle, padding: 8 }}
              />
              <div style={descriptionStyle}>{t('fileHelp')}</div>
              {fileError !== undefined ? (
                <div style={{ ...descriptionStyle, color: 'var(--dsw-alias-state-error-primary)' }}>{fileError}</div>
              ) : null}
              {fileDraft !== undefined ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: 10, color: 'var(--dsw-alias-label-secondary)' }}>
                  <span style={{ fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>{t('previewTitle')}</span>
                  <span>{t('previewName')}: <strong>{fileDraft.name}</strong></span>
                  <span>{t('previewDescription')}: {fileDraft.description}</span>
                  {fileDraft.whenToUse !== undefined ? (
                    <span>{t('previewWhenToUse')}: {fileDraft.whenToUse}</span>
                  ) : null}
                  <span style={{ opacity: 0.8 }}>{fileDraft.fileName} · {t('previewOk')}</span>
                </div>
              ) : null}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>{t('urlLabel')}</span>
                <input
                  type="url"
                  value={url}
                  placeholder="https://example.com/my-skill.md"
                  onChange={(event) => setUrl(event.target.value)}
                  style={controlStyle}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>{t('urlNameLabel')}</span>
                <input
                  type="text"
                  value={urlName}
                  placeholder={nameFromUrl(url) || 'my-skill'}
                  onChange={(event) => setUrlName(event.target.value)}
                  style={controlStyle}
                />
                <span style={descriptionStyle}>{t('urlNameHelp')}</span>
              </label>
            </div>
          )}

          {/* Target directory */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginTop: 12 }}>
            <span style={{ fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>{t('targetLabel')}</span>
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value as ImportTarget)}
              style={selectStyle}
            >
              <option value="project-agents" disabled={workspace === undefined}>
                {workspace === undefined ? t('targetProjectNoWorkspace') : t('targetProjectAgents', { title: workspace.title })}
              </option>
              <option value="project-dsh" disabled={workspace === undefined}>
                {workspace === undefined ? t('targetProjectNoWorkspace') : t('targetProjectDsh', { title: workspace.title })}
              </option>
              <option value="user">{t('targetUser')}</option>
            </select>
            {workspace === undefined ? (
              <span style={descriptionStyle}>{t('noWorkspace')}</span>
            ) : null}
          </label>

          {/* Action */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <button type="button" disabled={canSubmit} onClick={() => { void submit() }} style={canSubmit ? primaryDisabledStyle : primaryStyle}>
              {busy ? t('importing') : t('import')}
            </button>
            {message !== undefined ? (
              <span style={{ fontSize: 12, color: messageError ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)', wordBreak: 'break-all' }}>
                {message}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- Shared row / control styles (mirror the General settings Setting-Cell) ----

const rowStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '16px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}

const rowTextStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 0,
}

const titleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  lineHeight: '22px',
  color: 'var(--dsw-alias-label-primary)',
}

const descriptionStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-caption)',
}

const pillStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 28,
  padding: '0 12px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 14,
  background: 'transparent',
  font: 'inherit',
  fontSize: 13,
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
}

const controlStyle: CSSProperties = {
  padding: '7px 12px',
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)',
  font: 'inherit',
  fontSize: 14,
  lineHeight: '22px',
  color: 'var(--dsw-alias-label-primary)',
  outline: 'none',
}

/** Select variant: replace the OS arrow with the shared 12px chevron inset
 * (same treatment as the composer chips / models page selects). */
const selectStyle: CSSProperties = {
  ...controlStyle,
  appearance: 'none',
  paddingRight: 32,
  backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 12 12%27 fill=%27none%27%3E%3Cpath d=%27M3 4.5L6 7.5L9 4.5%27 stroke=%27%2381858C%27 stroke-width=%271.5%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  backgroundSize: '12px 12px',
  cursor: 'pointer',
}

const segmentStyle = (active: boolean): CSSProperties => ({
  padding: '4px 14px',
  borderRadius: 14,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: active ? 'var(--dsw-alias-bg-module-platform)' : 'transparent',
  color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
  font: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
})

const primaryStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 36,
  padding: '0 14px',
  border: 'none',
  borderRadius: 18,
  background: 'var(--dsw-alias-button-primary-fill)',
  color: 'var(--dsw-alias-label-primary-foreground)',
  font: 'inherit',
  fontSize: 14,
  lineHeight: '22px',
  cursor: 'pointer',
}

/** Disabled import: the action is unavailable until input exists, so the
 * button visibly greys out (matches the config pages' disabled controls). */
const primaryDisabledStyle: CSSProperties = {
  ...primaryStyle,
  opacity: 0.6,
  cursor: 'default',
}

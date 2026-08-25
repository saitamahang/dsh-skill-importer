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
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { parseSkillFile, validateSkillFile } from '../frontmatter.ts'
import type {
  BatchCommitEntry, BatchScanResponse, DeleteRequest, ImportTarget, SkillListEntry,
  UpdateStatusResponse,
} from '../types.ts'
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

function FileIcon(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M5.25 2.25h4.2l3.3 3.3v9.2a1 1 0 0 1-1 1h-6.5a1 1 0 0 1-1-1V3.25a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M9.25 2.5v3.25h3.25M6.75 9h4.5M6.75 11.75h3.25" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function LinkIcon(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="m7.15 10.85 3.7-3.7M6.05 12.55l-1.1 1.1a2.6 2.6 0 0 1-3.68-3.68l2.3-2.3a2.6 2.6 0 0 1 3.68 0M11.95 5.45l1.1-1.1a2.6 2.6 0 1 1 3.68 3.68l-2.3 2.3a2.6 2.6 0 0 1-3.68 0" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  )
}

function BatchIcon(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3 4.25h12v9.5H3zM3 7.25h12M6.25 2.5v3.25M11.75 2.5v3.25M6 10.5h2M10 10.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckIcon(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="m3 7.25 2.4 2.4L11 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TrashIcon(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2.5 3.75h9M5.25 3.75V2.5h3.5v1.25M4 3.75l.55 7.15a.75.75 0 0 0 .75.7h3.4a.75.75 0 0 0 .75-.7L10 3.75M5.75 6v3.25M8.25 6v3.25" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"
      style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms ease' }}
    >
      <path d="m5 3.25 3.75 3.75L5 10.75" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

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
export function SkillImporterSection({ t, useSkills, useSkillIssues, useWorkspaces, actions }: SkillImporterProps): ReactNode {
  const skills = useSkills((value) => value)
  const skillIssues = useSkillIssues((value) => value)
  const workspaces = useWorkspaces((value) => value)

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>(
    () => workspaces.recentWorkspaceId ?? workspaces.items[0]?.workspaceId,
  )
  useEffect(() => {
    if (selectedWorkspaceId !== undefined
      && workspaces.items.some((item) => item.workspaceId === selectedWorkspaceId)) return
    setSelectedWorkspaceId(workspaces.recentWorkspaceId ?? workspaces.items[0]?.workspaceId)
  }, [selectedWorkspaceId, workspaces.items, workspaces.recentWorkspaceId])

  // Project targets use the explicit settings-page selection. The initial
  // value follows DSH's recent workspace, but user choice is not overwritten.
  const workspace = useMemo(
    () => workspaces.items.find((item) => item.workspaceId === selectedWorkspaceId),
    [selectedWorkspaceId, workspaces.items],
  )
  // List lifecycle: refresh on mount and on demand.
  const [listState, setListState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [listError, setListError] = useState<string>()
  const [listEpoch, setListEpoch] = useState(0)
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set())
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
  const [mode, setMode] = useState<'file' | 'url' | 'batch'>('file')
  const [target, setTarget] = useState<ImportTarget>('project-dsh')
  useEffect(() => {
    if (workspaces.items.length === 0 && target.startsWith('project-')) setTarget('user-dsh')
  }, [target, workspaces.items.length])
  const [fileDraft, setFileDraft] = useState<FileDraft | undefined>()
  const [fileError, setFileError] = useState<string>()
  const [url, setUrl] = useState('')
  const [urlName, setUrlName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [messageError, setMessageError] = useState(false)
  const [batchPath, setBatchPath] = useState<string>()
  const [batchScan, setBatchScan] = useState<BatchScanResponse>()
  const [batchResults, setBatchResults] = useState<readonly BatchCommitEntry[]>()
  const [replaceNames, setReplaceNames] = useState<ReadonlySet<string>>(() => new Set())
  const [pendingDelete, setPendingDelete] = useState<SkillListEntry>()
  const [locationOpen, setLocationOpen] = useState(false)
  const [workspaceQuery, setWorkspaceQuery] = useState('')
  const [draftTarget, setDraftTarget] = useState<ImportTarget>('project-dsh')
  const [draftWorkspaceId, setDraftWorkspaceId] = useState<string>()
  const [updateState, setUpdateState] = useState<'checking' | 'ready' | 'error'>('checking')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusResponse>()
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [commandCopied, setCommandCopied] = useState(false)
  const [batchConfirmation, setBatchConfirmation] = useState<{
    readonly importing: number
    readonly replacing: number
    readonly skipped: number
  }>()
  const fileInput = useRef<HTMLInputElement>(null)

  const checkForUpdates = (): void => {
    setUpdateState('checking')
    actions.checkForUpdates().then(
      (status) => {
        setUpdateStatus(status)
        setUpdateState(status.error === undefined ? 'ready' : 'error')
      },
      () => setUpdateState('error'),
    )
  }

  useEffect(() => {
    let cancelled = false
    actions.checkForUpdates().then(
      (status) => {
        if (cancelled) return
        setUpdateStatus(status)
        setUpdateState(status.error === undefined ? 'ready' : 'error')
      },
      () => {
        if (!cancelled) setUpdateState('error')
      },
    )
    return () => { cancelled = true }
  }, [actions])

  const copyUpdateCommand = async (): Promise<void> => {
    if (updateStatus?.command === undefined) return
    await navigator.clipboard.writeText(updateStatus.command)
    setCommandCopied(true)
  }

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

  const removeSkill = async (): Promise<void> => {
    if (pendingDelete === undefined) return
    const skill = pendingDelete
    setBusy(true)
    setMessage(undefined)
    setMessageError(false)
    try {
      const removed = await actions.deleteSkill({
        name: skill.name,
        source: skill.source,
        workspacePath: skill.workspacePath,
      } satisfies DeleteRequest)
      if (removed) {
        setMessage(t('deleted'))
        setPendingDelete(undefined)
      }
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
      } else if (mode === 'url') {
        path = await actions.importUrl({
          name: effectiveUrlName,
          target,
          url: url.trim(),
          workspacePath: workspace?.path,
        })
        pollForSkill(effectiveUrlName, 10)
      } else {
        return
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

  const resetBatchPreflight = (): void => {
    setBatchScan(undefined)
    setBatchResults(undefined)
    setReplaceNames(new Set())
    setMessage(undefined)
  }

  const chooseBatchDirectory = async (): Promise<void> => {
    setBusy(true)
    setMessage(undefined)
    setMessageError(false)
    try {
      const path = await actions.pickDirectory()
      if (path === null) return
      setBatchPath(path)
      resetBatchPreflight()
    } catch (error) {
      setMessageError(true)
      setMessage(`${t('batchPickFailed')}：${String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const scanBatchDirectory = async (): Promise<void> => {
    if (batchPath === undefined) return
    setBusy(true)
    setMessage(undefined)
    setMessageError(false)
    setBatchResults(undefined)
    setReplaceNames(new Set())
    try {
      const result = await actions.scanBatch({
        sourcePath: batchPath,
        target,
        workspacePath: workspace?.path,
      })
      setBatchScan(result)
    } catch (error) {
      setBatchScan(undefined)
      setMessageError(true)
      setMessage(`${t('batchScanFailed')}：${String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const requestBatchCommit = (): void => {
    if (batchScan === undefined) return
    const ready = batchScan.entries.filter((entry) => entry.status === 'ready')
    const replacing = ready.filter((entry) => replaceNames.has(entry.name)).length
    const importing = ready.filter((entry) => !entry.conflict).length
    const skipped = ready.filter((entry) => entry.conflict && !replaceNames.has(entry.name)).length
    setBatchConfirmation({ importing, replacing, skipped })
  }

  const commitBatchDirectory = async (): Promise<void> => {
    if (batchScan === undefined || batchConfirmation === undefined) return
    setBusy(true)
    setMessage(undefined)
    setMessageError(false)
    try {
      const result = await actions.commitBatch({ scanId: batchScan.scanId, replace: [...replaceNames] })
      setBatchResults(result.results)
      setBatchScan(undefined)
      setReplaceNames(new Set())
      setBatchConfirmation(undefined)
      setListEpoch((epoch) => epoch + 1)
    } catch (error) {
      setMessageError(true)
      setMessage(`${t('batchImportFailed')}：${String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const toggleReplace = (name: string): void => {
    setReplaceNames((current) => {
      const next = new Set(current)
      if (!next.delete(name)) next.add(name)
      return next
    })
  }

  const changeTarget = (next: ImportTarget): void => {
    setTarget(next)
    if (mode === 'batch') resetBatchPreflight()
  }

  const chooseDestination = (nextTarget: ImportTarget, nextWorkspaceId?: string): void => {
    if (nextWorkspaceId !== undefined) setSelectedWorkspaceId(nextWorkspaceId)
    changeTarget(nextTarget)
    setLocationOpen(false)
  }

  const locationSummary = target === 'project-dsh'
    ? t('locationSummaryProjectDsh', { title: workspace?.title ?? '' })
    : target === 'project-agents'
      ? t('locationSummaryProjectAgents', { title: workspace?.title ?? '' })
      : target === 'user-dsh'
        ? t('locationSummaryUserDsh')
        : t('locationSummaryUserAgents')

  const filteredWorkspaces = workspaces.items.filter((item) => {
    const query = workspaceQuery.trim().toLowerCase()
    return query.length === 0 || item.title.toLowerCase().includes(query) || item.path.toLowerCase().includes(query)
  })

  const canSubmit = busy
    || (mode === 'file' && fileDraft === undefined)
    || (mode === 'url' && (url.trim().length === 0 || !/^https?:\/\//i.test(url.trim())))
    || (mode === 'batch' && batchPath === undefined)
    || (target.startsWith('project-') && workspace === undefined)

  const runPrimaryAction = (): void => {
    if (mode !== 'batch') {
      void submit()
      return
    }
    if (batchScan === undefined) void scanBatchDirectory()
    else requestBatchCommit()
  }

  const primaryLabel = mode !== 'batch'
    ? busy ? t('importing') : t('import')
    : busy ? t('batchWorking') : batchScan === undefined ? t('batchScan') : t('batchCommit')

  const flags = (skill: SkillListEntry): string | undefined => {
    if (!skill.modelInvocable && skill.userInvocable) return t('userOnly')
    if (skill.modelInvocable && !skill.userInvocable) return t('modelOnly')
    return undefined
  }

  const toggleGroup = (groupKey: string): void => {
    setExpandedGroups((current) => {
      const next = new Set(current)
      if (!next.delete(groupKey)) next.add(groupKey)
      return next
    })
  }

  const skillGroups = [
    ...workspaces.items.flatMap((item) => (['project-dsh', 'project-agents'] as const).map((source) => ({
      key: `${item.workspaceId}:${source}`,
      source,
      workspacePath: item.path,
      name: source === 'project-dsh'
        ? t('targetProjectDsh', { title: item.title })
        : t('targetProjectAgents', { title: item.title }),
    }))),
    { key: 'user-dsh', source: 'user-dsh' as const, workspacePath: undefined, name: t('targetUserDsh') },
    { key: 'user-agents', source: 'user-agents' as const, workspacePath: undefined, name: t('targetUserAgents') },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 720 }}>
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
        {listState !== 'error' && skillIssues.length > 0 ? (
          <div style={{ ...descriptionStyle, color: 'var(--dsw-alias-state-warn-label)' }}>
            {t('installedPartial', { count: skillIssues.length })} {skillIssues[0]?.message}
          </div>
        ) : null}
        {listState === 'idle' && skills.length === 0 ? (
          <div style={descriptionStyle}>{t('installedEmpty')}</div>
        ) : null}
        {skills.length > 0 ? (
          <div style={skillGroupsStyle}>
            {skillGroups.map((group) => {
              const rows = skills.filter((skill) => skill.source === group.source
                && (!group.source.startsWith('project-') || skill.workspacePath === group.workspacePath))
              if (rows.length === 0) return null
              const open = expandedGroups.has(group.key)
              return (
                <section key={group.key} style={skillGroupCardStyle}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => toggleGroup(group.key)}
                    style={{ ...skillGroupHeaderStyle, borderBottom: open ? skillGroupHeaderStyle.borderBottom : 'none' }}
                  >
                    <span style={skillGroupChevronStyle}><ChevronIcon open={open} /></span>
                    <div style={skillGroupIdentityStyle}>
                      <span style={skillGroupNameStyle}>{group.name}</span>
                    </div>
                    <span style={countBadgeStyle}>{rows.length}</span>
                  </button>
                  {open ? <ul style={skillListStyle}>
                    {rows.map((skill, index) => {
                      const flag = flags(skill)
                      return (
                        <li key={skill.source + ':' + (skill.workspacePath ?? '') + ':' + skill.name}
                          style={{ ...skillRowStyle, borderBottom: index === rows.length - 1 ? 'none' : skillRowStyle.borderBottom }}>
                          <span style={skillAvatarStyle} aria-hidden="true">{skill.name.charAt(0).toUpperCase()}</span>
                          <div style={skillContentStyle}>
                            <div style={skillNameRowStyle}>
                              <span style={skillNameStyle}>{skill.name}</span>
                              {flag !== undefined ? <span style={skillFlagStyle}>{flag}</span> : null}
                            </div>
                            <span style={skillDescriptionStyle}>{skill.description}</span>
                          </div>
                          <button
                            type="button"
                            aria-label={`${t('delete')} ${skill.name}`}
                            title={t('delete')}
                            onClick={() => setPendingDelete(skill)}
                            style={deleteIconButtonStyle}
                          >
                            <TrashIcon />
                          </button>
                        </li>
                      )
                    })}
                  </ul> : null}
                </section>
              )
            })}
          </div>
        ) : null}
      </div>

      {/* Import */}
      <div style={{ ...rowStyle, borderBottom: 'none' }}>
        <div style={rowTextStyle}>
          <div style={titleStyle}>{t('importTitle')}</div>
          <div style={descriptionStyle}>{t('importDescription')}</div>

          {/* File / URL / batch mode tabs */}
          <div role="tablist" style={entryGridStyle}>
            <button type="button" role="tab" aria-selected={mode === 'file'} onClick={() => setMode('file')}
              style={entryButtonStyle(mode === 'file')}>
              <span style={entryIconStyle}><FileIcon /></span>
              <span style={entryCopyStyle}>
                <span style={entryTitleStyle}>{t('fileTab')}</span>
                <span style={entryDescriptionStyle}>{t('fileEntryDescription')}</span>
              </span>
              {mode === 'file' ? <span style={entryCheckStyle}><CheckIcon /></span> : null}
            </button>
            <button type="button" role="tab" aria-selected={mode === 'url'} onClick={() => setMode('url')}
              style={entryButtonStyle(mode === 'url')}>
              <span style={entryIconStyle}><LinkIcon /></span>
              <span style={entryCopyStyle}>
                <span style={entryTitleStyle}>{t('urlTab')}</span>
                <span style={entryDescriptionStyle}>{t('urlEntryDescription')}</span>
              </span>
              {mode === 'url' ? <span style={entryCheckStyle}><CheckIcon /></span> : null}
            </button>
            <button type="button" role="tab" aria-selected={mode === 'batch'} onClick={() => setMode('batch')}
              style={entryButtonStyle(mode === 'batch')}>
              <span style={entryIconStyle}><BatchIcon /></span>
              <span style={entryCopyStyle}>
                <span style={entryTitleStyle}>{t('batchTab')}</span>
                <span style={entryDescriptionStyle}>{t('batchEntryDescription')}</span>
              </span>
              {mode === 'batch' ? <span style={entryCheckStyle}><CheckIcon /></span> : null}
            </button>
          </div>

          <div style={importEditorStyle}>
            {mode === 'file' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                ref={fileInput}
                type="file"
                accept=".md,.markdown,text/markdown,text/plain"
                onChange={(event) => { void onFilePicked(event.target.files?.[0]) }}
                style={hiddenInputStyle}
              />
              <button type="button" onClick={() => fileInput.current?.click()} style={filePickerStyle}>
                <span style={filePickerIconStyle}><FileIcon /></span>
                <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
                  <span style={{ fontSize: 13, lineHeight: '20px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {fileDraft?.fileName ?? t('chooseFile')}
                  </span>
                  <span style={descriptionStyle}>{fileDraft === undefined ? t('filePickerHint') : t('replaceFile')}</span>
                </span>
                <span style={secondaryButtonStyle}>{fileDraft === undefined ? t('browse') : t('change')}</span>
              </button>
              <div style={descriptionStyle}>{t('fileHelp')}</div>
              {fileError !== undefined ? (
                <div style={{ ...descriptionStyle, color: 'var(--dsw-alias-state-error-primary)' }}>{fileError}</div>
              ) : null}
              {fileDraft !== undefined ? (
                <div style={previewStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--dsw-alias-state-success-primary)' }}>
                    <CheckIcon />
                    <span style={{ fontSize: 12, fontWeight: 500 }}>{t('previewOk')}</span>
                  </div>
                  <div style={previewDividerStyle} />
                  <span><strong style={previewKeyStyle}>{t('previewName')}</strong>{fileDraft.name}</span>
                  <span><strong style={previewKeyStyle}>{t('previewDescription')}</strong>{fileDraft.description}</span>
                  {fileDraft.whenToUse !== undefined ? (
                    <span><strong style={previewKeyStyle}>{t('previewWhenToUse')}</strong>{fileDraft.whenToUse}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : mode === 'url' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>{t('urlLabel')}</span>
                <input
                  type="url"
                  value={url}
                  placeholder="https://example.com/my-skill.md"
                  onChange={(event) => setUrl(event.target.value)}
                  style={controlStyle}
                />
              </label>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>{t('urlNameLabel')}</span>
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
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button type="button" onClick={() => { void chooseBatchDirectory() }} style={filePickerStyle} disabled={busy}>
                <span style={filePickerIconStyle}><BatchIcon /></span>
                <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
                  <span style={{ fontSize: 13, lineHeight: '20px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {batchPath ?? t('batchChooseDirectory')}
                  </span>
                  <span style={descriptionStyle}>{batchPath === undefined ? t('batchDirectoryHint') : t('batchDirectorySelected')}</span>
                </span>
                <span style={secondaryButtonStyle}>{batchPath === undefined ? t('browse') : t('change')}</span>
              </button>

              {batchScan !== undefined ? (
                <div style={batchPanelStyle}>
                  <div style={batchSummaryStyle}>
                    <span>{t('batchPreflight')}</span>
                    <span style={countBadgeStyle}>{batchScan.entries.length}</span>
                  </div>
                  <ul style={batchListStyle}>
                    {batchScan.entries.map((entry, index) => (
                      <li key={entry.id} style={{ ...batchRowStyle, borderBottom: index === batchScan.entries.length - 1 ? 'none' : batchRowStyle.borderBottom }}>
                        <span style={{ ...batchStatusDotStyle, background: entry.status === 'error' ? 'var(--dsw-alias-state-error-primary)' : entry.conflict ? 'var(--dsw-alias-state-warn-label)' : 'var(--dsw-alias-state-success-primary)' }} />
                        <div style={skillContentStyle}>
                          <div style={skillNameRowStyle}>
                            <span style={skillNameStyle}>{entry.name}</span>
                            {entry.conflict && entry.status === 'ready' ? <span style={batchConflictTagStyle}>{t('batchConflict')}</span> : null}
                          </div>
                          <span style={skillDescriptionStyle}>{entry.error ?? entry.description ?? entry.relativePath}</span>
                          {entry.warnings?.map((warning) => <span key={warning} style={batchWarningStyle}>{warning}</span>)}
                        </div>
                        {entry.conflict && entry.status === 'ready' ? (
                          <label style={replaceLabelStyle}>
                            <input type="checkbox" checked={replaceNames.has(entry.name)} onChange={() => toggleReplace(entry.name)} />
                            <span>{t('batchReplace')}</span>
                          </label>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {batchResults !== undefined ? (
                <div style={batchPanelStyle}>
                  <div style={batchSummaryStyle}>
                    <span>{t('batchResultTitle')}</span>
                    <span style={descriptionStyle}>{t('batchResultSummary', {
                      imported: batchResults.filter((entry) => entry.status === 'imported').length,
                      replaced: batchResults.filter((entry) => entry.status === 'replaced').length,
                      skipped: batchResults.filter((entry) => entry.status === 'skipped').length,
                      failed: batchResults.filter((entry) => entry.status === 'error').length,
                    })}</span>
                  </div>
                  <ul style={batchListStyle}>
                    {batchResults.map((entry, index) => (
                      <li key={`${entry.status}:${entry.name}:${index}`} style={{ ...batchResultRowStyle, borderBottom: index === batchResults.length - 1 ? 'none' : batchResultRowStyle.borderBottom }}>
                        <span style={{ ...batchResultBadgeStyle, color: entry.status === 'error' ? 'var(--dsw-alias-state-error-primary)' : entry.status === 'skipped' ? 'var(--dsw-alias-state-warn-label)' : 'var(--dsw-alias-state-success-primary)' }}>
                          {t(entry.status === 'imported' ? 'batchStatusImported' : entry.status === 'replaced' ? 'batchStatusReplaced' : entry.status === 'skipped' ? 'batchStatusSkipped' : 'batchStatusError')}
                        </span>
                        <div style={skillContentStyle}>
                          <span style={skillNameStyle}>{entry.name}</span>
                          {entry.message !== undefined ? <span style={skillDescriptionStyle}>{entry.message}</span> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}

          {/* Target directory */}
          <div style={editorDividerStyle} />
          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>{t('targetLabel')}</span>
            <button type="button" onClick={() => { setWorkspaceQuery(''); setDraftTarget(target); setDraftWorkspaceId(selectedWorkspaceId); setLocationOpen(true) }} style={locationSummaryStyle}>
              <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{locationSummary}</span>
              <span style={secondaryButtonStyle}>{t('locationChange')}</span>
            </button>
            {workspace === undefined ? (
              <span style={descriptionStyle}>{t('noWorkspace')}</span>
            ) : null}
          </label>

          {/* Action */}
          <div style={actionStyle}>
            {message !== undefined ? (
              <span style={{ flex: 1, fontSize: 12, lineHeight: '18px', color: messageError ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)', wordBreak: 'break-all' }}>
                {message}
              </span>
            ) : <span style={{ flex: 1 }} />}
            <button type="button" disabled={canSubmit} onClick={runPrimaryAction} style={canSubmit ? primaryDisabledStyle : primaryStyle}>
              {primaryLabel}
            </button>
          </div>
          </div>
        </div>
      </div>
      <div style={versionFooterStyle}>
        <div style={versionCopyStyle}>
          <span style={versionLabelStyle}>
            {updateStatus === undefined
              ? t('versionChecking')
              : t('versionCurrent', { version: updateStatus.currentVersion })}
          </span>
          <span style={descriptionStyle}>
            {updateState === 'checking'
              ? t('versionChecking')
              : updateState === 'error'
                ? t('versionCheckFailed')
                : updateStatus?.updateAvailable === true
                  ? t('versionAvailable', { version: updateStatus.latestVersion ?? '' })
                  : t('versionLatest')}
          </span>
        </div>
        {updateState === 'error' ? (
          <button type="button" onClick={checkForUpdates} style={pillStyle}>{t('versionRetry')}</button>
        ) : updateStatus?.updateAvailable === true ? (
          <button type="button" onClick={() => { setCommandCopied(false); setUpdateDialogOpen(true) }} style={updateButtonStyle}>
            {t('versionUpdate')}
          </button>
        ) : null}
      </div>
      <Modal
        open={locationOpen}
        onClose={() => setLocationOpen(false)}
        title={t('locationTitle')}
        closeLabel={t('close')}
        footer={<Button variant="outline" onClick={() => setLocationOpen(false)}>{t('cancel')}</Button>}
      >
        <div style={locationPanelStyle}>
          <div style={locationScopeStyle}>
            <button type="button" onClick={() => { if (!draftTarget.startsWith('project-')) setDraftTarget('project-dsh') }} style={{ ...locationScopeButtonStyle, ...(draftTarget.startsWith('project-') ? locationScopeButtonActiveStyle : {}) }}>{t('locationProject')}</button>
            <button type="button" onClick={() => { if (draftTarget.startsWith('project-')) setDraftTarget('user-dsh') }} style={{ ...locationScopeButtonStyle, ...(!draftTarget.startsWith('project-') ? locationScopeButtonActiveStyle : {}) }}>{t('locationGlobal')}</button>
          </div>
          {draftTarget.startsWith('project-') ? (
            <>
              <input type="search" value={workspaceQuery} onChange={(event) => setWorkspaceQuery(event.target.value)} placeholder={t('workspaceSearch')} style={controlStyle} />
              <div style={locationWorkspaceListStyle}>
                {filteredWorkspaces.map((item) => {
                  const selected = item.workspaceId === draftWorkspaceId
                  return (
                    <div key={item.workspaceId} style={{ ...locationWorkspaceGroupStyle, ...(selected ? locationWorkspaceActiveStyle : {}) }}>
                      <button
                        type="button"
                        onClick={(event) => {
                          const group = event.currentTarget.parentElement
                          setDraftWorkspaceId(selected ? undefined : item.workspaceId)
                          if (!selected) window.requestAnimationFrame(() => group?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
                        }}
                        style={locationWorkspaceStyle}
                        aria-expanded={selected}
                      >
                        <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={skillNameStyle}>{item.title}</span>
                          <span style={skillDescriptionStyle}>{item.path}</span>
                        </span>
                        <span style={skillGroupChevronStyle}><ChevronIcon open={selected} /></span>
                      </button>
                      {selected ? (
                        <div style={locationExpandedRootsStyle}>
                          <span style={locationRootHintStyle}>{t('chooseRootHint')}</span>
                          <button type="button" onClick={() => chooseDestination('project-dsh', item.workspaceId)} style={locationOptionStyle}>
                            <span style={locationOptionCopyStyle}><strong>{t('rootProjectDsh')}</strong><small style={descriptionStyle}>.dsh/skills</small></span>
                            <span style={priorityHighStyle}>{t('priorityHighest')}</span>
                          </button>
                          <button type="button" onClick={() => chooseDestination('project-agents', item.workspaceId)} style={locationOptionStyle}>
                            <span style={locationOptionCopyStyle}><strong>{t('rootProjectAgents')}</strong><small style={descriptionStyle}>.agents/skills</small></span>
                            <span style={priorityMediumStyle}>{t('priorityHigher')}</span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                {filteredWorkspaces.length === 0 ? <div style={descriptionStyle}>{t('workspaceNoMatch')}</div> : null}
              </div>
            </>
          ) : (
            <div style={locationRootsStyle}>
              <button type="button" onClick={() => chooseDestination('user-dsh')} style={locationOptionStyle}>
                <span style={locationOptionCopyStyle}><strong>{t('rootUserDsh')}</strong><small style={descriptionStyle}>~/.dsh/skills</small></span>
                <span style={priorityLowStyle}>{t('priorityLower')}</span>
              </button>
              <button type="button" onClick={() => chooseDestination('user-agents')} style={locationOptionStyle}>
                <span style={locationOptionCopyStyle}><strong>{t('rootUserAgents')}</strong><small style={descriptionStyle}>~/.agents/skills</small></span>
                <span style={priorityLowStyle}>{t('priorityLowest')}</span>
              </button>
            </div>
          )}
        </div>
      </Modal>
      <Modal
        open={pendingDelete !== undefined}
        onClose={() => { if (!busy) setPendingDelete(undefined) }}
        title={t('deleteTitle')}
        closeLabel={t('close')}
        description={pendingDelete === undefined ? undefined : t('deleteConfirm', { name: pendingDelete.name })}
        footer={(
          <>
            <Button variant="outline" disabled={busy} onClick={() => setPendingDelete(undefined)}>{t('cancel')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => { void removeSkill() }}>
              {busy ? t('deleting') : t('delete')}
            </Button>
          </>
        )}
      />
      <Modal
        open={batchConfirmation !== undefined}
        onClose={() => { if (!busy) setBatchConfirmation(undefined) }}
        title={t('batchConfirmTitle')}
        closeLabel={t('close')}
        description={batchConfirmation === undefined ? undefined : t('batchConfirm', batchConfirmation)}
        footer={(
          <>
            <Button variant="outline" disabled={busy} onClick={() => setBatchConfirmation(undefined)}>{t('cancel')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => { void commitBatchDirectory() }}>
              {busy ? t('batchWorking') : t('batchCommit')}
            </Button>
          </>
        )}
      />
      <Modal
        open={updateDialogOpen}
        onClose={() => setUpdateDialogOpen(false)}
        title={t('updateTitle')}
        closeLabel={t('close')}
        description={t('updateDescription')}
        footer={(
          <>
            <Button variant="outline" onClick={() => setUpdateDialogOpen(false)}>{t('cancel')}</Button>
            <Button variant="primary" onClick={() => { void copyUpdateCommand() }}>
              {commandCopied ? t('commandCopied') : t('copyCommand')}
            </Button>
          </>
        )}
      >
        <div style={updateDialogBodyStyle}>
          <code style={updateCommandStyle}>{updateStatus?.command}</code>
          <div style={descriptionStyle}>{t('restartHint')}</div>
        </div>
      </Modal>
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

const versionFooterStyle: CSSProperties = {
  minHeight: 58,
  padding: '12px 0',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  borderTop: '1px solid var(--dsw-alias-border-l2)',
}

const versionCopyStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}

const versionLabelStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: '18px',
  fontWeight: 500,
  color: 'var(--dsw-alias-label-secondary)',
}

const updateButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 28,
  padding: '0 12px',
  border: '1px solid var(--dsw-alias-interactive-border-primary)',
  borderRadius: 14,
  background: 'transparent',
  font: 'inherit',
  fontSize: 13,
  borderColor: 'var(--dsw-alias-interactive-border-primary)',
  color: 'var(--dsw-alias-interactive-label-primary)',
  cursor: 'pointer',
}

const updateDialogBodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

const updateCommandStyle: CSSProperties = {
  display: 'block',
  padding: '10px 12px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 12,
  lineHeight: '18px',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
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

const skillGroupsStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  marginTop: 4,
}

const skillGroupCardStyle: CSSProperties = {
  overflow: 'hidden',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  background: 'transparent',
}

const skillGroupHeaderStyle: CSSProperties = {
  width: '100%',
  minHeight: 42,
  padding: '7px 12px',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
  borderTop: 'none',
  borderRight: 'none',
  borderLeft: 'none',
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
}

const skillGroupChevronStyle: CSSProperties = {
  flex: 'none',
  width: 18,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--dsw-alias-label-caption)',
}

const skillGroupIdentityStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  flexWrap: 'wrap',
}

const skillGroupNameStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: '20px',
  fontWeight: 500,
  color: 'var(--dsw-alias-label-primary)',
}

const countBadgeStyle: CSSProperties = {
  flex: 'none',
  minWidth: 22,
  height: 20,
  padding: '0 6px',
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 10,
  background: 'var(--dsw-alias-interactive-bg-hover)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 11,
  lineHeight: '16px',
}

const skillListStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: '0 12px',
  display: 'flex',
  flexDirection: 'column',
}

const skillRowStyle: CSSProperties = {
  minHeight: 62,
  padding: '9px 0',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}

const skillAvatarStyle: CSSProperties = {
  flex: 'none',
  width: 32,
  height: 32,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 13,
  lineHeight: '20px',
  fontWeight: 600,
}

const skillContentStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}

const skillNameRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }
const skillNameStyle: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, lineHeight: '20px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }
const skillDescriptionStyle: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }
const skillFlagStyle: CSSProperties = { flex: 'none', padding: '1px 6px', border: '1px solid var(--dsw-alias-border-l3)', borderRadius: 4, fontSize: 10, lineHeight: '14px', color: 'var(--dsw-alias-label-secondary)' }

const deleteIconButtonStyle: CSSProperties = {
  flex: 'none',
  width: 28,
  height: 28,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 14,
  background: 'transparent',
  color: 'var(--dsw-alias-label-caption)',
  cursor: 'pointer',
}

const controlStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  height: 36,
  padding: '0 12px',
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)',
  font: 'inherit',
  fontSize: 13,
  lineHeight: '20px',
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

const entryGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 10,
  marginTop: 12,
}

const entryButtonStyle = (active: boolean): CSSProperties => ({
  boxSizing: 'border-box',
  position: 'relative',
  minWidth: 0,
  minHeight: 68,
  padding: '11px 12px',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  border: `1px ${active ? 'solid' : 'dashed'} ${active ? 'var(--dsw-alias-border-l3)' : 'var(--dsw-alias-border-l2)'}`,
  borderRadius: 12,
  background: active ? 'var(--dsw-alias-bg-module-platform)' : 'transparent',
  color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
  font: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
})

const entryIconStyle: CSSProperties = {
  flex: 'none',
  width: 34,
  height: 34,
  borderRadius: 10,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--dsw-alias-interactive-bg-hover)',
  color: 'var(--dsw-alias-label-secondary)',
}

const entryCopyStyle: CSSProperties = { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }
const entryTitleStyle: CSSProperties = { fontSize: 13, lineHeight: '20px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }
const entryDescriptionStyle: CSSProperties = { fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' }
const entryCheckStyle: CSSProperties = { position: 'absolute', top: 8, right: 8, color: 'var(--dsw-alias-state-success-primary)' }

const importEditorStyle: CSSProperties = {
  marginTop: 10,
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-module-platform)',
}

const hiddenInputStyle: CSSProperties = { display: 'none' }

const filePickerStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  minHeight: 62,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '9px 10px',
  border: '1px dashed var(--dsw-alias-border-l3)',
  borderRadius: 10,
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)',
  font: 'inherit',
  cursor: 'pointer',
}

const filePickerIconStyle: CSSProperties = { ...entryIconStyle, width: 36, height: 36 }

const secondaryButtonStyle: CSSProperties = {
  flex: 'none',
  boxSizing: 'border-box',
  height: 28,
  padding: '0 10px',
  display: 'inline-flex',
  alignItems: 'center',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 14,
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 12,
  lineHeight: '18px',
}

const locationSummaryStyle: CSSProperties = {
  ...controlStyle,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  cursor: 'pointer',
}
const locationPanelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }
const locationScopeStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: 4, borderRadius: 10, background: 'var(--dsw-alias-bg-module-platform)' }
const locationScopeButtonStyle: CSSProperties = { border: 'none', borderRadius: 7, padding: '8px 12px', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', fontWeight: 500 }
const locationScopeButtonActiveStyle: CSSProperties = { background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', boxShadow: '0 1px 3px rgba(0,0,0,.08)' }
const locationWorkspaceListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  maxHeight: 'min(440px, 52vh)',
  overflowY: 'auto',
  scrollPadding: '8px 0',
}
const locationWorkspaceGroupStyle: CSSProperties = { overflow: 'hidden', borderRadius: 10, transition: 'background 140ms ease' }
const locationWorkspaceStyle: CSSProperties = { width: '100%', display: 'flex', alignItems: 'center', gap: 8, border: 'none', borderRadius: 8, padding: '9px 10px', background: 'transparent', cursor: 'pointer', textAlign: 'left' }
const locationWorkspaceActiveStyle: CSSProperties = { background: 'var(--dsw-alias-bg-module-platform)' }
const locationExpandedRootsStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 10px 10px 18px' }
const locationRootHintStyle: CSSProperties = { fontSize: 11, lineHeight: '16px', fontWeight: 500, color: 'var(--dsw-alias-label-tertiary)' }
const locationRootsStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 }
const locationOptionStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, width: '100%', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10, padding: '10px 12px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', textAlign: 'left' }
const locationOptionCopyStyle: CSSProperties = { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }
const priorityBaseStyle: CSSProperties = { flex: 'none', borderRadius: 999, padding: '2px 7px', fontSize: 11, lineHeight: '16px', fontWeight: 600 }
const priorityHighStyle: CSSProperties = { ...priorityBaseStyle, color: 'var(--dsw-alias-state-success-primary)', background: 'var(--dsw-alias-bg-module-platform)' }
const priorityMediumStyle: CSSProperties = { ...priorityBaseStyle, color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-module-platform)' }
const priorityLowStyle: CSSProperties = { ...priorityBaseStyle, color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-module-platform)' }

const previewStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  padding: '10px 12px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  lineHeight: '18px',
}

const previewDividerStyle: CSSProperties = { height: 1, margin: '2px 0', background: 'var(--dsw-alias-border-l2)' }
const previewKeyStyle: CSSProperties = { display: 'inline-block', minWidth: 70, marginRight: 8, color: 'var(--dsw-alias-label-tertiary)', fontWeight: 500 }
const editorDividerStyle: CSSProperties = { height: 1, background: 'var(--dsw-alias-border-l2)' }
const fieldStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }
const fieldLabelStyle: CSSProperties = { fontSize: 12, lineHeight: '18px', fontWeight: 500, color: 'var(--dsw-alias-label-secondary)' }
const actionStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }

const batchPanelStyle: CSSProperties = {
  overflow: 'hidden',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-layer-1)',
}

const batchSummaryStyle: CSSProperties = {
  minHeight: 38,
  boxSizing: 'border-box',
  padding: '7px 10px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
  fontSize: 12,
  lineHeight: '18px',
  fontWeight: 500,
  color: 'var(--dsw-alias-label-primary)',
}

const batchListStyle: CSSProperties = { listStyle: 'none', margin: 0, padding: '0 10px', display: 'flex', flexDirection: 'column', maxHeight: 320, overflowY: 'auto' }
const batchRowStyle: CSSProperties = { minHeight: 58, padding: '8px 0', display: 'flex', alignItems: 'center', gap: 9, borderBottom: '1px solid var(--dsw-alias-border-l2)' }
const batchResultRowStyle: CSSProperties = { minHeight: 48, padding: '7px 0', display: 'flex', alignItems: 'center', gap: 9, borderBottom: '1px solid var(--dsw-alias-border-l2)' }
const batchStatusDotStyle: CSSProperties = { flex: 'none', width: 8, height: 8, borderRadius: '50%' }
const batchConflictTagStyle: CSSProperties = { flex: 'none', padding: '1px 6px', borderRadius: 4, border: '1px solid var(--dsw-alias-state-warn-label)', color: 'var(--dsw-alias-state-warn-label)', fontSize: 10, lineHeight: '14px' }
const batchWarningStyle: CSSProperties = { fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-state-warn-label)' }
const replaceLabelStyle: CSSProperties = { flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' }
const batchResultBadgeStyle: CSSProperties = { flex: 'none', minWidth: 42, fontSize: 11, lineHeight: '16px', fontWeight: 500 }

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

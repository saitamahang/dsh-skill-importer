/**
 * Skill importer plugin, browser half: a Settings section for importing
 * skills from local Markdown files or URLs — directly, no agent involved.
 *
 * The host half registers `/skill-importer/*` routes on the harness's own
 * web server (same origin). This half fetches those routes: the file text
 * is read in the browser, posted to `/skill-importer/import`, and the host
 * writes `<name>/SKILL.md` into the chosen skill root with its own
 * filesystem access. The skill-filesystem provider's watcher then discovers
 * the file and hot-refreshes the catalog (`skills/change`), so the `/`
 * menu, the model catalog, and this page's list all pick it up without a
 * restart.
 */
// Type-only: the settings slot contract, the locale plugin's Context merge,
// the conversation composer's slot contracts (tool-row slots + the
// useInput/inputActions session kit), and the client command-UI contract
// (ctx.commandUi for the /skills popupSelect command).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { InputTriggerServiceContract } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { CommandUiContract } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { SkillImporterSection } from './SkillImporterSection.tsx'
import type { SkillImporterProps } from './SkillImporterSection.tsx'
import { SkillsPicker } from './SkillsPicker.tsx'
import type { SkillsPickerProps } from './SkillsPicker.tsx'
import { effectiveSkills } from './effectiveSkills.ts'
import { requestComposerFocus } from './composerFocus.ts'
import { en, NS, zh, type SkillImporterKey } from './locales.ts'
import type {
  BatchCommitRequest, BatchCommitResponse, BatchScanRequest, BatchScanResponse,
  DeleteRequest, ErrorResponse, ImportRequest, ImportResponse, ImportUrlRequest, SkillListResponse,
  UpdateStatusResponse,
} from '../types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The skill importer section's copy. */
    'skills.importer': SkillImporterKey
  }
}

/** Installed skill catalog snapshot used by the all-workspace settings view. */
export type SkillCatalogSnapshot = SkillListResponse["skills"]
export type SkillIssueSnapshot = SkillListResponse["issues"]

/** Registration-side business face for the section. */
export interface SkillImporterInjected {
  hooks: {
    /** Last successful `/skill-importer/list` result. */
    skills: HostObservable<SkillCatalogSnapshot>
    /** Non-fatal filesystem failures from the last catalog refresh. */
    skillIssues: HostObservable<SkillIssueSnapshot>
  }
  actions: {
    /** Re-fetch the installed catalog; resolves to the fresh rows. */
    refreshSkills: (workspacePath?: string) => Promise<SkillCatalogSnapshot>
    /** Load the effective catalog for one conversation without mutating the settings catalog. */
    refreshSkillsForSession: (sessionId: SessionId) => Promise<SkillCatalogSnapshot>
    /** Write one skill file via the host route; resolves to the written path. */
    importSkill: (request: ImportRequest) => Promise<string>
    /** Fetch a URL and write the skill via the host route; resolves to the written path. */
    importUrl: (request: ImportUrlRequest) => Promise<string>
    /** Delete one installed skill copy via the host route. */
    deleteSkill: (request: DeleteRequest) => Promise<boolean>
    /** Open dsh's native host directory chooser. */
    pickDirectory: () => Promise<string | null>
    /** Validate one local skills root without writing. */
    scanBatch: (request: BatchScanRequest) => Promise<BatchScanResponse>
    /** Commit one preflight once, replacing only explicitly confirmed names. */
    commitBatch: (request: BatchCommitRequest) => Promise<BatchCommitResponse>
    /** Return the installed version and the latest npm version when reachable. */
    checkForUpdates: () => Promise<UpdateStatusResponse>
  }
}

/** Every client service used during apply is explicit; alpha DSH no longer tolerates load-order access. */
export const inject = [
  'slots',
  'locale',
  'connection',
  'remote',
  'remote.skills',
  'remote.directoryPicker',
  'inputTriggers',
  'commandUi',
  'sessions',
  'conversation',
]

type CompatSkillApi = {
  list: (...args: unknown[]) => Promise<unknown>
}

type CompatRemote = {
  skills?: CompatSkillApi
  directoryPicker?: {
    pick: () => Promise<
      | { ok: true; value: string | null }
      | { ok: false; error: { message: string } }
    >
  }
}

type CompatLegacyApi = {
  skills?: CompatSkillApi
  host?: {
    pickDirectory: (request: Record<string, never>) => Promise<{
      result:
        | { ok: true; value: { path: string | null } }
        | { ok: false; error: { message: string } }
    }>
  }
}

const popupEscapeHandlers = new WeakMap<HTMLInputElement, (event: KeyboardEvent) => void>()

/** Restore keyboard ownership when DSH opens this plugin's popup from the composer. */
function focusSkillsPopupSearch(options: { onEscape: () => void; resetActive: () => void }): void {
  const focus = (): void => {
    for (const input of document.querySelectorAll<HTMLInputElement>('input[type="text"]')) {
      let node: HTMLElement | null = input
      while (node !== null) {
        if ((node.getAttribute('aria-label') ?? '').toLowerCase().includes('skills')) {
          const previous = popupEscapeHandlers.get(input)
          if (previous !== undefined) input.removeEventListener('keydown', previous)
          const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape') return
            // The official popup dismisses during bubbling. Restore composer
            // focus afterwards because its private focus hook is not reliable
            // for a third-party popup contribution in this alpha release.
            window.setTimeout(options.onEscape, 0)
          }
          popupEscapeHandlers.set(input, onKeyDown)
          input.addEventListener('keydown', onKeyDown)
          input.focus({ preventScroll: true })
          // A stationary pointer can fire row mouse-enter as the overlay mounts
          // and replace the controller's initial index 0. Reassert index 0 after
          // the ready render; later real pointer movement still works normally.
          options.resetActive()
          return
        }
        node = node.parentElement
      }
    }
  }
  // Opening the shell and resolving its async rows are separate React commits.
  // Run after both so the composer's Enter transaction cannot steal focus back.
  window.requestAnimationFrame(focus)
  window.setTimeout(focus, 0)
}

/** Same-origin route literals (mirrors the host half's ROUTES). */
const ROUTES = {
  list: '/skill-importer/list',
  import: '/skill-importer/import',
  importUrl: '/skill-importer/import-url',
  delete: '/skill-importer/delete',
  batchScan: '/skill-importer/batch/scan',
  batchCommit: '/skill-importer/batch/commit',
  updateStatus: '/skill-importer/update-status',
} as const

/** Fetch one route and unwrap the JSON envelope; throws on transport/HTTP errors. */
async function call<T extends { ok: boolean }>(path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
  } catch (error) {
    throw new Error(`无法连接 dsh 服务（${path}）：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    let detail = ''
    try {
      const parsed = await response.json() as ErrorResponse
      detail = parsed.error ?? ''
    } catch {
      // Non-JSON failure body; keep the generic message.
    }
    throw new Error(`dsh 服务返回 ${response.status}${detail ? `：${detail}` : ''}`)
  }
  return await response.json() as T
}

/**
 * Client plugin body: register the section and its dictionaries.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-skill-importer: dictionaries')
  const t = ctx.locale.bind(NS)
  const sourceLabel = (source: SkillCatalogSnapshot[number]['source']): string =>
    source === 'project-dsh' ? t('pickerSourceProjectDsh')
      : source === 'project-agents' ? t('pickerSourceProjectAgents')
        : source === 'user-dsh' ? t('pickerSourceUserDsh')
          : t('pickerSourceUserAgents')

  // Plugin-closure state: last-good catalog plus its listeners. The array is
  // replaced immutably on refresh so getSnapshot stays stable between
  // refreshes (the inject hooks contract).
  let catalog: SkillCatalogSnapshot = []
  let issues: SkillIssueSnapshot = []
  const sessionCatalogs = new Map<SessionId, SkillCatalogSnapshot>()
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        // Contain listener failures: one faulty consumer must not starve others.
        console.error('[dsh-skill-importer] listener failed:', error)
      }
    }
  }

  // The native `/` skill group is deliberately absent: skills are picked via
  // the composer tool-row dropdown or the `/skills` popupSelect command, so
  // the group the official ui-skill plugin serves is hidden. Its per-session
  // catalog is cached, and a failed fetch is dropped silently without being
  // cached, so rejecting the call hides the group for good (the lexicon
  // contribution below still powers `/name` highlighting).
  const connection = ctx.get('connection') as ConnectionHandle
  const legacyApi = (connection as unknown as { api?: CompatLegacyApi }).api
  const remote = (ctx as unknown as { remote?: CompatRemote }).remote
    ?? ctx.get('remote') as CompatRemote | undefined
  const skillsApi = remote?.skills ?? legacyApi?.skills
  if (skillsApi !== undefined) {
    skillsApi.list = () => Promise.reject(new Error('skill group hidden: use the composer skill picker or /skills'))
  }

  // Text-reference lexicon: keeps `/name` highlighting working in every mode.
  // ui-skill's own lexicon dies in picker mode (its skill.list fetch fails),
  // so we contribute the names ourselves through a hidden source whose
  // candidates always reject — a failed candidates call drops the menu group
  // silently (never a visible empty row), while its lexicon roll still feeds
  // the composer's `/name` text-ref decoration, matching native typing.
  const usableNames = (): string[] => [...new Set(
    [...sessionCatalogs.values()].flat().filter((skill) => skill.userInvocable).map((skill) => skill.name),
  )]
  ctx.effect(() => {
    const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
    const unregister = inputTriggers.registerSource({
      trigger: '/',
      name: 'skill-importer',
      order: 99,
      async candidates() {
        throw new Error('skill group hidden: use the composer skill picker')
      },
      // Unreachable (candidates always reject, so no pick can be routed here);
      // required by the source contract.
      onPick() {
        return undefined
      },
      warm() {},
      lexicon() {
        return usableNames()
      },
      subscribeLexicon(_session, listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    })
    return unregister
  }, 'dsh-skill-importer: lexicon source')

  // The `/skills` popupSelect command, modelled on the `/model` entry: pick
  // it from the slash menu (or type `/skills`) and a popup lists the skills;
  // selecting one prefixes the draft with `/name ` — the native text gesture
  // (highlighted via the lexicon contribution above), exactly like a pick
  // from the composer tool-row dropdown.
  const commandUi = ctx.get('commandUi') as CommandUiContract
  const sessions = ctx.get('sessions') as unknown as ISessions
  if (commandUi !== undefined && sessions !== undefined) {
    ctx.effect(() => {
      const unregister = commandUi.register({
        name: 'skills',
        description: t('commandDescription'),
        available: () => true,
        ui: {
          kind: 'popupSelect',
          async options(session, _signal) {
            const rows = await refreshSkillsForSession(session.sessionId)
            const restoreComposerFocus = (): void => {
              const actx = sessions.scope(session.sessionId)
              if (actx === undefined) return
              const conversation = actx.get('conversation')
              if (conversation === undefined) return
              const draft = conversation.input.for(actx).state.getSnapshot().draft
              requestComposerFocus({
                sessionId: session.sessionId,
                expectedDraft: draft,
                caret: draft.length,
              })
            }
            const resetActive = (): void => {
              const actx = sessions.scope(session.sessionId)
              if (actx === undefined) return
              const popup = commandUi.popupFor(actx) as { highlight?: (index: number) => void }
              popup.highlight?.(0)
            }
            focusSkillsPopupSearch({ onEscape: restoreComposerFocus, resetActive })
            return rows
              .filter((skill) => skill.userInvocable)
              .map((skill) => ({ id: skill.name, label: `${skill.name} · ${sourceLabel(skill.source)}` }))
          },
          onSelect(option, session) {
            const actx = sessions.scope(session.sessionId)
            if (actx === undefined) throw new Error('this session is no longer available')
            const conversation = actx.get('conversation')
            if (conversation === undefined) throw new Error('conversation input is unavailable')
            const input = conversation.input.for(actx)
            // The popup was opened from a leading command token, which may be
            // the full `/skills` (typed + enter) or a prefix the menu matched
            // (`/s`, `/sk`, ...). Drop the leading `/word` token so the draft
            // becomes `/name ` — never `/name /s`. Text after the token
            // (the command's own argument, if any) is preserved.
            const rest = input.state.getSnapshot().draft.replace(/^\s*\/[a-zA-Z][a-zA-Z0-9-]*\s*/, '')
            const prefix = `/${option.id} `
            const nextDraft = `${prefix}${rest}`
            // popupSelect consumes the open-time `/sk…` token after onSelect
            // settles. Defer our replacement until that native transaction has
            // closed, otherwise the token CAS and this whole-draft write race.
            window.setTimeout(() => {
              const liveScope = sessions.scope(session.sessionId)
              if (liveScope === undefined) return
              const liveConversation = liveScope.get('conversation')
              if (liveConversation === undefined) return
              liveConversation.input.for(liveScope).setDraft(nextDraft)
              requestComposerFocus({
                sessionId: session.sessionId,
                expectedDraft: nextDraft,
                caret: prefix.length,
              })
            }, 0)
          },
        },
      })
      return unregister
    }, 'dsh-skill-importer: /skills popupSelect command')
  }

  const refreshSkills = async (workspacePath?: string): Promise<SkillCatalogSnapshot> => {
    const path = workspacePath === undefined
      ? ROUTES.list
      : `${ROUTES.list}?workspacePath=${encodeURIComponent(workspacePath)}`
    const result = await call<SkillListResponse>(path)
    catalog = result.skills
    issues = result.issues
    notify()
    return catalog
  }

  const refreshSkillsForSession = async (sessionId: SessionId): Promise<SkillCatalogSnapshot> => {
    const cwd = sessions.list.getSnapshot().byId[sessionId]?.cwd
    const path = cwd === undefined
      ? `${ROUTES.list}?scope=global`
      : `${ROUTES.list}?workspacePath=${encodeURIComponent(cwd)}`
    const result = await call<SkillListResponse>(path)
    const effective = effectiveSkills(result.skills)
    sessionCatalogs.set(sessionId, effective)
    notify()
    return effective
  }

  const importSkill = async (request: ImportRequest): Promise<string> => {
    const result = await call<ImportResponse>(ROUTES.import, request)
    return result.path
  }

  const importUrl = async (request: ImportUrlRequest): Promise<string> => {
    const result = await call<ImportResponse>(ROUTES.importUrl, request)
    return result.path
  }

  const deleteSkill = async (request: DeleteRequest): Promise<boolean> => {
    const result = await call<{ ok: true; removed: boolean }>(ROUTES.delete, request)
    return result.removed
  }

  const pickDirectory = async (): Promise<string | null> => {
    if (remote?.directoryPicker !== undefined) {
      const result = await remote.directoryPicker.pick()
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
    if (legacyApi?.host === undefined) throw new Error('当前 DSH 未提供目录选择能力')
    const response = await legacyApi.host.pickDirectory({})
    if (!response.result.ok) throw new Error(response.result.error.message)
    return response.result.value.path
  }

  const scanBatch = (request: BatchScanRequest): Promise<BatchScanResponse> =>
    call<BatchScanResponse>(ROUTES.batchScan, request)

  const commitBatch = (request: BatchCommitRequest): Promise<BatchCommitResponse> =>
    call<BatchCommitResponse>(ROUTES.batchCommit, request)

  const checkForUpdates = (): Promise<UpdateStatusResponse> =>
    call<UpdateStatusResponse>(ROUTES.updateStatus)

  const face = (): SkillImporterInjected => ({
    hooks: {
      skills: {
        getSnapshot: () => catalog,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      },
      skillIssues: {
        getSnapshot: () => issues,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    },
    actions: {
      refreshSkills,
      refreshSkillsForSession,
      importSkill,
      importUrl,
      deleteSkill,
      pickDirectory,
      scanBatch,
      commitBatch,
      checkForUpdates,
    },
  })

  // The section rides the settings shell's own navigation; the shell renders
  // the label, this registrant owns the page content.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skills',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: face,
    children: {},
  }, SkillImporterSection))

  // The composer picker: a compact tool-row dropdown right after the
  // resident chrome (access mode, plan, attach) — `conversation.input.left`.
  // Picker display mode only; renders null otherwise. Session-scoped, so it
  // appears per open session and reads the input machine through the
  // framework-provided kit.
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'skills-picker',
    order: 10,
    locale: NS,
    inject: face,
    children: {},
  }, SkillsPicker))
}

export type { SkillImporterProps, SkillsPickerProps }

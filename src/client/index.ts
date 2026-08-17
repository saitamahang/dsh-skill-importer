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
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { InputTriggerServiceContract } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { CommandUiContract } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { SkillImporterSection } from './SkillImporterSection.tsx'
import type { SkillImporterProps } from './SkillImporterSection.tsx'
import { SkillsPicker } from './SkillsPicker.tsx'
import type { SkillsPickerProps } from './SkillsPicker.tsx'
import { requestComposerFocus } from './composerFocus.ts'
import { en, NS, zh, type SkillImporterKey } from './locales.ts'
import type {
  BatchCommitRequest, BatchCommitResponse, BatchScanRequest, BatchScanResponse,
  DeleteRequest, ErrorResponse, ImportRequest, ImportResponse, ImportUrlRequest, SkillListResponse,
} from '../types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The skill importer section's copy. */
    'skills.importer': SkillImporterKey
  }
}

/** Installed skill catalog snapshot (global — not per-session anymore). */
export type SkillCatalogSnapshot = SkillListResponse["skills"]

/** Registration-side business face for the section. */
export interface SkillImporterInjected {
  hooks: {
    /** Last successful `/skill-importer/list` result. */
    skills: HostObservable<SkillCatalogSnapshot>
  }
  actions: {
    /** Re-fetch the installed catalog; resolves to the fresh rows. */
    refreshSkills: () => Promise<SkillCatalogSnapshot>
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
  }
}

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection']

/** Same-origin route literals (mirrors the host half's ROUTES). */
const ROUTES = {
  list: '/skill-importer/list',
  import: '/skill-importer/import',
  importUrl: '/skill-importer/import-url',
  delete: '/skill-importer/delete',
  batchScan: '/skill-importer/batch/scan',
  batchCommit: '/skill-importer/batch/commit',
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

  // Plugin-closure state: last-good catalog plus its listeners. The array is
  // replaced immutably on refresh so getSnapshot stays stable between
  // refreshes (the inject hooks contract).
  let catalog: SkillCatalogSnapshot = []
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
  const skillsApi = connection.api.skills
  const originalList = skillsApi.list.bind(skillsApi)
  skillsApi.list = ((_request, _signal) => {
    return Promise.reject(new Error('skill group hidden: use the composer skill picker or /skills'))
  }) as typeof originalList

  // Text-reference lexicon: keeps `/name` highlighting working in every mode.
  // ui-skill's own lexicon dies in picker mode (its skill.list fetch fails),
  // so we contribute the names ourselves through a hidden source whose
  // candidates always reject — a failed candidates call drops the menu group
  // silently (never a visible empty row), while its lexicon roll still feeds
  // the composer's `/name` text-ref decoration, matching native typing.
  const usableNames = (): string[] => catalog.filter((skill) => skill.userInvocable).map((skill) => skill.name)
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
  const conversation = ctx.get('conversation')
  if (commandUi !== undefined && sessions !== undefined && conversation !== undefined) {
    ctx.effect(() => {
      const unregister = commandUi.register({
        name: 'skills',
        description: t('commandDescription'),
        available: () => true,
        ui: {
          kind: 'popupSelect',
          async options(_session, _signal) {
            // No `detail`: the popupSelect shell's local search filters over
            // label AND detail, and the user wants name-only matching.
            return catalog
              .filter((skill) => skill.userInvocable)
              .map((skill) => ({ id: skill.name, label: skill.name }))
          },
          onSelect(option, session) {
            const actx = sessions.scope(session.sessionId)
            if (actx === undefined) return
            const input = conversation.input.for(actx)
            // The popup was opened from a leading command token, which may be
            // the full `/skills` (typed + enter) or a prefix the menu matched
            // (`/s`, `/sk`, ...). Drop the leading `/word` token so the draft
            // becomes `/name ` — never `/name /s`. Text after the token
            // (the command's own argument, if any) is preserved.
            const rest = input.state.getSnapshot().draft.replace(/^\s*\/[a-zA-Z][a-zA-Z0-9-]*\s*/, '')
            const prefix = `/${option.id} `
            const nextDraft = `${prefix}${rest}`
            input.setDraft(nextDraft)
            requestComposerFocus({
              sessionId: session.sessionId,
              expectedDraft: nextDraft,
              caret: prefix.length,
            })
          },
        },
      })
      return unregister
    }, 'dsh-skill-importer: /skills popupSelect command')
  }

  const refreshSkills = async (): Promise<SkillCatalogSnapshot> => {
    const result = await call<SkillListResponse>(ROUTES.list)
    catalog = result.skills
    notify()
    return catalog
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
    const response = await connection.api.host.pickDirectory({})
    if (!response.result.ok) throw new Error(response.result.error.message)
    return response.result.value.path
  }

  const scanBatch = (request: BatchScanRequest): Promise<BatchScanResponse> =>
    call<BatchScanResponse>(ROUTES.batchScan, request)

  const commitBatch = (request: BatchCommitRequest): Promise<BatchCommitResponse> =>
    call<BatchCommitResponse>(ROUTES.batchCommit, request)

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
    },
    actions: {
      refreshSkills,
      importSkill,
      importUrl,
      deleteSkill,
      pickDirectory,
      scanBatch,
      commitBatch,
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

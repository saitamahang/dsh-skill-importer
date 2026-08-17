/**
 * Host (Node) half of the dsh-skill-importer plugin.
 *
 * Registers the `/skill-importer/*` HTTP routes on the harness's own web
 * server (`ctx.webServer` — the official plugin route registry, served on
 * the same origin as the Web UI):
 *
 * - GET  /skill-importer/health     — liveness probe
 * - GET  /skill-importer/list       — installed skills across all roots
 * - POST /skill-importer/import     — write one skill file from its text
 * - POST /skill-importer/import-url — fetch a URL and write the skill file
 * - POST /skill-importer/delete     — remove one installed skill copy
 * - POST /skill-importer/batch/scan — validate a local skills directory without writing
 * - POST /skill-importer/batch/commit — commit one short-lived preflight once
 *
 * The host process owns the filesystem (no agent sandbox, no approval), so
 * an import lands the file immediately; the skill-filesystem provider's
 * watcher then discovers it and hot-refreshes the catalog. No session, no
 * model, no agent involved in imports.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
// Type-only: pulls the workspace registry's and the skills registry's Context merges.
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-skill'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  commitBatch, deleteSkillFile, listSkills, originAllowed, readJsonBody,
  resolveImport, scanBatch, sendError, sendJson,
} from './server.ts'
import type { BatchScanSession } from './server.ts'
import type {
  BatchCommitRequest, BatchScanRequest, DeleteRequest,
  ImportRequest, ImportTarget, ImportUrlRequest,
} from './types.ts'

/** Route paths this plugin owns (exact matches; the client fetches the same literals). */
export const ROUTES = {
  health: '/skill-importer/health',
  list: '/skill-importer/list',
  import: '/skill-importer/import',
  importUrl: '/skill-importer/import-url',
  delete: '/skill-importer/delete',
  batchScan: '/skill-importer/batch/scan',
  batchCommit: '/skill-importer/batch/commit',
} as const

/** Required services: the harness web server's route registry and the workspace registry. */
export const inject = ['webServer', 'workspaceRegistry']

const handle = (fn: (req: IncomingMessage, res: ServerResponse) => Promise<void>): WebRoute['handler'] =>
  (req, res) => {
    void fn(req, res).catch((error: unknown) => {
      if (res.writableEnded) return
      sendError(res, 500, error instanceof Error ? error.message : String(error))
    })
  }

/**
 * Host plugin body: register the importer routes.
 * @param ctx - host plugin context (provides `ctx.webServer`).
 */
export function apply(ctx: Context): void {
  // Canonical paths of the registered workspaces; project targets write only
  // under these (the host process cwd is NOT a valid project root).
  const projectPaths = (): readonly string[] => ctx.workspaceRegistry.list().map((workspace) => workspace.path)
  const batchScans = new Map<string, BatchScanSession>()

  const pruneBatchScans = (): void => {
    const now = Date.now()
    for (const [id, session] of batchScans) {
      if (session.expiresAt <= now) batchScans.delete(id)
    }
  }

  const routes: readonly WebRoute[] = [
    {
      kind: 'exact',
      path: ROUTES.health,
      handler: (_req, res) => sendJson(res, 200, { ok: true }),
    },
    {
      kind: 'exact',
      path: ROUTES.list,
      handler: handle(async (_req, res) => {
        sendJson(res, 200, { ok: true, skills: listSkills(projectPaths()) })
      }),
    },
    {
      kind: 'exact',
      path: ROUTES.import,
      handler: handle(async (req, res) => {
        if (!originAllowed(req)) {
          sendError(res, 403, 'origin 不被允许')
          return
        }
        const body = await readJsonBody(req) as Partial<ImportRequest>
        if (typeof body.name !== 'string' || typeof body.content !== 'string'
          || body.target !== 'user' && body.target !== 'project-agents') {
          sendError(res, 400, '请求缺少 name / content / target 字段')
          return
        }
        const workspacePath = requireWorkspace(body.target, body.workspacePath)
        const path = await resolveImport({ name: body.name, target: body.target, content: body.content, workspacePath })
        sendJson(res, 200, { ok: true, path })
      }),
    },
    {
      kind: 'exact',
      path: ROUTES.importUrl,
      handler: handle(async (req, res) => {
        if (!originAllowed(req)) {
          sendError(res, 403, 'origin 不被允许')
          return
        }
        const body = await readJsonBody(req) as Partial<ImportUrlRequest>
        if (typeof body.name !== 'string' || typeof body.url !== 'string'
          || body.target !== 'user' && body.target !== 'project-agents') {
          sendError(res, 400, '请求缺少 name / url / target 字段')
          return
        }
        const workspacePath = requireWorkspace(body.target, body.workspacePath)
        const path = await resolveImport({ name: body.name, target: body.target, url: body.url, workspacePath })
        sendJson(res, 200, { ok: true, path })
      }),
    },
    {
      kind: 'exact',
      path: ROUTES.delete,
      handler: handle(async (req, res) => {
        if (!originAllowed(req)) {
          sendError(res, 403, 'origin 不被允许')
          return
        }
        const body = await readJsonBody(req) as Partial<DeleteRequest>
        if (typeof body.name !== 'string'
          || body.source !== 'user' && body.source !== 'project-agents') {
          sendError(res, 400, '请求缺少 name / source 字段')
          return
        }
        const workspacePath = requireWorkspace(body.source, body.workspacePath)
        const removed = deleteSkillFile(body.name, body.source, workspacePath)
        sendJson(res, 200, { ok: true, removed })
      }),
    },
    {
      kind: 'exact',
      path: ROUTES.batchScan,
      handler: handle(async (req, res) => {
        if (!originAllowed(req)) {
          sendError(res, 403, 'origin 不被允许')
          return
        }
        const body = await readJsonBody(req) as Partial<BatchScanRequest>
        if (typeof body.sourcePath !== 'string'
          || body.target !== 'user' && body.target !== 'project-agents') {
          sendError(res, 400, '请求缺少 sourcePath / target 字段')
          return
        }
        const workspacePath = requireWorkspace(body.target, body.workspacePath)
        pruneBatchScans()
        const session = scanBatch({ sourcePath: body.sourcePath, target: body.target, workspacePath })
        batchScans.set(session.scanId, session)
        sendJson(res, 200, {
          ok: true,
          scanId: session.scanId,
          sourcePath: session.sourcePath,
          entries: session.entries,
        })
      }),
    },
    {
      kind: 'exact',
      path: ROUTES.batchCommit,
      handler: handle(async (req, res) => {
        if (!originAllowed(req)) {
          sendError(res, 403, 'origin 不被允许')
          return
        }
        const body = await readJsonBody(req) as Partial<BatchCommitRequest>
        if (typeof body.scanId !== 'string' || !Array.isArray(body.replace)
          || !body.replace.every((name) => typeof name === 'string')) {
          sendError(res, 400, '请求缺少 scanId / replace 字段')
          return
        }
        pruneBatchScans()
        const session = batchScans.get(body.scanId)
        if (session === undefined) {
          sendError(res, 410, '批量扫描结果不存在或已过期，请重新扫描')
          return
        }
        // Single-use even when individual rows fail: a retry must start from a fresh preflight.
        batchScans.delete(body.scanId)
        const allowedNames = new Set(session.entries.filter((entry) => entry.status === 'ready' && entry.conflict).map((entry) => entry.name))
        const replacements = new Set(body.replace.filter((name) => allowedNames.has(name)))
        sendJson(res, 200, { ok: true, results: commitBatch(session, replacements) })
      }),
    },
  ]

  /**
   * Resolve and validate the workspace for a project target: the path must
   * come from the client and must be a registered workspace (never derived
   * from the host process cwd, which may differ from the user's workspace).
   */
  function requireWorkspace(target: ImportTarget, candidate: unknown): string | undefined {
    if (target === 'user') return undefined
    if (typeof candidate !== 'string') throw new Error('项目目标需要 workspacePath（当前工作区路径）')
    if (!projectPaths().includes(candidate)) throw new Error('workspacePath 不是已注册的工作区')
    return candidate
  }

  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-skill-importer: routes')
}

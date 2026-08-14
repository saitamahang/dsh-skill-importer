/**
 * Host-side skill importer logic: direct filesystem writes, skill-root
 * scanning, and URL fetching. Pure Node — no Cordis imports — so the route
 * handlers stay unit-testable and the plugin body is only wiring.
 *
 * This is the "direct write" path: the host process owns the filesystem
 * (no agent sandbox, no approval), so an import lands the file immediately
 * and the skill-filesystem watcher discovers it in place.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isValidSkillName, parseSkillFile } from './frontmatter.ts'
import type { ImportRequest, ImportTarget, ImportUrlRequest, SkillListEntry } from './types.ts'

/** Hard cap for one imported skill body (matches the client preview limit). */
export const MAX_CONTENT_BYTES = 256 * 1024

/** Cap for one request body read (JSON overhead above the content cap). */
export const MAX_BODY_BYTES = 1024 * 1024

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The harness home (`$DSH_HOME`, defaulting to `~/.dsh`). */
export function dshHomeDir(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** Absolute skill root for one target under one workspace. */
export function skillRoot(target: ImportTarget, workspacePath: string): string {
  switch (target) {
    case 'user':
      return join(dshHomeDir(), 'skills')
    case 'project-agents':
      return join(workspacePath, '.agents', 'skills')
    case 'project-dsh':
      return join(workspacePath, '.dsh', 'skills')
  }
}

/** Discovery rank per root (lower wins), mirroring dsh-skill-filesystem. */
const ROOT_RANK: Record<ImportTarget, number> = { 'project-dsh': 100, 'project-agents': 200, user: 400 }

/** Scan order: project roots first so project skills win duplicate names. */
const SCAN_ORDER: readonly ImportTarget[] = ['project-dsh', 'project-agents', 'user']

/**
 * Quote one frontmatter string value when plain YAML would mis-parse it:
 * a value containing `: ` (or any colon), leading/trailing whitespace, a
 * leading YAML special character, or ` #` would fail or change meaning
 * under the strict YAML parser `dsh-skill-filesystem` uses — such a file is
 * silently skipped by discovery. `JSON.stringify` emits a YAML-compatible
 * double-quoted scalar.
 */
function yamlScalar(value: string): string {
  if (value.length === 0
    || /^[\s]/.test(value)
    || /[\s]$/.test(value)
    || /:/.test(value)
    || /#/.test(value)
    || /^[!&*{}\[\],|>'"%@`?]/.test(value)) {
    return JSON.stringify(value)
  }
  return value
}

/**
 * Rebuild a skill file's frontmatter in the canonical, strictly-YAML-valid
 * form the harness's provider parses. Unknown keys are dropped (the harness
 * only consumes name/description/whenToUse and the two invocation flags);
 * the body is preserved verbatim (trimmed).
 */
export function normalizeSkillText(text: string): string {
  const { frontmatter, body } = parseSkillFile(text)
  if (frontmatter.name === undefined || frontmatter.description === undefined) {
    throw new Error('frontmatter 缺少 name 或 description 字段')
  }
  const lines = ['---']
  lines.push(`name: ${frontmatter.name}`)
  lines.push(`description: ${yamlScalar(frontmatter.description)}`)
  if (frontmatter.whenToUse !== undefined) lines.push(`whenToUse: ${yamlScalar(frontmatter.whenToUse)}`)
  if (frontmatter.disableModelInvocation !== undefined) lines.push(`disable-model-invocation: ${frontmatter.disableModelInvocation}`)
  if (frontmatter.userInvocable !== undefined) lines.push(`user-invocable: ${frontmatter.userInvocable}`)
  lines.push('---')
  const normalizedBody = body.trim()
  return lines.join('\n') + (normalizedBody.length > 0 ? `\n\n${normalizedBody}\n` : '\n')
}

/**
 * Write one skill file atomically: `<root>/<name>/SKILL.md`, created via a
 * same-directory temp file plus rename so a crash never leaves a torn file.
 * The content's frontmatter is normalized first so the harness's strict YAML
 * discovery always finds the skill.
 * @param name - kebab-case skill name (validated).
 * @param target - which skill root to write into.
 * @param content - full Markdown text (frontmatter included).
 * @param workspacePath - canonical workspace path; required for project targets.
 * @returns the absolute path of the written file.
 */
export function writeSkillFile(name: string, target: ImportTarget, content: string, workspacePath?: string): string {
  if (!KEBAB_CASE.test(name)) throw new Error('技能名必须是 kebab-case（小写字母、数字、短横线）')
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) throw new Error(`内容超过 ${MAX_CONTENT_BYTES / 1024} KB`)
  if (target !== 'user' && workspacePath === undefined) {
    throw new Error('项目目标需要 workspacePath（当前工作区路径）')
  }
  const normalized = normalizeSkillText(content)
  const directory = join(skillRoot(target, workspacePath ?? ''), name)
  mkdirSync(directory, { recursive: true })
  const file = join(directory, 'SKILL.md')
  const temporary = `${file}.tmp`
  writeFileSync(temporary, normalized, 'utf8')
  renameSync(temporary, file)
  return file
}

/** Scan one skill root and fold its skills into the name-keyed map (rank-aware). */
function scanRoot(root: string, source: ImportTarget, out: Map<string, SkillListEntry>): void {
  if (!existsSync(root)) return
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name)
    let file: string | undefined
    if (entry.isDirectory()) {
      const candidate = join(entryPath, 'SKILL.md')
      if (existsSync(candidate)) file = candidate
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      file = entryPath
    }
    if (file === undefined) continue
    const { frontmatter } = parseSkillFile(readFileSync(file, 'utf8'))
    if (frontmatter.name === undefined || frontmatter.description === undefined) continue
    if (!isValidSkillName(frontmatter.name)) continue
    const existing = out.get(frontmatter.name)
    if (existing !== undefined && ROOT_RANK[existing.source] <= ROOT_RANK[source]) continue
    out.set(frontmatter.name, {
      name: frontmatter.name,
      description: frontmatter.description,
      ...(frontmatter.whenToUse !== undefined ? { whenToUse: frontmatter.whenToUse } : {}),
      modelInvocable: frontmatter.disableModelInvocation !== true,
      userInvocable: frontmatter.userInvocable !== false,
      source,
    })
  }
}

/**
 * List every installed skill across every registered workspace's project
 * roots plus the user root. No rank deduplication: the management surface
 * shows every location's copy (the framework's own catalog still applies
 * rank at discovery time). Display order groups by source, then name.
 * @param workspacePaths - canonical paths of the registered workspaces.
 */
export function listSkills(workspacePaths: readonly string[]): SkillListEntry[] {
  const rows: SkillListEntry[] = []
  for (const target of SCAN_ORDER) {
    const out = new Map<string, SkillListEntry>()
    for (const path of target === 'user' ? [dshHomeDir()] : workspacePaths) {
      scanRoot(skillRoot(target, path), target, out)
    }
    rows.push(...out.values())
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Delete one installed skill (its whole bundle directory `<root>/<name>/`,
 * or the flat `<root>/<name>.md`), scoped to the skill roots only.
 * @param name - kebab-case skill name (validated).
 * @param source - which root the copy lives in.
 * @param workspacePath - canonical workspace path; required for project sources.
 * @returns true when something was removed, false when nothing matched.
 */
export function deleteSkillFile(name: string, source: ImportTarget, workspacePath?: string): boolean {
  if (!KEBAB_CASE.test(name)) throw new Error('技能名必须是 kebab-case（小写字母、数字、短横线）')
  if (source !== 'user' && workspacePath === undefined) {
    throw new Error('项目来源需要 workspacePath（当前工作区路径）')
  }
  const root = skillRoot(source, workspacePath ?? '')
  const directory = join(root, name)
  if (existsSync(directory)) {
    rmSync(directory, { recursive: true, force: true })
    return true
  }
  const flat = join(root, `${name}.md`)
  if (existsSync(flat)) {
    rmSync(flat)
    return true
  }
  return false
}

/** Strip HTML down to a plain-Markdown-ish text body (best effort). */
function extractHtmlText(html: string): string {
  const withoutBlocks = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  const title = withoutBlocks.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? ''
  const body = withoutBlocks
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return title.length > 0 ? `# ${title}\n\n${body}` : body
}

/**
 * Fetch a URL's content for import. Markdown/plain responses pass through
 * verbatim; HTML is roughly extracted to text (the import UI recommends
 * `.md` sources).
 * @param url - the source URL.
 * @returns the text to write as the skill body.
 */
export async function fetchUrlContent(url: string): Promise<string> {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`抓取失败：HTTP ${response.status}`)
  const type = response.headers.get('content-type') ?? ''
  const text = await response.text()
  return type.includes('html') ? extractHtmlText(text) : text
}

/**
 * Resolve one import request into a written file path. Shared by the file
 * and URL routes; URL imports fetch first, then reuse the same write path.
 * @param request - validated import body.
 * @returns the absolute path of the written SKILL.md.
 */
export async function resolveImport(request: ImportRequest | ImportUrlRequest): Promise<string> {
  const content = 'content' in request
    ? request.content
    : await fetchUrlContent(request.url)
  return writeSkillFile(request.name, request.target, content, request.workspacePath)
}

// ---- HTTP layer -----------------------------------------------------------

/** Read and parse a JSON request body within a byte cap. */
export function readJsonBody(req: IncomingMessage, limit: number = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('无效的 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Origin fence: the routes are served on the harness's loopback-only web
 * server, so only the browser page itself (or a local curl) reaches them.
 * A cross-origin page (any other website) is refused. Requests without an
 * Origin header (curl, same-origin GET) pass.
 */
export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    const hostname = new URL(origin).hostname
    return hostname === '127.0.0.1' || hostname === 'localhost'
  } catch {
    return false
  }
}

/** Send one JSON response. */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** Send a JSON error response with the given status. */
export function sendError(res: ServerResponse, status: number, error: string): void {
  sendJson(res, status, { ok: false, error })
}

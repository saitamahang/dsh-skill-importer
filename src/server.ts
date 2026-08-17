/**
 * Host-side skill importer logic: direct filesystem writes, skill-root
 * scanning, and URL fetching. Pure Node — no Cordis imports — so the route
 * handlers stay unit-testable and the plugin body is only wiring.
 *
 * This is the "direct write" path: the host process owns the filesystem
 * (no agent sandbox, no approval), so an import lands the file immediately
 * and the skill-filesystem watcher discovers it in place.
 */

import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isValidSkillName, parseSkillFile } from './frontmatter.ts'
import type {
  BatchCommitEntry, BatchScanEntry, BatchScanRequest,
  ImportRequest, ImportTarget, ImportUrlRequest, SkillListEntry,
} from './types.ts'

/** Hard cap for one imported skill body (matches the client preview limit). */
export const MAX_CONTENT_BYTES = 256 * 1024

/** Cap for one request body read (JSON overhead above the content cap). */
export const MAX_BODY_BYTES = 1024 * 1024

/** Batch safety bounds: resources are copied, but one selection stays finite. */
export const MAX_BATCH_SKILLS = 200
export const MAX_BATCH_FILES_PER_SKILL = 2_000
export const MAX_BATCH_SKILL_BYTES = 10 * 1024 * 1024
export const BATCH_SCAN_TTL_MS = 10 * 60 * 1000

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const AGENT_SKILL_PARENTS = new Set(['.agents', '.claude', '.codex', '.dsh'])
const MAX_URL_REDIRECTS = 5

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
  }
}

/** Discovery rank per root (lower wins), mirroring dsh-skill-filesystem. */
const ROOT_RANK: Record<ImportTarget, number> = { 'project-agents': 200, user: 400 }

/** Scan order: project roots first so project skills win duplicate names. */
const SCAN_ORDER: readonly ImportTarget[] = ['project-agents', 'user']

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

/** Host-only source candidate retained between scan and the one-time commit. */
interface BatchCandidate {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly sourcePath: string
  readonly sourceKind: 'directory' | 'file'
  readonly fingerprint: string
}

/** One short-lived preflight. The HTTP layer owns the map and single-use lifecycle. */
export interface BatchScanSession {
  readonly scanId: string
  readonly sourcePath: string
  readonly target: ImportTarget
  readonly workspacePath?: string
  readonly expiresAt: number
  readonly entries: readonly BatchScanEntry[]
  readonly candidates: ReadonlyMap<string, BatchCandidate>
}

interface SourceStats {
  readonly fingerprint: string
  readonly fileCount: number
  readonly bytes: number
}

/** Hash names and bytes while refusing symlinks and oversized skill bundles. */
function sourceStats(sourcePath: string, kind: 'directory' | 'file'): SourceStats {
  const hash = createHash('sha256')
  let fileCount = 0
  let bytes = 0
  const visit = (path: string, relativePath: string): void => {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error('技能目录不能包含符号链接')
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        visit(join(path, entry.name), relativePath.length === 0 ? entry.name : join(relativePath, entry.name))
      }
      return
    }
    if (!stat.isFile()) throw new Error('技能目录包含不支持的文件类型')
    fileCount += 1
    bytes += stat.size
    if (fileCount > MAX_BATCH_FILES_PER_SKILL) throw new Error(`技能文件数量超过 ${MAX_BATCH_FILES_PER_SKILL}`)
    if (bytes > MAX_BATCH_SKILL_BYTES) throw new Error(`技能目录超过 ${MAX_BATCH_SKILL_BYTES / 1024 / 1024} MB`)
    hash.update(relativePath)
    hash.update('\0')
    hash.update(readFileSync(path))
    hash.update('\0')
  }
  visit(sourcePath, kind === 'file' ? basename(sourcePath) : '')
  return { fingerprint: hash.digest('hex'), fileCount, bytes }
}

function destinationExists(name: string, target: ImportTarget, workspacePath?: string): boolean {
  const root = skillRoot(target, workspacePath ?? '')
  return existsSync(join(root, name)) || existsSync(join(root, `${name}.md`))
}

/** Resolve immediate child skill directories and flat Markdown skills. */
function batchSources(root: string): Array<{ path: string; kind: 'directory' | 'file'; label: string }> {
  const ownSkill = join(root, 'SKILL.md')
  if (existsSync(ownSkill)) return [{ path: root, kind: 'directory', label: basename(root) }]
  const sources: Array<{ path: string; kind: 'directory' | 'file'; label: string }> = []
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory() && existsSync(join(path, 'SKILL.md'))) {
      sources.push({ path, kind: 'directory', label: entry.name })
    } else if (entry.isFile() && ['.md', '.markdown'].includes(extname(entry.name).toLowerCase())) {
      sources.push({ path, kind: 'file', label: basename(entry.name, extname(entry.name)) })
    }
  }
  return sources
}

/** Validate a selected skills root without writing anything. */
export function scanBatch(request: BatchScanRequest): BatchScanSession {
  if (!isAbsolute(request.sourcePath)) throw new Error('批量导入目录必须是绝对路径')
  if (!existsSync(request.sourcePath) || !statSync(request.sourcePath).isDirectory()) throw new Error('批量导入目录不存在或不可读')
  const sourcePath = realpathSync(request.sourcePath)
  const leaf = basename(sourcePath)
  const parent = basename(dirname(sourcePath))
  const grandparent = basename(dirname(dirname(sourcePath)))
  const isSkillsRoot = leaf === 'skills' && AGENT_SKILL_PARENTS.has(parent)
  const isSkillDirectory = parent === 'skills' && AGENT_SKILL_PARENTS.has(grandparent)
  if (!isSkillsRoot && !isSkillDirectory) {
    throw new Error('批量导入仅支持 .claude、.codex、.agents 或 .dsh 下的 skills 目录')
  }
  if (request.target !== 'user' && request.workspacePath === undefined) throw new Error('项目目标需要 workspacePath（当前工作区路径）')
  const sources = batchSources(sourcePath)
  if (sources.length === 0) throw new Error('所选目录中没有找到可导入的技能')
  if (sources.length > MAX_BATCH_SKILLS) throw new Error(`一次最多扫描 ${MAX_BATCH_SKILLS} 个技能`)
  const entries: BatchScanEntry[] = []
  const candidates = new Map<string, BatchCandidate>()
  const nameRows = new Map<string, number[]>()

  for (const [index, source] of sources.entries()) {
    const id = String(index + 1)
    const relativePath = relative(sourcePath, source.path) || '.'
    try {
      const skillFile = source.kind === 'directory' ? join(source.path, 'SKILL.md') : source.path
      const text = readFileSync(skillFile, 'utf8')
      if (Buffer.byteLength(text, 'utf8') > MAX_CONTENT_BYTES) throw new Error(`SKILL.md 超过 ${MAX_CONTENT_BYTES / 1024} KB`)
      const { frontmatter } = parseSkillFile(text)
      if (frontmatter.name === undefined) throw new Error('frontmatter 缺少 name 字段')
      if (!isValidSkillName(frontmatter.name)) throw new Error('name 必须是 kebab-case（小写字母、数字、短横线）')
      if (frontmatter.description === undefined || frontmatter.description.trim().length === 0) throw new Error('frontmatter 缺少 description 字段')
      // Reuse the canonical normalizer so scan and single-file import accept the same format.
      normalizeSkillText(text)
      const stats = sourceStats(source.path, source.kind)
      const warnings = source.label === frontmatter.name
        ? undefined
        : [`目录或文件名“${source.label}”与技能名“${frontmatter.name}”不一致`]
      entries.push({
        id,
        name: frontmatter.name,
        description: frontmatter.description,
        relativePath,
        status: 'ready',
        conflict: destinationExists(frontmatter.name, request.target, request.workspacePath),
        ...(warnings === undefined ? {} : { warnings }),
      })
      candidates.set(id, {
        id,
        name: frontmatter.name,
        description: frontmatter.description,
        sourcePath: source.path,
        sourceKind: source.kind,
        fingerprint: stats.fingerprint,
      })
      const at = entries.length - 1
      nameRows.set(frontmatter.name, [...(nameRows.get(frontmatter.name) ?? []), at])
    } catch (error) {
      entries.push({
        id,
        name: source.label,
        relativePath,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        conflict: false,
      })
    }
  }

  // A duplicate inside the selected batch is ambiguous: every copy is refused.
  for (const [name, indexes] of nameRows) {
    if (indexes.length < 2) continue
    for (const index of indexes) {
      const entry = entries[index]
      if (entry === undefined) continue
      entries[index] = { ...entry, status: 'error', conflict: false, error: `批次内存在重复技能名：${name}` }
      candidates.delete(entry.id)
    }
  }

  return {
    scanId: randomUUID(),
    sourcePath,
    target: request.target,
    ...(request.workspacePath === undefined ? {} : { workspacePath: request.workspacePath }),
    expiresAt: Date.now() + BATCH_SCAN_TTL_MS,
    entries,
    candidates,
  }
}

/** Copy one validated candidate into a same-root staging directory, then atomically swap it in. */
function installBatchCandidate(candidate: BatchCandidate, session: BatchScanSession, replace: boolean): 'imported' | 'replaced' {
  const fresh = sourceStats(candidate.sourcePath, candidate.sourceKind)
  if (fresh.fingerprint !== candidate.fingerprint) throw new Error('源技能在确认期间发生变化，请重新扫描')
  const root = skillRoot(session.target, session.workspacePath ?? '')
  mkdirSync(root, { recursive: true })
  const finalDirectory = join(root, candidate.name)
  const flatFile = join(root, `${candidate.name}.md`)
  const conflicts = [finalDirectory, flatFile].filter(existsSync)
  if (conflicts.length > 0 && !replace) throw new Error('目标中已存在同名技能')
  const staging = join(root, `.${candidate.name}.import-${randomUUID()}`)
  const backups: Array<{ original: string; backup: string }> = []
  try {
    if (candidate.sourceKind === 'directory') {
      cpSync(candidate.sourcePath, staging, { recursive: true, errorOnExist: true, dereference: false })
      const skillFile = join(staging, 'SKILL.md')
      writeFileSync(skillFile, normalizeSkillText(readFileSync(skillFile, 'utf8')), 'utf8')
    } else {
      mkdirSync(staging, { recursive: false })
      writeFileSync(join(staging, 'SKILL.md'), normalizeSkillText(readFileSync(candidate.sourcePath, 'utf8')), 'utf8')
    }
    for (const original of conflicts) {
      const backup = join(root, `.${basename(original)}.backup-${randomUUID()}`)
      renameSync(original, backup)
      backups.push({ original, backup })
    }
    renameSync(staging, finalDirectory)
    for (const { backup } of backups) rmSync(backup, { recursive: true, force: true })
    return conflicts.length > 0 ? 'replaced' : 'imported'
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    if (existsSync(finalDirectory) && backups.length > 0) rmSync(finalDirectory, { recursive: true, force: true })
    for (const { original, backup } of backups.reverse()) {
      if (existsSync(backup)) renameSync(backup, original)
    }
    throw error
  }
}

/** Commit a valid, unexpired scan once; invalid rows are returned as errors and never written. */
export function commitBatch(session: BatchScanSession, replaceNames: ReadonlySet<string>): BatchCommitEntry[] {
  if (Date.now() > session.expiresAt) throw new Error('批量扫描结果已过期，请重新扫描')
  const results: BatchCommitEntry[] = []
  for (const entry of session.entries) {
    if (entry.status === 'error') {
      results.push({ name: entry.name, status: 'error', message: entry.error })
      continue
    }
    const candidate = session.candidates.get(entry.id)
    if (candidate === undefined) {
      results.push({ name: entry.name, status: 'error', message: '扫描记录不完整，请重新扫描' })
      continue
    }
    const conflict = destinationExists(entry.name, session.target, session.workspacePath)
    if (conflict && !replaceNames.has(entry.name)) {
      results.push({ name: entry.name, status: 'skipped', message: '目标中已存在同名技能，未选择替换' })
      continue
    }
    try {
      results.push({ name: entry.name, status: installBatchCandidate(candidate, session, conflict && replaceNames.has(entry.name)) })
    } catch (error) {
      results.push({ name: entry.name, status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
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
function privateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true
  const [a = 0, b = 0, c = 0] = octets
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168 || (b === 0 && c === 2)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113)
}

/** Whether an address is unsafe for a host-side URL import. */
export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0] ?? ''
  if (isIP(normalized) === 4) return privateIpv4(normalized)
  if (isIP(normalized) !== 6) return true
  if (normalized.startsWith('::ffff:')) return privateIpv4(normalized.slice(7))
  return normalized === '::' || normalized === '::1'
    || normalized.startsWith('fc') || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith('ff')
    || normalized.startsWith('2001:db8:')
}

type ResolveHost = (hostname: string) => Promise<readonly { readonly address: string }[]>

const resolveHost: ResolveHost = async hostname => lookup(hostname, { all: true, verbatim: true })

/** Parse and resolve one URL before the host is allowed to request it. */
export async function assertSafeImportUrl(input: string, resolver: ResolveHost = resolveHost): Promise<URL> {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('URL 格式无效')
  }
  if (url.protocol !== 'https:') throw new Error('URL 导入仅支持 HTTPS')
  if (url.username.length > 0 || url.password.length > 0) throw new Error('URL 不能包含登录凭据')
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) throw new Error('URL 不能指向本机或私有网络')
  const addresses = isIP(hostname) === 0 ? await resolver(hostname) : [{ address: hostname }]
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('URL 不能指向本机、私有网络或保留地址')
  }
  return url
}

export async function fetchUrlContent(url: string): Promise<string> {
  let current = await assertSafeImportUrl(url)
  let response: Response | undefined
  for (let redirects = 0; redirects <= MAX_URL_REDIRECTS; redirects += 1) {
    response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    if (redirects === MAX_URL_REDIRECTS) throw new Error(`重定向次数超过 ${MAX_URL_REDIRECTS}`)
    const location = response.headers.get('location')
    if (location === null) throw new Error('重定向响应缺少 Location')
    current = await assertSafeImportUrl(new URL(location, current).href)
  }
  if (response === undefined) throw new Error('抓取失败')
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
 * Origin header is rejected: all state-changing browser requests include it,
 * while accepting an absent header would let non-browser clients bypass the fence.
 */
export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return false
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

/**
 * Shared wire types between the host half (HTTP routes) and the client half
 * (fetch calls). Pure types — no runtime code, no node imports — so the
 * browser bundle can reference them safely.
 */

/** Where the imported skill file should land. */
export type ImportTarget = 'user' | 'project-agents'

/** One installed skill row served by `/skill-importer/list`. */
export interface SkillListEntry {
  /** Kebab-case skill name (frontmatter `name`). */
  readonly name: string
  /** One-line routing description (frontmatter `description`). */
  readonly description: string
  /** Optional routing guidance (frontmatter `whenToUse`). */
  readonly whenToUse?: string
  /** False marks a user-only skill (`disable-model-invocation`). */
  readonly modelInvocable: boolean
  /** False marks a model-only skill (`user-invocable: false`). */
  readonly userInvocable: boolean
  /** Skill root (`'project-agents'` or `'user'`). */
  readonly source: ImportTarget
}

/** File-import request body. */
export interface ImportRequest {
  readonly name: string
  readonly target: ImportTarget
  /** Full Markdown skill file text (frontmatter included). */
  readonly content: string
  /** Canonical workspace path for project targets (host-validated against the registry). */
  readonly workspacePath?: string
}

/** Delete-request body. */
export interface DeleteRequest {
  readonly name: string
  /** Which root the copy lives in (`'project-agents'` or `'user'`). */
  readonly source: ImportTarget
  /** Canonical workspace path for project sources (host-validated). */
  readonly workspacePath?: string
}

/** URL-import request body. */
export interface ImportUrlRequest {
  readonly name: string
  readonly target: ImportTarget
  /** Source URL the host fetches (`.md` preferred; HTML is roughly extracted). */
  readonly url: string
  /** Canonical workspace path for project targets (host-validated against the registry). */
  readonly workspacePath?: string
}

/** Read-only preflight request for one local skills directory. */
export interface BatchScanRequest {
  readonly sourcePath: string
  readonly target: ImportTarget
  readonly workspacePath?: string
}

/** One source entry reported by batch preflight. */
export interface BatchScanEntry {
  /** Stable row id within this one scan. */
  readonly id: string
  /** Frontmatter name when readable, otherwise a best-effort source label. */
  readonly name: string
  readonly description?: string
  /** Path relative to the selected source directory. */
  readonly relativePath: string
  /** Error rows can never be selected for commit. */
  readonly status: 'ready' | 'error'
  readonly error?: string
  readonly warnings?: readonly string[]
  /** The selected destination already contains this skill name. */
  readonly conflict: boolean
}

/** Successful batch scan; the id is single-use and expires after ten minutes. */
export interface BatchScanResponse {
  readonly ok: true
  readonly scanId: string
  readonly sourcePath: string
  readonly entries: readonly BatchScanEntry[]
}

/** Commit a preflight, explicitly naming every destination conflict to replace. */
export interface BatchCommitRequest {
  readonly scanId: string
  readonly replace: readonly string[]
}

/** Final outcome of one preflight row. */
export interface BatchCommitEntry {
  readonly name: string
  readonly status: 'imported' | 'replaced' | 'skipped' | 'error'
  readonly message?: string
}

/** One-time batch commit result. */
export interface BatchCommitResponse {
  readonly ok: true
  readonly results: readonly BatchCommitEntry[]
}

/** `/skill-importer/list` response. */
export interface SkillListResponse {
  readonly ok: true
  readonly skills: readonly SkillListEntry[]
}

/** Success response of an import. */
export interface ImportResponse {
  readonly ok: true
  /** Absolute path of the written SKILL.md. */
  readonly path: string
}

/** Error response of any route. */
export interface ErrorResponse {
  readonly ok: false
  readonly error: string
}

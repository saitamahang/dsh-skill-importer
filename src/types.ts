/**
 * Shared wire types between the host half (HTTP routes) and the client half
 * (fetch calls). Pure types — no runtime code, no node imports — so the
 * browser bundle can reference them safely.
 */

/** Where the imported skill file should land. */
export type ImportTarget = 'user' | 'project-agents' | 'project-dsh'

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
  /** Winning discovery root ('project-dsh' | 'project-agents' | 'user'). */
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
  /** Which root the copy lives in ('user' | 'project-agents' | 'project-dsh'). */
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

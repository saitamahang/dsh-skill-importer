/**
 * Skill Markdown frontmatter parsing and validation (pure, browser-safe).
 *
 * Mirrors the subset of `dsh-skill-filesystem`'s frontmatter contract the
 * import UI needs for preview and pre-flight validation. The authoritative
 * parse remains the host provider's; this parser only previews and catches
 * obvious mistakes before the import instruction is sent.
 */

/** Frontmatter fields the import UI understands. */
export interface SkillFrontmatter {
  /** Kebab-case skill name (required for a valid skill). */
  name?: string
  /** One-line routing description (required for a valid skill). */
  description?: string
  /** Optional routing guidance. */
  whenToUse?: string
  /** `disable-model-invocation: true` keeps the skill out of model catalogs. */
  disableModelInvocation?: boolean
  /** `user-invocable: false` keeps the skill out of the `/` menu. */
  userInvocable?: boolean
}

/** Parsed Markdown file: frontmatter plus the body after it. */
export interface ParsedSkillFile {
  /** Parsed frontmatter values (empty when the file has no frontmatter block). */
  readonly frontmatter: SkillFrontmatter
  /** Markdown body after the closing `---` (empty when absent). */
  readonly body: string
}

/** Kebab-case name rule shared with `dsh-skill` (`^[a-z0-9]+(?:-[a-z0-9]+)*$`). */
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** True when the name satisfies the harness skill-name rule. */
export function isValidSkillName(name: string): boolean {
  return KEBAB_CASE.test(name)
}

const BOOLEAN_TRUE = new Set(['true', 'yes', 'on', '1'])
const BOOLEAN_FALSE = new Set(['false', 'no', 'off', '0'])

/** Parse one frontmatter scalar: quoted strings, booleans, or plain text. */
function parseScalar(raw: string): string | boolean | undefined {
  const value = raw.trim()
  if (value.length === 0) return undefined
  const lower = value.toLowerCase()
  if (BOOLEAN_TRUE.has(lower)) return true
  if (BOOLEAN_FALSE.has(lower)) return false
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
    || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Parse a skill Markdown file's frontmatter block.
 * @param text - full file text.
 * @returns parsed frontmatter and body; a file without a leading `---` block
 *   yields an empty frontmatter with the whole text as body.
 */
export function parseSkillFile(text: string): ParsedSkillFile {
  const frontmatter: SkillFrontmatter = {}
  if (!text.startsWith('---\n')) return { frontmatter, body: text }
  const end = text.indexOf('\n---', 4)
  if (end < 0) return { frontmatter, body: text }
  const block = text.slice(4, end)
  const body = text.slice(end + 4).replace(/^\n/, '')
  for (const line of block.split('\n')) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    const value = parseScalar(line.slice(colon + 1))
    if (value === undefined) continue
    switch (key) {
      case 'name':
        if (typeof value === 'string') frontmatter.name = value
        break
      case 'description':
        if (typeof value === 'string') frontmatter.description = value
        break
      case 'whenToUse':
        if (typeof value === 'string') frontmatter.whenToUse = value
        break
      case 'disable-model-invocation':
        if (typeof value === 'boolean') frontmatter.disableModelInvocation = value
        break
      case 'user-invocable':
        if (typeof value === 'boolean') frontmatter.userInvocable = value
        break
      default:
        break
    }
  }
  return { frontmatter, body }
}

/** Why a parsed file cannot be imported as a skill (or undefined when it can). */
export function validateSkillFile(text: string): string | undefined {
  const { frontmatter } = parseSkillFile(text)
  if (frontmatter.name === undefined || frontmatter.name.length === 0) return 'frontmatter 缺少 name 字段'
  if (!isValidSkillName(frontmatter.name)) return 'name 必须是 kebab-case（小写字母、数字、短横线）'
  if (frontmatter.description === undefined || frontmatter.description.length === 0) return 'frontmatter 缺少 description 字段'
  return undefined
}

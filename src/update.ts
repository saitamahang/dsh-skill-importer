import { readFileSync } from 'node:fs'

const REGISTRY_URL = 'https://registry.npmjs.org/dsh-skill-importer/latest'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 5_000

interface ParsedVersion {
  readonly core: readonly [number, number, number]
  readonly prerelease: readonly (number | string)[]
}

interface CachedLatest {
  readonly version: string
  readonly expiresAt: number
}

let cachedLatest: CachedLatest | undefined

function parseVersion(value: string): ParsedVersion | undefined {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value)
  if (match === null) return undefined
  const prerelease = match[4] === undefined
    ? []
    : match[4].split('.').map((part) => /^\d+$/.test(part) ? Number(part) : part)
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease }
}

/** SemVer ordering used to avoid offering a downgrade or an older prerelease. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === undefined || b === undefined) throw new Error('npm 返回了无效版本号')
  for (const index of [0, 1, 2] as const) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0
    return a.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const av = a.prerelease[index]
    const bv = b.prerelease[index]
    if (av === undefined) return -1
    if (bv === undefined) return 1
    if (av === bv) continue
    if (typeof av === 'number' && typeof bv === 'string') return -1
    if (typeof av === 'string' && typeof bv === 'number') return 1
    return av < bv ? -1 : 1
  }
  return 0
}

/** Read from package metadata in both src and built lib layouts. */
export function currentVersion(): string {
  const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown }
  if (typeof metadata.version !== 'string' || parseVersion(metadata.version) === undefined) {
    throw new Error('package.json 缺少有效版本号')
  }
  return metadata.version
}

export async function latestVersion(now = Date.now()): Promise<string> {
  if (cachedLatest !== undefined && cachedLatest.expiresAt > now) return cachedLatest.version
  const response = await fetch(REGISTRY_URL, {
    headers: { accept: 'application/json', 'user-agent': 'dsh-skill-importer-update-check' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`npm registry 返回 ${response.status}`)
  const metadata = await response.json() as { version?: unknown }
  if (typeof metadata.version !== 'string' || parseVersion(metadata.version) === undefined) {
    throw new Error('npm registry 返回了无效版本信息')
  }
  cachedLatest = { version: metadata.version, expiresAt: now + CACHE_TTL_MS }
  return metadata.version
}

export function updateCommand(version: string): string {
  if (parseVersion(version) === undefined) throw new Error('无法为无效版本生成更新命令')
  return `npx @deepseek-ai/dsh plugin --profile web add dsh-skill-importer@${version}`
}

import type { SkillListEntry } from '../types.ts'

const SOURCE_RANK: Readonly<Record<SkillListEntry['source'], number>> = {
  'project-dsh': 100,
  'project-agents': 200,
  'user-dsh': 400,
  'user-agents': 500,
}

/** Mirror DSH's name-based winner selection for one session-scoped catalog. */
export function effectiveSkills(rows: readonly SkillListEntry[]): readonly SkillListEntry[] {
  const winners = new Map<string, SkillListEntry>()
  for (const row of [...rows].sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source])) {
    if (!winners.has(row.name)) winners.set(row.name, row)
  }
  return [...winners.values()].sort((a, b) => a.name.localeCompare(b.name))
}

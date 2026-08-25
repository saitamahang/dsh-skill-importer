import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { listSkills, skillRoot } from '../src/server.ts'

const sandbox = mkdtempSync(join(tmpdir(), 'dsh-skill-list-test-'))
const previousHome = process.env.DSH_HOME
const previousAgentsHome = process.env.DSH_AGENTS_HOME
process.env.DSH_HOME = join(sandbox, 'home')
process.env.DSH_AGENTS_HOME = join(sandbox, 'agents-home')

try {
  assert.equal(skillRoot('project-dsh', '/workspace'), join('/workspace', '.dsh', 'skills'))
  assert.equal(skillRoot('project-agents', '/workspace'), join('/workspace', '.agents', 'skills'))
  assert.equal(skillRoot('user-dsh', ''), join(process.env.DSH_HOME, 'skills'))
  assert.equal(skillRoot('user-agents', ''), join(process.env.DSH_AGENTS_HOME, 'skills'))

  const first = join(sandbox, 'first')
  const second = join(sandbox, 'second')
  const firstRoot = join(first, '.agents', 'skills')
  const secondRoot = join(second, '.agents', 'skills')
  mkdirSync(join(firstRoot, 'shared'), { recursive: true })
  mkdirSync(join(secondRoot, 'shared'), { recursive: true })
  writeFileSync(join(firstRoot, 'shared', 'SKILL.md'), '---\nname: shared\ndescription: first\n---\n')
  writeFileSync(join(secondRoot, 'shared', 'SKILL.md'), '---\nname: shared\ndescription: second\n---\n')

  const listed = listSkills([first, second])
  assert.equal(listed.issues.length, 0)
  assert.deepEqual(
    listed.skills.map(skill => [skill.name, skill.description, skill.workspacePath]),
    [['shared', 'first', first], ['shared', 'second', second]],
  )

  chmodSync(secondRoot, 0o000)
  const partial = listSkills([first, second])
  assert.equal(partial.skills.length, 1)
  assert.equal(partial.skills[0]?.workspacePath, first)
  assert.equal(partial.issues.length, 1)
  assert.equal(partial.issues[0]?.path, secondRoot)
  chmodSync(secondRoot, 0o755)
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (previousAgentsHome === undefined) delete process.env.DSH_AGENTS_HOME
  else process.env.DSH_AGENTS_HOME = previousAgentsHome
  rmSync(sandbox, { recursive: true, force: true })
}

console.log('skill list test: OK')

import assert from 'node:assert/strict'
import { effectiveSkills } from '../src/client/effectiveSkills.ts'

const row = (name, source, workspacePath) => ({
  name,
  source,
  workspacePath,
  description: source,
  modelInvocable: true,
  userInvocable: true,
})

const effective = effectiveSkills([
  row('shared', 'user-agents'),
  row('shared', 'project-agents', '/project'),
  row('shared', 'user-dsh'),
  row('shared', 'project-dsh', '/project'),
  row('global-only', 'user-dsh'),
])

assert.deepEqual(effective.map((skill) => [skill.name, skill.source]), [
  ['global-only', 'user-dsh'],
  ['shared', 'project-dsh'],
])
console.log('effective skills test: OK')

import assert from 'node:assert/strict'
import { atomicSkillArrow, atomicSkillBackspace } from '../src/client/atomicSkillDelete.ts'

const names = ['foo', 'foo-bar', 'pangu-agent']

assert.deepEqual(atomicSkillBackspace('/pangu-agent ', 13, names), { draft: '', caret: 0 })
assert.deepEqual(atomicSkillBackspace('/pangu-agent ', 12, names), { draft: '', caret: 0 })
assert.deepEqual(atomicSkillBackspace('/foo-bar explain', 9, names), { draft: 'explain', caret: 0 })
assert.deepEqual(atomicSkillBackspace('/foo-bar', 8, names), { draft: '', caret: 0 })

assert.equal(atomicSkillBackspace('/pangu-agent ', 6, names), undefined)
assert.equal(atomicSkillBackspace('/unknown ', 9, names), undefined)
assert.equal(atomicSkillBackspace(' /pangu-agent ', 14, names), undefined)
assert.equal(atomicSkillBackspace('/foo-barium ', 12, names), undefined)
assert.equal(atomicSkillBackspace('/foo\nnext', 5, names), undefined)

assert.equal(atomicSkillArrow('/pangu-agent ', 13, 'left', names), 0)
assert.equal(atomicSkillArrow('/pangu-agent ', 6, 'left', names), 0)
assert.equal(atomicSkillArrow('/pangu-agent ', 0, 'right', names), 13)
assert.equal(atomicSkillArrow('/pangu-agent explain', 13, 'right', names), undefined)
assert.equal(atomicSkillArrow('/pangu-agent explain', 14, 'left', names), undefined)
assert.equal(atomicSkillArrow('/unknown ', 0, 'right', names), undefined)

console.log('atomic skill delete test: OK')

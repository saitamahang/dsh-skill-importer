import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseSkillFile, validateSkillFile } from '../src/frontmatter.ts'
import { assertSafeImportUrl, commitBatch, isPrivateAddress, originAllowed, scanBatch } from '../src/server.ts'

const sandbox = mkdtempSync(join(tmpdir(), 'dsh-batch-test-'))
process.env.DSH_HOME = join(sandbox, 'home')

const skill = (name, description = `Description for ${name}`) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`

const crlfSkill = skill('windows-crlf').replace(/\n/g, '\r\n')
assert.equal(parseSkillFile(crlfSkill).frontmatter.name, 'windows-crlf')
assert.equal(validateSkillFile(crlfSkill), undefined)
assert.equal(parseSkillFile(skill('legacy-cr').replace(/\n/g, '\r')).frontmatter.name, 'legacy-cr')

try {
  const source = join(sandbox, '.claude', 'skills')
  mkdirSync(source, { recursive: true })

  // A complete directory skill proves resources survive the migration.
  mkdirSync(join(source, 'alpha', 'scripts'), { recursive: true })
  writeFileSync(join(source, 'alpha', 'SKILL.md'), skill('alpha'))
  writeFileSync(join(source, 'alpha', 'scripts', 'run.sh'), 'echo alpha\n')

  // Windows CRLF skills must pass the same batch preflight and normalize to LF.
  mkdirSync(join(source, 'windows-crlf'), { recursive: true })
  writeFileSync(join(source, 'windows-crlf', 'SKILL.md'), crlfSkill)

  // Invalid metadata must be reported but never written.
  mkdirSync(join(source, 'invalid'), { recursive: true })
  writeFileSync(join(source, 'invalid', 'SKILL.md'), '---\nname: invalid\n---\n')

  // Ambiguous names inside one batch refuse every copy.
  for (const folder of ['dup-a', 'dup-b']) {
    mkdirSync(join(source, folder), { recursive: true })
    writeFileSync(join(source, folder, 'SKILL.md'), skill('duplicate'))
  }

  // Existing destination content is only replaced after explicit confirmation.
  const existing = join(process.env.DSH_HOME, 'skills', 'alpha')
  mkdirSync(existing, { recursive: true })
  writeFileSync(join(existing, 'SKILL.md'), skill('alpha', 'old'))

  const scan = scanBatch({ sourcePath: source, target: 'user-dsh' })
  assert.equal(scan.entries.find(row => row.name === 'alpha')?.conflict, true)
  assert.equal(scan.entries.find(row => row.name === 'windows-crlf')?.status, 'ready')
  assert.equal(scan.entries.find(row => row.name === 'invalid')?.status, 'error')
  assert.equal(scan.entries.filter(row => row.name === 'duplicate' && row.status === 'error').length, 2)

  const results = commitBatch(scan, new Set(['alpha']))
  assert.equal(results.find(row => row.name === 'alpha')?.status, 'replaced')
  assert.equal(results.find(row => row.name === 'windows-crlf')?.status, 'imported')
  assert.equal(results.filter(row => row.name === 'duplicate' && row.status === 'error').length, 2)
  assert.equal(existsSync(join(process.env.DSH_HOME, 'skills', 'alpha', 'scripts', 'run.sh')), true)
  assert.match(readFileSync(join(process.env.DSH_HOME, 'skills', 'alpha', 'SKILL.md'), 'utf8'), /Description for alpha/)
  assert.doesNotMatch(readFileSync(join(process.env.DSH_HOME, 'skills', 'windows-crlf', 'SKILL.md'), 'utf8'), /\r/)
  assert.equal(existsSync(join(process.env.DSH_HOME, 'skills', 'invalid')), false)
  assert.equal(existsSync(join(process.env.DSH_HOME, 'skills', 'duplicate')), false)

  // A changed source invalidates the preflight and leaves no partial destination.
  const changedSource = join(sandbox, '.codex', 'skills')
  mkdirSync(join(changedSource, 'beta'), { recursive: true })
  writeFileSync(join(changedSource, 'beta', 'SKILL.md'), skill('beta'))
  const changedScan = scanBatch({ sourcePath: changedSource, target: 'user-dsh' })
  writeFileSync(join(changedSource, 'beta', 'SKILL.md'), skill('beta', 'changed after scan'))
  const changedResults = commitBatch(changedScan, new Set())
  assert.equal(changedResults[0]?.status, 'error')
  assert.match(changedResults[0]?.message ?? '', /发生变化/)
  assert.equal(existsSync(join(process.env.DSH_HOME, 'skills', 'beta')), false)

  // Any agent may use its own parent directory; the selected root name is the boundary.
  const customAgentSource = join(sandbox, 've_hcs_agent', 'skills')
  mkdirSync(join(customAgentSource, 'gamma'), { recursive: true })
  writeFileSync(join(customAgentSource, 'gamma', 'SKILL.md'), skill('gamma'))
  assert.equal(scanBatch({ sourcePath: customAgentSource, target: 'user-dsh' }).entries[0]?.name, 'gamma')

  const empty = join(sandbox, '.agents', 'skills')
  mkdirSync(empty, { recursive: true })
  assert.throws(() => scanBatch({ sourcePath: empty, target: 'user-dsh' }), /没有找到/)

  const arbitrary = join(sandbox, 'arbitrary')
  mkdirSync(arbitrary)
  assert.throws(() => scanBatch({ sourcePath: arbitrary, target: 'user-dsh' }), /名为 skills/)

  assert.equal(originAllowed({ headers: {} }), false)
  assert.equal(originAllowed({ headers: { origin: 'https://evil.example' } }), false)
  assert.equal(originAllowed({ headers: { origin: 'http://127.0.0.1:2026' } }), true)
  assert.equal(isPrivateAddress('127.0.0.1'), true)
  assert.equal(isPrivateAddress('169.254.169.254'), true)
  assert.equal(isPrivateAddress('10.0.0.1'), true)
  assert.equal(isPrivateAddress('::1'), true)
  assert.equal(isPrivateAddress('8.8.8.8'), false)
  await assert.rejects(assertSafeImportUrl('http://example.com/skill.md'), /仅支持 HTTPS/)
  await assert.rejects(assertSafeImportUrl('https://localhost/skill.md'), /私有网络/)
  await assert.rejects(assertSafeImportUrl('https://[::1]/skill.md'), /私有网络|保留地址/)
  await assert.rejects(
    assertSafeImportUrl('https://internal.example/skill.md', async () => [{ address: '10.0.0.2' }]),
    /私有网络/,
  )
  const publicUrl = await assertSafeImportUrl(
    'https://skills.example/skill.md',
    async () => [{ address: '93.184.216.34' }],
  )
  assert.equal(publicUrl.hostname, 'skills.example')
  console.log('batch import test: OK')
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}

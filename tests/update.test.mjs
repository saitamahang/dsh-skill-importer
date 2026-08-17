import assert from 'node:assert/strict'
import test from 'node:test'
import { compareVersions, currentVersion, updateCommand } from '../src/update.ts'

test('compares stable semantic versions', () => {
  assert.equal(compareVersions('0.2.3', '0.2.4'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1)
})

test('orders prereleases before stable releases', () => {
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0'), -1)
  assert.equal(compareVersions('1.0.0-rc.10', '1.0.0-rc.2'), 1)
})

test('reads package version and produces an exact update command', () => {
  assert.equal(currentVersion(), '0.2.3')
  assert.equal(
    updateCommand('0.2.4'),
    'npx @deepseek-ai/dsh plugin --profile web add dsh-skill-importer@0.2.4',
  )
})

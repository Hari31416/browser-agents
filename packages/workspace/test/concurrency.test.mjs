import assert from 'node:assert/strict'
import {
  WorkspaceManager,
  MemoryFileStore,
  MemoryRecordStore,
  StaleRevisionError,
} from '../dist/index.js'

console.log('Running workspace concurrency and revision checking tests...')

const fileStore = new MemoryFileStore()
const recordStore = new MemoryRecordStore()
const manager = new WorkspaceManager({
  fileStore,
  recordStore,
})

const chat = await manager.createChat('Concurrency Test Chat')
const ws = manager.getWorkspace(chat.id)

// 1. Initial write creates version 1
const meta1 = await ws.writeFile('config.json', '{"version": 1}')
assert.equal(meta1.version, 1)

// 2. Write with matching expectedVersion succeeds and creates version 2
const meta2 = await ws.writeFile('config.json', '{"version": 2}', {
  expectedVersion: 1,
})
assert.equal(meta2.version, 2)

// 3. Write with stale expectedVersion fails with StaleRevisionError
await assert.rejects(
  () => ws.writeFile('config.json', '{"version": 3}', { expectedVersion: 1 }),
  StaleRevisionError,
)

// Current version is still 2
const currentFile = await ws.readFile('config.json')
assert.equal(currentFile?.version, 2)
assert.equal(currentFile?.content, '{"version": 2}')

// 4. Edit with matching expectedVersion succeeds
const meta3 = await ws.editFile('config.json', {
  target: '"version": 2',
  replacement: '"version": 3',
  expectedVersion: 2,
})
assert.equal(meta3.version, 3)

// 5. Edit with stale expectedVersion fails
await assert.rejects(
  () =>
    ws.editFile('config.json', {
      target: '"version": 3',
      replacement: '"version": 4',
      expectedVersion: 2,
    }),
  StaleRevisionError,
)

// 6. Delete with stale expectedVersion fails
await assert.rejects(
  () => ws.deleteFile('config.json', { expectedVersion: 1 }),
  StaleRevisionError,
)

// 7. Delete with matching expectedVersion succeeds
const deleteSuccess = await ws.deleteFile('config.json', { expectedVersion: 3 })
assert.equal(deleteSuccess, true)
assert.equal(await ws.readFile('config.json'), null)

console.log('Workspace concurrency and revision checking tests passed successfully!')

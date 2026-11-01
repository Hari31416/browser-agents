import assert from 'node:assert/strict'
import {
  WorkspaceManager,
  MemoryFileStore,
  MemoryRecordStore,
  TabLockManager,
} from '@browser-agents/workspace'
import { validateOutputFiles } from '../dist/security.js'

console.log('Running Python workspace snapshot and staging integration tests...')

const fileStore = new MemoryFileStore()
const recordStore = new MemoryRecordStore()
const lockManager = new TabLockManager()
const manager = new WorkspaceManager({ fileStore, recordStore, lockManager })

const chat = await manager.createChat('Test Python Session')
const workspace = manager.getWorkspace(chat.id)

// 1. Initial workspace population
await workspace.writeFile('/input.csv', 'x,y\n1,10\n2,20\n3,30\n', 'utf-8')
await workspace.writeFile('/params.json', JSON.stringify({ threshold: 15 }), 'utf-8')

const initialFiles = await workspace.listFiles()
assert.equal(initialFiles.length, 2)

// 2. Snapshot capture
const snapshot = await workspace.createExecutionSnapshot()
assert.equal(snapshot.chatId, chat.id)
assert.equal(Object.keys(snapshot.baseRevisions).length, 2)
assert.equal(snapshot.baseRevisions['input.csv'], 1)
assert.equal(snapshot.baseRevisions['params.json'], 1)

// 3. Simulate Python Execution producing outputs:
// - /params.json modified (threshold: 25)
// - /chart.png created
// - /summary.txt created
// - /input.csv deleted in workspace
const simulatedRawOutputs = {
  '/params.json': new TextEncoder().encode(JSON.stringify({ threshold: 25 })),
  '/chart.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0]),
  '/summary.txt': new TextEncoder().encode('threshold met'),
}

const validatedFiles = validateOutputFiles(simulatedRawOutputs)

// Calculate staged changes matching PythonSessionImpl logic
const stagedChanges = []
const validatedByNormPath = new Map()

// Detect writes & modifications
for (const [outPath, outBytes] of Object.entries(validatedFiles)) {
  const normOutPath = outPath.startsWith('/') ? outPath.slice(1) : outPath
  validatedByNormPath.set(normOutPath, outBytes)
  stagedChanges.push({
    type: 'write',
    path: normOutPath,
    content: outBytes,
    encoding: 'binary',
  })
}

// Detect deletions
for (const snapPath of Object.keys(snapshot.baseRevisions)) {
  if (!validatedByNormPath.has(snapPath)) {
    stagedChanges.push({
      type: 'delete',
      path: snapPath,
    })
  }
}

assert.equal(stagedChanges.length, 4) // 1 modify, 2 new, 1 delete

// 4. Stage and commit
const stagingSession = workspace.stageChanges(snapshot, stagedChanges)
const commitResult = await workspace.commitStagedChanges(stagingSession)

assert.equal(commitResult.success, true)
assert.equal(commitResult.committed.length, 3)
assert.equal(commitResult.deleted.length, 1)
assert.equal(commitResult.deleted[0], 'input.csv')

// 5. Verify persistent workspace state after commit
const currentFiles = await workspace.listFiles()
assert.equal(currentFiles.length, 3)

const deletedCheck = await workspace.readFile('/input.csv')
assert.equal(deletedCheck, null)

const paramsFile = await workspace.readFile('/params.json')
assert.equal(JSON.parse(paramsFile.content).threshold, 25)
assert.equal(paramsFile.version, 2)

const chartFile = await workspace.readFileBytes('/chart.png')
assert.ok(chartFile)
assert.equal(chartFile.data[0], 137)
assert.equal(chartFile.data[1], 80)

// 6. Concurrency conflict check:
// If snapshot is stale when committing, commit must fail with StaleRevisionError
const staleSnapshot = await workspace.createExecutionSnapshot()
// Modify a file out-of-band in workspace
await workspace.writeFile('/summary.txt', 'updated concurrently', 'utf-8')

const conflictingStaging = workspace.stageChanges(staleSnapshot, [
  {
    type: 'write',
    path: '/summary.txt',
    content: new TextEncoder().encode('python output'),
    encoding: 'binary',
  },
])

await assert.rejects(
  () => workspace.commitStagedChanges(conflictingStaging),
  /Conflict|version mismatch/i,
)

console.log('Python workspace snapshot and staging integration tests passed successfully!')

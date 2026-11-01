import assert from 'node:assert/strict'
import {
  WorkspaceManager,
  MemoryFileStore,
  MemoryRecordStore,
  StaleRevisionError,
  QuotaExceededError,
} from '../dist/index.js'

console.log('Running Python execution snapshot and staging tests...')

const fileStore = new MemoryFileStore()
const recordStore = new MemoryRecordStore()
const manager = new WorkspaceManager({
  fileStore,
  recordStore,
  limits: {
    maxFileBytes: 1000,
    maxWorkspaceBytes: 1500,
  },
})

const chat = await manager.createChat('Python Staging Chat')
const ws = manager.getWorkspace(chat.id)

// Setup initial committed files
await ws.writeFile('main.py', 'print("hello world")')
await ws.writeFile('data.csv', 'id,val\n1,10\n')

// 1. Create execution snapshot
const snapshot = await ws.createExecutionSnapshot()
assert.equal(snapshot.chatId, chat.id)
assert.equal(snapshot.files.length, 2)
assert.equal(snapshot.baseRevisions['main.py'], 1)
assert.equal(snapshot.baseRevisions['data.csv'], 1)

// 2. Stage changes (simulate Python producing an output file and modifying data.csv)
const session = ws.stageChanges(snapshot, [
  {
    type: 'write',
    path: 'output.txt',
    content: 'Execution results: OK',
  },
  {
    type: 'write',
    path: 'data.csv',
    content: 'id,val\n1,10\n2,20\n',
  },
])

// Verify staging does not affect authoritative storage before commit
assert.equal(await ws.readFile('output.txt'), null)
const uncommittedData = await ws.readFile('data.csv')
assert.equal(uncommittedData?.content, 'id,val\n1,10\n')

// 3. Commit staged changes successfully
const commitResult = await ws.commitStagedChanges(session)
assert.equal(commitResult.success, true)
assert.deepEqual(commitResult.committed.sort(), ['data.csv', 'output.txt'])
assert.equal(commitResult.revisions['data.csv'], 2)
assert.equal(commitResult.revisions['output.txt'], 1)

// Authoritative storage is now updated
const committedOutput = await ws.readFile('output.txt')
assert.equal(committedOutput?.content, 'Execution results: OK')
const committedData = await ws.readFile('data.csv')
assert.equal(committedData?.content, 'id,val\n1,10\n2,20\n')

// 4. Stale revision detection (concurrent modification conflict)
const snap2 = await ws.createExecutionSnapshot()

// External modification happens in workspace before Python commits
await ws.writeFile('data.csv', 'id,val\n1,10\n2,999\n')

// Python tries to commit based on older snapshot
const sessionConflict = ws.stageChanges(snap2, [
  {
    type: 'write',
    path: 'data.csv',
    content: 'id,val\n1,10\n2,20\n3,30\n',
  },
])

await assert.rejects(
  () => ws.commitStagedChanges(sessionConflict),
  StaleRevisionError,
)

// Data in workspace must remain as the external modification
const preservedData = await ws.readFile('data.csv')
assert.equal(preservedData?.content, 'id,val\n1,10\n2,999\n')

// 5. Cancellation and discard
const snap3 = await ws.createExecutionSnapshot()
const cancelledSession = ws.stageChanges(snap3, [
  {
    type: 'write',
    path: 'should_never_exist.txt',
    content: 'temp work',
  },
  {
    type: 'delete',
    path: 'main.py',
  },
])

// Simulate user cancelling run
ws.discardStagedChanges(cancelledSession)

assert.equal(await ws.readFile('should_never_exist.txt'), null)
const preservedMain = await ws.readFile('main.py')
assert.equal(preservedMain?.content, 'print("hello world")')

// Cannot commit discarded session
await assert.rejects(
  () => ws.commitStagedChanges(cancelledSession),
  Error,
)

// 6. Rollback on failure (e.g. quota limit exceeded during commit)
const snap4 = await ws.createExecutionSnapshot()
// Total workspace limit is 1500 bytes. Current usage ~100 bytes.
// Stage two writes: first write is 300 bytes (fits), second is 2000 bytes (exceeds limit!)
const fitContent = new Uint8Array(300)
fitContent.fill(65) // 'A'
const overflowContent = new Uint8Array(2000)

const failSession = ws.stageChanges(snap4, [
  {
    type: 'write',
    path: 'step1.bin',
    content: fitContent,
  },
  {
    type: 'write',
    path: 'step2_overflow.bin',
    content: overflowContent,
  },
])

await assert.rejects(
  () => ws.commitStagedChanges(failSession),
  QuotaExceededError,
)

// Crucial: Step 1 MUST HAVE BEEN ROLLED BACK because step 2 failed!
assert.equal(await ws.readFile('step1.bin'), null)
assert.equal(await ws.readFile('step2_overflow.bin'), null)

console.log('Python execution snapshot and staging tests passed successfully!')

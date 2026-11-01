import assert from 'node:assert/strict'
import {
  isIndexedDBAvailable,
  IndexedDbRecordStore,
  isOPFSAvailable,
  OPFSFileStore,
  WorkspaceManager,
  StorageUnavailableError,
} from '../dist/index.js'

console.log('Running storage capability detection and fallback tests...')

// 1. Detection in Node environment
assert.equal(isIndexedDBAvailable(), false)
assert.equal(isOPFSAvailable(), false)

// 2. Direct instantiation in unsupported environment throws StorageUnavailableError
const idbStore = new IndexedDbRecordStore('test_db')
await assert.rejects(
  () => idbStore.createChat({
    id: 'test',
    title: 'test',
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  StorageUnavailableError,
)

const opfsStore = new OPFSFileStore()
await assert.rejects(
  () => opfsStore.writeBytes('chat_1', 'file.txt', new Uint8Array([1, 2, 3])),
  StorageUnavailableError,
)

// 3. WorkspaceManager automatic fallback
const defaultManager = new WorkspaceManager()
const status = defaultManager.getStorageStatus()
assert.equal(status.isDurable, false)
assert.equal(status.backend, 'memory')
assert.ok(status.warning)
assert.ok(status.warning.includes('unavailable'))

// Ensure workspace functions completely under fallback
const chat = await defaultManager.createChat('Fallback Chat')
const ws = defaultManager.getWorkspace(chat.id)
await ws.writeFile('hello.txt', 'Working in fallback mode')
const readBack = await ws.readFile('hello.txt')
assert.equal(readBack?.content, 'Working in fallback mode')

console.log('Storage capability detection and fallback tests passed successfully!')

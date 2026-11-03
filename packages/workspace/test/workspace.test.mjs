import assert from 'node:assert/strict'
import {
  WorkspaceManager,
  MemoryFileStore,
  MemoryRecordStore,
  QuotaExceededError,
  NotFoundError,
  WorkspaceError,
} from '../dist/index.js'

console.log('Running workspace file operations and isolation tests...')

const fileStore = new MemoryFileStore()
const recordStore = new MemoryRecordStore()
const manager = new WorkspaceManager({
  fileStore,
  recordStore,
  limits: {
    maxFileBytes: 1024, // 1 KB per-file for easy testing
    maxWorkspaceBytes: 2048, // 2 KB total
  },
})

// 1. Create chats
const chatA = await manager.createChat('Chat A')
const chatB = await manager.createChat('Chat B')

const wsA = manager.getWorkspace(chatA.id)
const wsB = manager.getWorkspace(chatB.id)

// 2. Byte-for-byte text import and read
const sampleText = 'Hello world! 🌍 Unicode and newlines\nLine 2\nLine 3'
const metaText = await wsA.writeFile('notes/report.txt', sampleText)
assert.equal(metaText.path, 'notes/report.txt')
assert.equal(metaText.version, 1)
assert.equal(metaText.size, new TextEncoder().encode(sampleText).length)

const readBackText = await wsA.readFile('notes/report.txt')
assert.ok(readBackText)
assert.equal(readBackText.content, sampleText)
assert.equal(readBackText.encoding, 'utf-8')

// 3. Byte-for-byte binary import and export
const binaryBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x12, 0xff])
const metaBin = await wsA.writeFile('images/chart.png', binaryBytes)
assert.equal(metaBin.path, 'images/chart.png')
assert.equal(metaBin.mimeType, 'image/png')
assert.equal(metaBin.size, binaryBytes.length)

const readBackBin = await wsA.readFileBytes('images/chart.png')
assert.deepEqual(readBackBin.data, binaryBytes)

const exportedFile = await wsA.exportFile('images/chart.png')
assert.equal(exportedFile.filename, 'chart.png')
assert.equal(exportedFile.mimeType, 'image/png')
assert.deepEqual(exportedFile.data, binaryBytes)

// 4. Bounded reads
const multiline = '0123456789\nABCDEFGHIJ\nKLMNOPQRST'
await wsA.writeFile('bounded.txt', multiline)

// Read first 10 bytes
const bounded1 = await wsA.readBounded('bounded.txt', { start: 0, maxBytes: 10 })
assert.equal(bounded1.text(), '0123456789')
assert.equal(bounded1.isTruncated, true)

// Read middle slice
const bounded2 = await wsA.readBounded('bounded.txt', { start: 11, end: 21 })
assert.equal(bounded2.text(), 'ABCDEFGHIJ')

// 5. Text editing
await wsA.writeFile('code.py', 'x = 1\ny = 2\nz = 1\n')
const editedMeta = await wsA.editFile('code.py', {
  target: 'x = 1',
  replacement: 'x = 10',
})
assert.equal(editedMeta.version, 2)
const editedFile = await wsA.readFile('code.py')
assert.ok(editedFile)
assert.ok(editedFile.content.includes('x = 10'))
assert.ok(editedFile.content.includes('z = 1'))

// Replace all
await wsA.editFile('code.py', {
  target: '1',
  replacement: '99',
  replaceAll: true,
})
const replacedAll = await wsA.readFile('code.py')
assert.ok(replacedAll?.content.includes('x = 990'))
assert.ok(replacedAll?.content.includes('z = 99'))

// Edit missing target should throw
await assert.rejects(
  () => wsA.editFile('code.py', { target: 'nonexistent_target', replacement: 'foo' }),
  WorkspaceError,
)

// 6. Cross-chat isolation
// Chat B cannot see or read chat A files
assert.equal(await wsB.readFile('notes/report.txt'), null)
await assert.rejects(() => wsB.readFileBytes('notes/report.txt'), NotFoundError)

const filesA = await wsA.listFiles()
assert.ok(filesA.some(f => f.path === 'notes/report.txt'))

const filesB = await wsB.listFiles()
assert.equal(filesB.length, 0)

// 7. Quota enforcement
// Per-file limit exceeds 1024 bytes
const bigData = new Uint8Array(1025)
await assert.rejects(
  () => wsA.writeFile('too_big.dat', bigData),
  QuotaExceededError,
)

// Total workspace quota (limit is 2048)
const file1 = new Uint8Array(900)
const file2 = new Uint8Array(900)
await wsB.writeFile('file1.dat', file1)
await wsB.writeFile('file2.dat', file2)

// Next write exceeds 2048 total
const file3 = new Uint8Array(400)
await assert.rejects(
  () => wsB.writeFile('file3.dat', file3),
  QuotaExceededError,
)

// 8. Storage usage stats & durability
const usageB = await wsB.getUsage()
assert.equal(usageB.fileCount, 2)
assert.equal(usageB.totalBytes, 1800)
assert.equal(usageB.maxWorkspaceBytes, 2048)
assert.equal(usageB.maxFileBytes, 1024)
assert.equal(usageB.backend, 'memory')
assert.equal(usageB.isDurable, false)

const status = manager.getStorageStatus()
assert.equal(status.isDurable, false)
assert.ok(status.warning)

// 9. Export chat archive
const exportedArchive = await manager.exportChat(chatA.id)
assert.equal(exportedArchive.chat.id, chatA.id)
assert.ok(exportedArchive.files.some(f => f.path === 'notes/report.txt'))
assert.ok(exportedArchive.files.some(f => f.path === 'images/chart.png'))

// 10. Deleting chat cleans up workspace files
await manager.deleteChat(chatA.id)
assert.equal(await wsA.readFile('notes/report.txt'), null)
assert.equal((await wsA.listFiles()).length, 0)

console.log('Workspace file operations and isolation tests passed successfully!')

// Large binary reads and archive listing must not spread bytes as function args.
{
  const largeManager = new WorkspaceManager({
    limits: {
      maxFileBytes: 2 * 1024 * 1024,
      maxWorkspaceBytes: 3 * 1024 * 1024,
    },
  })
  const largeChat = await largeManager.createChat('Large Binary Chat')
  const largeWorkspace = largeManager.getWorkspace(largeChat.id)
  const largeBytes = Uint8Array.from({ length: 1024 * 1024 + 31 }, (_, index) => index % 256)
  await largeWorkspace.writeFile('housing_plots.png', largeBytes)

  const largeFile = await largeWorkspace.readFile('housing_plots.png')
  assert.ok(largeFile)
  assert.equal(largeFile.encoding, 'base64')
  assert.deepEqual(Uint8Array.from(atob(largeFile.content), char => char.charCodeAt(0)), largeBytes)

  const listedFiles = await largeWorkspace.listFiles()
  assert.equal(listedFiles.length, 1)
  assert.equal(listedFiles[0].content, largeFile.content)
  const exportedFile = await largeWorkspace.exportFile('housing_plots.png')
  assert.deepEqual(exportedFile.data, largeBytes)

  const archive = await largeManager.exportChat(largeChat.id)
  assert.equal(archive.files.length, 1)
  assert.equal(archive.files[0].content, largeFile.content)
  assert.deepEqual(
    Uint8Array.from(atob(archive.files[0].content), char => char.charCodeAt(0)),
    largeBytes,
  )
}
console.log('Large binary read, list, and export checks passed!')

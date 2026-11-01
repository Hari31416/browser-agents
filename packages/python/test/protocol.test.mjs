import assert from 'node:assert/strict'
import {
  isValidExecutionPath,
  validateOutputFiles,
  DEFAULT_EXECUTION_LIMITS,
} from '../dist/security.js'
import {
  PythonError,
  PythonExecutionError,
  PythonTimeoutError,
  PythonCancelledError,
  PythonInitializationError,
  PythonSecurityError,
  PythonStorageError,
} from '../dist/errors.js'
import { AssetLoader } from '../dist/assets.js'

console.log('Running Python execution protocol and security tests...')

// 1. Path validation tests
assert.equal(isValidExecutionPath('/file.txt'), true)
assert.equal(isValidExecutionPath('/data/sub/file.csv'), true)
assert.equal(isValidExecutionPath('/chart-2026.png'), true)
assert.equal(isValidExecutionPath('/.hidden'), true)

// Traversal attacks
assert.equal(isValidExecutionPath('file.txt'), false, 'Must start with slash')
assert.equal(isValidExecutionPath('/'), false, 'Root slash alone is invalid')
assert.equal(isValidExecutionPath('/..'), false, 'Root parent is invalid')
assert.equal(isValidExecutionPath('/.'), false, 'Dot alone is invalid')
assert.equal(isValidExecutionPath('/../outside.txt'), false, 'Traversal must be blocked')
assert.equal(isValidExecutionPath('/data/../../etc/passwd'), false, 'Nested traversal must be blocked')
assert.equal(isValidExecutionPath('/data//file.txt'), false, 'Empty segment is invalid')
assert.equal(isValidExecutionPath('/data/\0file.txt'), false, 'Null byte is invalid')
assert.equal(isValidExecutionPath('/data/bad;file.txt'), false, 'Special shell characters invalid')

// 2. Output files validation
const safeFiles = {
  '/result.txt': new TextEncoder().encode('success'),
  '/chart.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
}
const validated = validateOutputFiles(safeFiles)
assert.equal(Object.keys(validated).length, 2)
assert.deepEqual(validated['/result.txt'], safeFiles['/result.txt'])

// Rejection of invalid payload types
assert.throws(() => validateOutputFiles(null), PythonSecurityError)
assert.throws(() => validateOutputFiles([1, 2, 3]), PythonSecurityError)
assert.throws(() => validateOutputFiles({ '/bad/../path': new Uint8Array([1]) }), PythonSecurityError)
assert.throws(() => validateOutputFiles({ '/not-bytes': 'string' }), PythonSecurityError)

// Quota and count limits
assert.throws(
  () =>
    validateOutputFiles(
      { '/big.bin': new Uint8Array(6_000_000) },
      { maxFileSizeBytes: 5_000_000 },
    ),
  PythonSecurityError,
)

assert.throws(
  () =>
    validateOutputFiles(
      {
        '/f1.bin': new Uint8Array(6_000_000),
        '/f2.bin': new Uint8Array(6_000_000),
      },
      { maxFileSizeBytes: 10_000_000, maxTotalFilesBytes: 10_000_000 },
    ),
  PythonSecurityError,
)

const manyFiles = {}
for (let i = 0; i < 105; i++) {
  manyFiles[`/file_${i}.txt`] = new Uint8Array([1])
}
assert.throws(() => validateOutputFiles(manyFiles, { maxFileCount: 100 }), PythonSecurityError)

// 3. Error hierarchies
const execErr = new PythonExecutionError('syntax error', 'out', 'err', 1)
assert.ok(execErr instanceof PythonError)
assert.equal(execErr.stdout, 'out')
assert.equal(execErr.stderr, 'err')
assert.equal(execErr.exitCode, 1)

const timeoutErr = new PythonTimeoutError(5000)
assert.ok(timeoutErr instanceof PythonError)
assert.equal(timeoutErr.timeoutMs, 5000)

const cancelErr = new PythonCancelledError()
assert.ok(cancelErr instanceof PythonError)

const initErr = new PythonInitializationError('boot failed')
assert.ok(initErr instanceof PythonError)

const secErr = new PythonSecurityError('forbidden')
assert.ok(secErr instanceof PythonError)

const storeErr = new PythonStorageError('commit failed')
assert.ok(storeErr instanceof PythonError)

// 4. AssetLoader cache
AssetLoader.clearCache()
assert.equal(AssetLoader.getCachedAssets(), null)
AssetLoader.setCachedAssets({ 'test.wasm': new Uint8Array([1, 2, 3]) })
assert.equal(AssetLoader.getCachedAssets()?.['test.wasm']?.length, 3)
AssetLoader.clearCache()

console.log('Python execution protocol and security tests passed successfully!')

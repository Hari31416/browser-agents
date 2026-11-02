import assert from 'node:assert/strict'
import { normalizePath, getMimeType } from '../dist/path.js'
import { InvalidPathError } from '../dist/errors.js'

console.log('Running path normalization and security tests...')

// 1. Basic path normalization
assert.equal(normalizePath('data.csv'), 'data.csv')
assert.equal(normalizePath('./data.csv'), 'data.csv')
assert.equal(normalizePath('/data.csv'), 'data.csv')
assert.equal(normalizePath('folder/subfolder/file.txt'), 'folder/subfolder/file.txt')
assert.equal(normalizePath('./folder/./subfolder//file.txt'), 'folder/subfolder/file.txt')
assert.equal(normalizePath('folder/nested/../file.txt'), 'folder/file.txt')
assert.equal(normalizePath('a/b/c/../../d/file.py'), 'a/d/file.py')

// 2. Traversal rejection (escaping workspace root)
assert.throws(() => normalizePath('..'), InvalidPathError)
assert.throws(() => normalizePath('../'), InvalidPathError)
assert.throws(() => normalizePath('../../secret.txt'), InvalidPathError)
assert.throws(() => normalizePath('folder/../../escape.txt'), InvalidPathError)
assert.throws(() => normalizePath('a/b/../../../etc/passwd'), InvalidPathError)
assert.throws(() => normalizePath('/../foo'), InvalidPathError)

// 3. Null bytes and control characters
assert.throws(() => normalizePath('file\0.txt'), InvalidPathError)
assert.throws(() => normalizePath('file\x1b.txt'), InvalidPathError)
assert.throws(() => normalizePath('file\x7f.txt'), InvalidPathError)

// 4. Windows drive letters and UNC paths
assert.throws(() => normalizePath('C:\\Windows\\System32'), InvalidPathError)
assert.throws(() => normalizePath('D:file.txt'), InvalidPathError)
assert.throws(() => normalizePath('\\\\server\\share\\file.txt'), InvalidPathError)

// 5. Empty and whitespace-only paths
assert.throws(() => normalizePath(''), InvalidPathError)
assert.throws(() => normalizePath('   '), InvalidPathError)
assert.throws(() => normalizePath('.'), InvalidPathError)
assert.throws(() => normalizePath('./'), InvalidPathError)
assert.throws(() => normalizePath('///'), InvalidPathError)

// 5b. Root path allowed when allowRoot is enabled
assert.equal(normalizePath('/', { allowRoot: true }), '/')
assert.equal(normalizePath('.', { allowRoot: true }), '/')
assert.equal(normalizePath('./', { allowRoot: true }), '/')
assert.equal(normalizePath('', { allowRoot: true }), '/')
assert.equal(normalizePath('///', { allowRoot: true }), '/')
assert.throws(() => normalizePath('..', { allowRoot: true }), InvalidPathError)
assert.throws(() => normalizePath('../../secret.txt', { allowRoot: true }), InvalidPathError)

// 6. MIME type resolution
assert.equal(getMimeType('data.csv'), 'text/csv')
assert.equal(getMimeType('report.md'), 'text/markdown')
assert.equal(getMimeType('script.py'), 'text/x-python')
assert.equal(getMimeType('app.json'), 'application/json')
assert.equal(getMimeType('chart.png'), 'image/png')
assert.equal(getMimeType('document.pdf'), 'application/pdf')
assert.equal(getMimeType('unknown_file'), 'application/octet-stream')

console.log('Path normalization and security tests passed successfully!')

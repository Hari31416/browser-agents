import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

for (const owner of ['deepagents', '@langchain/core']) {
  const require = createRequire(import.meta.resolve(owner))
  const pkg = require('langsmith/package.json')
  const root = dirname(require.resolve('langsmith/package.json'))
  const old = pkg.version === '0.9.0'
  const helper = await import(pathToFileURL(root + (old ? '/dist/utils/async_context.js' : '/lib/utils/async_context.mjs')))
  assert.equal(helper.hasNativeAsyncStorage, true)
  const storage = helper.createNativeAsyncStorage()
  const observed = await Promise.all(['A', 'B'].map(value => storage.run(value, async () => {
    await delay(value === 'A' ? 8 : 2)
    const snapshot = helper.captureNativeSnapshot()
    await delay(3)
    return snapshot(() => storage.getStore())
  })))
  assert.deepEqual(observed, ['A', 'B'])
  assert.equal(storage.getStore(), undefined)
  const { traceable } = await import(pathToFileURL(root + (old ? '/traceable.js' : '/traceable.mjs')))
  const wrapped = traceable(async function* () {
    await delay(1)
    yield 'one'
    await delay(1)
    yield 'two'
  }, { tracingEnabled: false })
  const chunks = []
  for await (const value of wrapped()) chunks.push(value)
  assert.deepEqual(chunks, ['one', 'two'])
}

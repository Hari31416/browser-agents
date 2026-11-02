import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium } from '../../../experiments/phase0/node_modules/playwright/index.mjs'

const root = resolve('apps/demo/dist')
const server = createServer(async (req, res) => {
  try {
    const path = req.url === '/' ? '/index.html' : req.url.split('?')[0]
    const file = resolve(root, `.${path}`)
    if (!file.startsWith(`${root}/`)) { res.writeHead(403).end(); return }
    const data = await readFile(file)
    res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)] || 'application/octet-stream')
    res.end(data)
  } catch { res.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
try {
  const page = await browser.newPage()
  const relayRequests = []
  const directRequests = []
  await page.route('https://fixture.example/v1/**', async route => {
    directRequests.push(route.request())
    await route.fulfill({ json: { data: [{ id: 'fixture-model' }] } })
  })
  await page.route('http://127.0.0.1:8765/**', async route => {
    const req = route.request()
    relayRequests.push(req)
    if (req.method() === 'DELETE') { await route.fulfill({ status: 204 }); return }
    await route.fulfill({ json: req.url().endsWith('/api/session')
      ? { session_token: 'synthetic-session' }
      : { provider_id: 'synthetic-provider', base_url: 'https://fixture.example/v1', has_api_key: true, discovered_models: ['fixture-model'] } })
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const openSettings = () => page.getByRole('button', { name: 'Open model endpoint settings' }).click()
  await openSettings()
  assert.equal(await page.locator('#connection-mode').inputValue(), 'direct')
  assert.equal(await page.locator('#input-relay-url').count(), 0)
  await page.locator('#input-base-url').fill('https://fixture.example/v1')
  await page.locator('#input-api-key').fill('synthetic-browser-key')
  await page.locator('#save-api-key-checkbox').check()
  await page.getByRole('button', { name: 'Test Connection & Discover Models' }).click()
  await page.getByText('Connection successful. Select a model and save.').waitFor()
  assert.equal(directRequests[0].headers().authorization, 'Bearer synthetic-browser-key')
  assert.equal(relayRequests.length, 0)
  await page.getByRole('button', { name: 'Save Preferences' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.reload()
  await openSettings()
  assert.equal(await page.locator('#input-api-key').inputValue(), 'synthetic-browser-key')
  await page.locator('#connection-mode').selectOption('relay')
  await page.locator('#input-relay-url').waitFor()
  await page.getByRole('button', { name: 'Save Preferences' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.ok(relayRequests.some(req => req.url().endsWith('/api/providers')))
  await page.reload()
  await openSettings()
  assert.equal(await page.locator('#connection-mode').inputValue(), 'relay')
  await page.locator('#save-api-key-checkbox').uncheck()
  await page.getByRole('button', { name: 'Save Preferences' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.ok(!(await page.evaluate(() => localStorage.getItem('browser_agents_preferences_v1'))).includes('synthetic-browser-key'))
  await openSettings()
  await page.locator('#input-base-url').fill('https://other.example/v1')
  assert.equal(await page.locator('#input-api-key').inputValue(), '')
  console.log('Chrome settings: direct discovery without relay, saved-key reload, relay selection/reconnect, key removal, and endpoint key clearing passed.')
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}

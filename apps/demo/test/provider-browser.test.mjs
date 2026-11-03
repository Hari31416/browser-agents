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

  const chatPage = await browser.newPage()
  await chatPage.addInitScript(() => {
    localStorage.setItem('browser_agents_preferences_v1', JSON.stringify({
      connectionMode: 'direct',
      relayUrl: 'http://127.0.0.1:8765',
      providerName: 'Synthetic browser endpoint',
      baseUrl: 'https://fixture.example/v1',
      selectedModel: 'fixture-model',
      customModel: '',
      isFixtureMode: false,
      saveApiKey: false,
      savedApiKey: '',
    }))
  })

  let releaseFirstCompletion
  const firstResponseGate = new Promise(resolve => { releaseFirstCompletion = resolve })
  let releaseDeleteCompletion
  const deleteResponseGate = new Promise(resolve => { releaseDeleteCompletion = resolve })
  let chatRequestCount = 0
  const sseResponse = events => `${events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
  await chatPage.route('https://fixture.example/v1/chat/completions', async route => {
    chatRequestCount++
    if (chatRequestCount === 1) {
      await firstResponseGate
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseResponse([
          { choices: [{ delta: { tool_calls: [
            { index: 0, id: 'switch-plan', type: 'function', function: { name: 'write_todos', arguments: '{"todos":[{"content":"Finish chat A plan","status":"completed"}]}' } },
            { index: 1, id: 'switch-python', type: 'function', function: { name: 'execute_python', arguments: '{"code":"open(\\\"a-result.txt\\\", \\\"w\\\").write(\\\"from chat A\\\")"}' } },
          ] } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ]),
      })
    } else if (chatRequestCount === 2) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseResponse([{ choices: [{ delta: { content: 'A completed response' } }] }]),
      })
    } else {
      await deleteResponseGate
      try {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: sseResponse([{ choices: [{ delta: { content: 'Deleted run response' } }] }]),
        })
      } catch {
        // Deleting the chat aborts this in-flight request.
      }
    }
  })

  await chatPage.goto(`http://127.0.0.1:${server.address().port}`)
  const welcomeChat = chatPage.locator('[role="button"]').filter({ hasText: 'Welcome Analysis' })
  await welcomeChat.waitFor()
  await chatPage.waitForFunction(() => {
    const composer = document.querySelector('textarea[aria-label="Agent prompt input"]')
    return composer && !composer.disabled
  }, null, { timeout: 20_000 })
  await welcomeChat.click()
  await chatPage.getByLabel('Agent prompt input').fill('A pending prompt')
  const firstRequestSeen = chatPage.waitForRequest(request => request.url().endsWith('/chat/completions'), { timeout: 20_000 })
  await chatPage.getByRole('button', { name: 'Send message to agent' }).click()
  await firstRequestSeen

  await chatPage.getByRole('button', { name: 'Create a new chat' }).click()
  await chatPage.getByText('Chat 2', { exact: true }).waitFor()
  assert.equal(await chatPage.getByLabel('Agent prompt input').isDisabled(), true)
  assert.equal(await chatPage.getByText('A pending prompt', { exact: true }).count(), 0)
  releaseFirstCompletion()
  await chatPage.waitForFunction(() => {
    const composer = document.querySelector('textarea[aria-label="Agent prompt input"]')
    return composer && !composer.disabled
  }, null, { timeout: 30_000 })
  assert.equal(await chatPage.getByText('A completed response', { exact: true }).count(), 0)
  assert.equal(await chatPage.getByText('Finish chat A plan', { exact: true }).count(), 0)
  assert.equal(await chatPage.getByText('a-result.txt', { exact: true }).count(), 0)

  await welcomeChat.click()
  await chatPage.getByText('A completed response', { exact: true }).waitFor()
  await chatPage.getByText('A pending prompt', { exact: true }).waitFor()
  await chatPage.getByText('Finish chat A plan', { exact: true }).waitFor()
  await chatPage.getByText('a-result.txt', { exact: true }).waitFor()
  await welcomeChat.click()
  assert.equal(await chatPage.getByText('A completed response', { exact: true }).count(), 1)

  await chatPage.getByLabel('Agent prompt input').fill('Delete chat while running')
  const deleteRequestSeen = chatPage.waitForRequest(request => request.url().endsWith('/chat/completions'), { timeout: 20_000 })
  await chatPage.getByRole('button', { name: 'Send message to agent' }).click()
  await deleteRequestSeen
  chatPage.once('dialog', dialog => dialog.accept())
  await chatPage.getByRole('button', { name: 'Delete Welcome Analysis', exact: true }).click()
  releaseDeleteCompletion()
  await chatPage.getByText('Welcome Analysis', { exact: true }).waitFor({ state: 'detached' })
  await chatPage.waitForFunction(() => {
    const composer = document.querySelector('textarea[aria-label="Agent prompt input"]')
    return composer && !composer.disabled
  }, null, { timeout: 30_000 })
  assert.equal(await chatPage.getByText('Deleted run response', { exact: true }).count(), 0)
  console.log('Chrome chat switching: delayed chat A completion stayed out of chat B, reloaded A correctly, same-chat selection preserved the view, and deleting an active chat cancelled it cleanly.')
  await chatPage.close()
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}

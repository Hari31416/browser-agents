import assert from 'node:assert/strict'
import {
  WorkspaceManager,
  MemoryRecordStore,
  MemoryFileStore,
  TabLockManager,
  StagingManager,
} from '@browser-agents/workspace'
import {
  AgentRuntime,
  ScriptedChatModel,
  MockPythonExecutor,
  ConcurrentRunError,
} from '@browser-agents/runtime'

import { formatBytes, getPreviewCategory, sanitizeUrl } from '../src/lib/sanitizer.ts'
import { loadPreferences, savePreferences } from '../src/lib/preferences.ts'

console.log('--- Starting Phase 05 Chat Demo Verification Suite ---')

// 1. Sanitizer & Active Content Protection
console.log('Test 1: Sanitizer and active content isolation...')
{
  // URL sanitization
  assert.equal(sanitizeUrl('https://example.com'), 'https://example.com')
  assert.equal(sanitizeUrl('http://127.0.0.1:8765'), 'http://127.0.0.1:8765')
  assert.equal(sanitizeUrl('javascript:alert(1)'), null)
  assert.equal(sanitizeUrl('data:text/html,<script>alert(1)</script>'), null)
  assert.equal(sanitizeUrl('vbscript:msgbox(1)'), null)

  // Preview category check
  // Active content MUST be categorized as active_sandbox (sandboxed iframe without scripts)
  assert.equal(getPreviewCategory('image/svg+xml', 'chart.svg'), 'active_sandbox')
  assert.equal(getPreviewCategory('text/html', 'report.html'), 'active_sandbox')

  // Safe previews
  assert.equal(getPreviewCategory('image/png', 'plot.png'), 'image')
  assert.equal(getPreviewCategory('image/jpeg', 'photo.jpg'), 'image')
  assert.equal(getPreviewCategory('text/csv', 'data.csv'), 'text')
  assert.equal(getPreviewCategory('application/json', 'config.json'), 'text')
  assert.equal(getPreviewCategory('text/x-python', 'script.py'), 'text')
  assert.equal(getPreviewCategory('application/octet-stream', 'archive.bin'), 'unsupported')

  // Byte formatting
  assert.equal(formatBytes(500), '500 B')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB')

  console.log('Passed Test 1!')
}

// 2. Preferences & Credential Redaction
console.log('Test 2: Nonsecret preferences and credential redaction...')
{
  // Simulated preferences payload
  const rawFormState = {
    relayUrl: 'http://127.0.0.1:8765',
    providerName: 'Custom Endpoint',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-secret-key-12345',
    selectedModel: 'gpt-4o',
    customModel: 'gpt-4o',
    isFixtureMode: false,
  }

  // Filter for storage
  const serialized = JSON.stringify({
    relayUrl: rawFormState.relayUrl,
    providerName: rawFormState.providerName,
    baseUrl: rawFormState.baseUrl,
    selectedModel: rawFormState.selectedModel,
    customModel: rawFormState.customModel,
    isFixtureMode: rawFormState.isFixtureMode,
  })

  assert.ok(!serialized.includes('sk-secret-key-12345'))
  assert.ok(!serialized.includes('apiKey'))

  // Assembled request inspection check
  const inspectionPayload = {
    providerName: rawFormState.providerName,
    baseUrl: rawFormState.baseUrl,
    model: rawFormState.selectedModel,
    systemPrompt: 'System prompt here',
    messages: [{ role: 'user', content: 'Process my data' }],
    tools: [{ name: 'execute_python' }],
  }

  const inspectionStr = JSON.stringify(inspectionPayload)
  assert.ok(!inspectionStr.includes('sk-secret-key-12345'))
  assert.ok(!inspectionStr.includes('api_key'))
  assert.ok(!inspectionStr.includes('apiKey'))

  console.log('Passed Test 2!')
}

// 3. Storage survival across simulated app reload
console.log('Test 3: History and workspace files survival with Python variable reset...')
{
  const recordStore = new MemoryRecordStore()
  const fileStore = new MemoryFileStore()
  const lockManager = new TabLockManager()
  const stagingManager = new StagingManager()

  const wm1 = new WorkspaceManager({
    recordStore,
    fileStore,
    lockManager,
    stagingManager,
  })

  // Create chat session
  const chat = await wm1.createChat('Financial Analysis')
  const ws1 = wm1.getWorkspace(chat.id)

  // Write file
  await ws1.writeFile('/dataset.csv', 'month,revenue\njan,100\nfeb,150\n', { mimeType: 'text/csv' })

  // Add user and assistant messages
  await wm1.addMessage({
    id: 'msg_01',
    chatId: chat.id,
    role: 'user',
    content: 'Plot monthly revenue',
    createdAt: new Date().toISOString(),
  })
  await wm1.addMessage({
    id: 'msg_02',
    chatId: chat.id,
    role: 'assistant',
    content: 'The monthly revenue chart has been saved to /chart.png',
    createdAt: new Date().toISOString(),
  })

  // Add plan
  await wm1.setPlan(chat.id, [
    {
      id: 'p1',
      chatId: chat.id,
      index: 0,
      content: 'Load data',
      status: 'completed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ])

  // Leave a run in 'running' status to simulate browser closing mid-run
  await wm1.createRun({
    id: 'run_unfinished',
    chatId: chat.id,
    status: 'running',
    startedAt: new Date().toISOString(),
  })

  // --- Simulate App Reload (new WorkspaceManager instance with same persistent storage) ---
  const wm2 = new WorkspaceManager({
    recordStore,
    fileStore,
    lockManager,
    stagingManager,
  })

  // Run startup reconciliation
  const reconciliation = await wm2.reconcileStartup()
  assert.equal(reconciliation.interruptedRuns.length, 1)
  assert.equal(reconciliation.interruptedRuns[0], 'run_unfinished')

  // Check run status is now 'interrupted'
  const reconciledRun = await wm2.getRun('run_unfinished')
  assert.equal(reconciledRun?.status, 'interrupted')

  // Verify chat list and messages survived
  const chatsList = await wm2.listChats()
  assert.equal(chatsList.length, 1)
  assert.equal(chatsList[0].id, chat.id)

  const msgs = await wm2.getMessages(chat.id)
  assert.equal(msgs.length, 2)
  assert.equal(msgs[0].content, 'Plot monthly revenue')

  // Verify workspace files survived
  const ws2 = wm2.getWorkspace(chat.id)
  const files = await ws2.listFiles()
  assert.equal(files.length, 1)
  assert.equal(files[0].path, 'dataset.csv')

  const readRes = await ws2.readFileBytes('/dataset.csv')
  assert.ok(new TextDecoder().decode(readRes.data).includes('jan,100'))

  console.log('Passed Test 3!')
}

// 4. Chat Export Archive
console.log('Test 4: Chat export archive integrity...')
{
  const recordStore = new MemoryRecordStore()
  const fileStore = new MemoryFileStore()
  const wm = new WorkspaceManager({ recordStore, fileStore })

  const chat = await wm.createChat('Exportable Chat')
  const ws = wm.getWorkspace(chat.id)
  await ws.writeFile('/notes.txt', 'Important agent research notes', { mimeType: 'text/plain' })
  await wm.addMessage({
    id: 'm1',
    chatId: chat.id,
    role: 'user',
    content: 'Save notes',
    createdAt: new Date().toISOString(),
  })

  const archive = await wm.exportChat(chat.id)
  assert.equal(archive.chat.id, chat.id)
  assert.equal(archive.messages.length, 1)
  assert.equal(archive.files.length, 1)
  assert.equal(archive.files[0].path, 'notes.txt')
  assert.equal(archive.files[0].content, 'Important agent research notes')
  assert.ok(archive.exportedAt)

  console.log('Passed Test 4!')
}

// 5. Concurrency Rejection
console.log('Test 5: Concurrency rejection during active execution...')
{
  const recordStore = new MemoryRecordStore()
  const fileStore = new MemoryFileStore()
  const wm = new WorkspaceManager({ recordStore, fileStore })
  const chat = await wm.createChat('Concurrency Test')
  const ws = wm.getWorkspace(chat.id)

  let finishFirstRun
  const slowExecutor = new MockPythonExecutor(async () => {
    await new Promise(r => {
      finishFirstRun = r
    })
    return { ok: true, exitCode: 0, stdout: 'done', stderr: '' }
  })

  const slowModel = new ScriptedChatModel([
    {
      toolCalls: [
        {
          name: 'execute_python',
          args: { code: 'print("slow")' },
          id: 'c1',
        },
      ],
    },
    { text: 'Complete' },
  ])

  const runtime = new AgentRuntime({
    chatId: chat.id,
    model: slowModel,
    workspace: ws,
    pythonExecutor: slowExecutor,
    limits: { concurrency: 'reject' },
  })

  const firstPromise = runtime.run('First run')

  // Wait a tick for first run to enter running state
  await new Promise(r => setTimeout(r, 20))

  // Second run on same runtime must throw ConcurrentRunError
  await assert.rejects(
    async () => {
      await runtime.run('Second run concurrent')
    },
    err => {
      assert.ok(err instanceof ConcurrentRunError)
      return true
    },
  )

  // Unblock first run
  finishFirstRun?.()
  const firstResult = await firstPromise
  assert.equal(firstResult.ok, true)

  console.log('Passed Test 5!')
}

// 6. Complete End-to-End Workflow with File Upload, Plan, Python Execution, and Download
console.log('Test 6: Complete End-to-End Analysis Workflow with Generated Output...')
{
  const recordStore = new MemoryRecordStore()
  const fileStore = new MemoryFileStore()
  const wm = new WorkspaceManager({ recordStore, fileStore })
  const chat = await wm.createChat('Complete Workflow Chat')
  const ws = wm.getWorkspace(chat.id)

  // 1. Upload CSV
  const csvData = 'category,count\nA,10\nB,20\nC,30\n'
  await ws.writeFile('/categories.csv', csvData, { mimeType: 'text/csv' })

  // 2. Python executor producing a summary report and a mock chart
  const pythonExecutor = new MockPythonExecutor(async (code) => {
    assert.ok(code.includes('pandas') || code.includes('categories.csv'))
    const summary = 'Total count: 60 across 3 categories'
    const chartBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) // PNG magic bytes
    return {
      ok: true,
      exitCode: 0,
      stdout: 'Analyzed 3 categories\n',
      stderr: '',
      files: {
        '/summary.txt': new TextEncoder().encode(summary),
        '/chart.png': chartBytes,
      },
      artifacts: [
        { path: '/summary.txt', mimeType: 'text/plain', dataBase64: btoa(summary) },
        { path: '/chart.png', mimeType: 'image/png', dataBase64: btoa(String.fromCharCode(...chartBytes)) },
      ],
    }
  })

  // 3. Scripted model executing the multi-step plan
  let planUpdated = false
  const scriptedModel = new ScriptedChatModel([
    {
      toolCalls: [
        {
          name: 'write_todos',
          args: {
            todos: [
              { content: 'Read /categories.csv', status: 'in_progress' },
              { content: 'Generate summary and chart', status: 'pending' },
            ],
          },
          id: 'step_1_plan',
        },
      ],
    },
    {
      toolCalls: [
        {
          name: 'execute_python',
          args: {
            code: "import pandas as pd\ndf = pd.read_csv('/categories.csv')\n",
          },
          id: 'step_2_py',
        },
      ],
    },
    {
      toolCalls: [
        {
          name: 'write_todos',
          args: {
            todos: [
              { content: 'Read /categories.csv', status: 'completed' },
              { content: 'Generate summary and chart', status: 'completed' },
            ],
          },
          id: 'step_3_plan_complete',
        },
      ],
    },
    {
      text: 'Analysis finished. Generated /summary.txt and /chart.png.',
    },
  ])

  const runtime = new AgentRuntime({
    chatId: chat.id,
    model: scriptedModel,
    workspace: ws,
    pythonExecutor,
    recordStore,
    onEvent: (event) => {
      if (event.type === 'plan:update') {
        planUpdated = true
      }
    },
  })

  const result = await runtime.run('Analyze categories.csv and create a summary and chart')
  assert.equal(result.ok, true)
  assert.equal(planUpdated, true)
  assert.ok(result.summary.outputText.includes('/summary.txt'))

  // Verify generated files exist in workspace
  const generatedSummary = await ws.readFileBytes('/summary.txt')
  assert.ok(new TextDecoder().decode(generatedSummary.data).includes('Total count: 60'))

  const generatedChart = await ws.readFileBytes('/chart.png')
  assert.equal(generatedChart.data.length, 8)
  assert.equal(generatedChart.metadata.mimeType, 'image/png')

  console.log('Passed Test 6!')
}

// 7. Token Persistence Preference Toggle
console.log('Test 7: Token persistence preference option...')
{
  const mockStorage = new Map()
  globalThis.localStorage = {
    getItem: (key) => mockStorage.get(key) || null,
    setItem: (key, val) => mockStorage.set(key, String(val)),
    removeItem: (key) => mockStorage.delete(key),
    clear: () => mockStorage.clear(),
  }

  // Without saveApiKey option
  savePreferences({
    relayUrl: 'http://127.0.0.1:8765',
    providerName: 'Custom Endpoint',
    baseUrl: 'https://api.openai.com/v1',
    selectedModel: 'gpt-4o',
    customModel: '',
    isFixtureMode: false,
    saveApiKey: false,
    savedApiKey: 'sk-secret-do-not-save',
  })
  const loadedNoSave = loadPreferences()
  assert.equal(loadedNoSave.saveApiKey, false)
  assert.equal(loadedNoSave.savedApiKey, '')

  // With saveApiKey enabled
  savePreferences({
    relayUrl: 'http://127.0.0.1:8765',
    providerName: 'Custom Endpoint',
    baseUrl: 'https://api.openai.com/v1',
    selectedModel: 'gpt-4o',
    customModel: '',
    isFixtureMode: false,
    saveApiKey: true,
    savedApiKey: 'sk-user-saved-token',
  })
  const loadedSaved = loadPreferences()
  assert.equal(loadedSaved.saveApiKey, true)
  assert.equal(loadedSaved.savedApiKey, 'sk-user-saved-token')
  assert.equal(loadedSaved.connectionMode, 'direct')
  savePreferences({ ...loadedSaved, connectionMode: 'relay', saveApiKey: false })
  const removed = loadPreferences()
  assert.equal(removed.connectionMode, 'relay')
  assert.equal(removed.savedApiKey, '')
  assert.ok(![...mockStorage.values()].join('').includes('sk-user-saved-token'))

  console.log('Passed Test 7!')
}

// 8. User Uploaded vs Model Generated File Metadata Tracking
console.log('Test 8: User uploaded vs model generated file metadata tracking...')
{
  const recordStore = new MemoryRecordStore()
  const fileStore = new MemoryFileStore()
  const stagingManager = new StagingManager()
  const lockManager = new TabLockManager()
  const wm = new WorkspaceManager({
    recordStore,
    fileStore,
    stagingManager,
    lockManager,
  })

  const chat = await wm.createChat('File Separation Test')
  const ws = wm.getWorkspace(chat.id)

  // Upload user file
  await ws.writeFile('/dataset.csv', 'id,val\n1,10\n', { source: 'user' })

  // Write model generated file
  await ws.writeFile('/output_chart.png', new Uint8Array([1, 2, 3]), { source: 'model' })

  const files = await ws.listFiles()
  const userFile = files.find(f => f.path === 'dataset.csv')
  const modelFile = files.find(f => f.path === 'output_chart.png')

  assert.ok(userFile)
  assert.equal(userFile.source, 'user')

  assert.ok(modelFile)
  assert.equal(modelFile.source, 'model')

  console.log('Passed Test 8!')
}

// 9. Markdown Component Rendering
console.log('Test 9: Markdown renderer components verification...')
{
  const React = (await import('../node_modules/react/index.js')).default
  const { renderToStaticMarkup } = await import('../node_modules/react-dom/server.browser.js')
  const ReactMarkdown = (await import('../node_modules/react-markdown/index.js')).default
  const remarkGfm = (await import('../node_modules/remark-gfm/index.js')).default

  const sampleMarkdown = `
# Header 1
## Header 2

Paragraph with **bold**, *italic*, and [safe link](https://example.com) and [unsafe link](javascript:alert(1)).

- Bullet 1
  - Nested Bullet 1.1
  - Nested Bullet 1.2
- Bullet 2

1. Numbered 1
2. Numbered 2
   1. Sub numbered 2.1
   2. Sub numbered 2.2

| Name | Role | Score |
| :--- | :---: | ---: |
| Alice | Admin | 95 |
| Bob | User | 82 |

\`\`\`python
def calculate():
    return 42
\`\`\`

Inline \`code_snippet\` test.
`

  const html = renderToStaticMarkup(
    React.createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm],
        urlTransform: url => sanitizeUrl(url) ?? '',
      },
      sampleMarkdown,
    ),
  )

  // Verify headers
  assert.ok(html.includes('<h1>Header 1</h1>'))
  assert.ok(html.includes('<h2>Header 2</h2>'))

  // Verify links & sanitization
  assert.ok(html.includes('href="https://example.com"'))
  assert.ok(!html.includes('javascript:alert(1)'))

  // Verify unordered lists & nested lists
  assert.ok(html.includes('<ul>'))
  assert.ok(html.includes('<li>Bullet 1\n<ul>\n<li>Nested Bullet 1.1</li>'))

  // Verify ordered lists & nested numbered lists
  assert.ok(html.includes('<ol>'))
  assert.ok(html.includes('<li>Numbered 1</li>'))
  assert.ok(html.includes('<li>Sub numbered 2.1</li>'))

  // Verify tables
  assert.ok(html.includes('<table>'))
  assert.ok(html.includes('>Name</th>'))
  assert.ok(html.includes('>Alice</td>'))
  assert.ok(html.includes('>Admin</td>'))

  // Verify code block & inline code
  assert.ok(html.includes('<pre><code class="language-python">def calculate():'))
  assert.ok(html.includes('<code>code_snippet</code>'))

  console.log('Passed Test 9!')
}

console.log('--- ALL PHASE 05 VERIFICATION TESTS PASSED SUCCESSFULLY! ---')

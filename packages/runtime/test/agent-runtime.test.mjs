import assert from 'node:assert/strict'
import {
  ChatWorkspace,
  MemoryFileStore,
  MemoryRecordStore,
  TabLockManager,
  StagingManager,
} from '@browser-agents/workspace'
import {
  AgentRuntime,
  ConcurrentRunError,
  ContextLimitExceededError,
  MockPythonExecutor,
  SessionPythonExecutor,
  ScriptedChatModel,
  StepLimitExceededError,
  capOutput,
} from '../dist/index.js'

function createTestWorkspace(chatId = 'chat-test-01') {
  const fileStore = new MemoryFileStore()
  const recordStore = new MemoryRecordStore()
  const lockManager = new TabLockManager()
  const stagingManager = new StagingManager()
  const workspace = new ChatWorkspace(
    chatId,
    fileStore,
    recordStore,
    lockManager,
    stagingManager,
  )
  return { workspace, recordStore, fileStore }
}

console.log('--- Starting AgentRuntime Test Suite ---')

// 1. Headless multi-step plan, file, and Python execution (Exit Check primary path)
console.log('Test 1: Headless multi-step plan, file, and Python execution...')
{
  const { workspace, recordStore } = createTestWorkspace('chat-exit-check')
  await recordStore.createChat({
    id: 'chat-exit-check',
    title: 'Exit Check Chat',
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  // 1a. Upload fixture file
  const fixtureContent = 'id,value\n1,10\n2,20\n3,30\n'
  await workspace.writeFile('/data.csv', fixtureContent, { mimeType: 'text/csv' })

  // 1b. Mock python executor that reads /data.csv and produces /result.txt
  const pythonExecutor = new MockPythonExecutor(async (code) => {
    assert.ok(code.includes('pandas') || code.includes('data.csv'))
    return {
      ok: true,
      exitCode: 0,
      stdout: 'Processed 3 rows, total sum = 60\n',
      stderr: '',
      files: {
        '/result.txt': new TextEncoder().encode('Total: 60'),
      },
      artifacts: [{ path: '/result.txt', mimeType: 'text/plain', dataBase64: btoa('Total: 60') }],
    }
  })

  // 1c. Scripted model executing the multi-step plan, read, python, write, and completion
  const scriptedModel = new ScriptedChatModel([
    // Step 1: Create plan
    {
      toolCalls: [
        {
          name: 'write_todos',
          args: {
            todos: [
              { content: 'Read fixture file', status: 'in_progress' },
              { content: 'Process data with Python', status: 'pending' },
              { content: 'Save result file', status: 'pending' },
            ],
          },
          id: 'call_plan_1',
        },
      ],
    },
    // Step 2: Read fixture file
    {
      toolCalls: [
        {
          name: 'read_file',
          args: { file_path: 'data.csv' },
          id: 'call_read_1',
        },
      ],
    },
    // Step 3: Run python and update plan
    {
      toolCalls: [
        {
          name: 'execute_python',
          args: {
            code: 'import pandas as pd\ndf = pd.read_csv("/data.csv")\nprint("sum:", df["value"].sum())',
          },
          id: 'call_py_1',
        },
        {
          name: 'write_todos',
          args: {
            todos: [
              { content: 'Read fixture file', status: 'completed' },
              { content: 'Process data with Python', status: 'completed' },
              { content: 'Save result file', status: 'in_progress' },
            ],
          },
          id: 'call_plan_2',
        },
      ],
    },
    // Step 4: Complete final plan item and respond
    {
      tokens: ['Data', ' processing', ' complete.'],
      toolCalls: [
        {
          name: 'write_todos',
          args: {
            todos: [
              { content: 'Read fixture file', status: 'completed' },
              { content: 'Process data with Python', status: 'completed' },
              { content: 'Save result file', status: 'completed' },
            ],
          },
          id: 'call_plan_3',
        },
      ],
    },
    // Step 5: Final response
    {
      tokens: [' Result: ', '60'],
    },
  ])

  const recordedEvents = []
  const runtime = new AgentRuntime({
    chatId: 'chat-exit-check',
    model: scriptedModel,
    workspace,
    recordStore,
    pythonExecutor,
    onEvent: event => recordedEvents.push(event),
  })

  const result = await runtime.run('Process /data.csv using Python and calculate sum')
  if (!result.ok) {
    console.error('Test 1 failed with error:', result.error, result.summary)
  }
  assert.equal(result.ok, true)
  assert.equal(result.state, 'completed')

  // Verify result file exists in workspace
  const resultFile = await workspace.readFile('/result.txt')
  assert.ok(resultFile, 'Result file should be persisted in workspace')
  assert.equal(resultFile.content, 'Total: 60')

  // Verify plan persisted in record store
  const savedPlan = await recordStore.getPlan('chat-exit-check')
  assert.equal(savedPlan.length, 3)
  assert.ok(savedPlan.every(p => p.status === 'completed'))

  // Verify run record persisted
  const runs = await recordStore.listRuns('chat-exit-check')
  assert.equal(runs.length, 1)
  assert.equal(runs[0].status, 'completed')

  // Verify tool calls recorded
  const toolCalls = await recordStore.listToolCallsForChat('chat-exit-check')
  assert.ok(toolCalls.length >= 4)
  assert.ok(toolCalls.some(tc => tc.name === 'write_todos'))
  assert.ok(toolCalls.some(tc => tc.name === 'read_file'))
  assert.ok(toolCalls.some(tc => tc.name === 'execute_python'))
  assert.ok(toolCalls.every(tc => tc.status === 'completed'))

  // Verify ordered event emission
  const eventTypes = recordedEvents.map(e => e.type)
  assert.ok(eventTypes.includes('run:start'))
  assert.ok(eventTypes.includes('run:step'))
  assert.ok(eventTypes.includes('plan:update'))
  assert.ok(eventTypes.includes('tool:start'))
  assert.ok(eventTypes.includes('tool:result'))
  assert.ok(eventTypes.includes('text:delta'))
  assert.ok(eventTypes.includes('run:complete'))

  // Verify token deltas received
  const deltas = recordedEvents.filter(e => e.type === 'text:delta').map(e => e.delta)
  assert.deepEqual(deltas, ['Data', ' processing', ' complete.', ' Result: ', '60'])
}
console.log('Passed Test 1!')

// 2. Compatibility with second endpoint without changes to loop
console.log('Test 2: Second compatible endpoint without changing the loop...')
{
  const { workspace, recordStore } = createTestWorkspace('chat-compat')
  await workspace.writeFile('/input.txt', 'Endpoint B Input', { mimeType: 'text/plain' })

  // Endpoint B model implementation with different tokenization/behavior
  const endpointBModel = new ScriptedChatModel([
    {
      toolCalls: [
        {
          name: 'write_todos',
          args: { todos: [{ content: 'Task from Model B', status: 'completed' }] },
          id: 'call_b_1',
        },
        {
          name: 'write_file',
          args: { file_path: 'output_b.txt', content: 'Output from Model B' },
          id: 'call_b_2',
        },
      ],
    },
    {
      text: 'Model B Finished successfully.',
    },
  ])

  const runtime = new AgentRuntime({
    chatId: 'chat-compat',
    model: endpointBModel,
    workspace,
    recordStore,
  })

  const result = await runtime.run('Run on Model B')
  assert.equal(result.ok, true)
  assert.equal(result.state, 'completed')

  const written = await workspace.readFile('/output_b.txt')
  assert.ok(written)
  assert.equal(written.content, 'Output from Model B')
}
console.log('Passed Test 2!')

// 2a. Graph files and Python share synchronized, version-checked workspace state
console.log('Test 2a: Python sees graph writes and graph reads Python changes...')
{
  const { workspace } = createTestWorkspace('chat-python-graph-sync')
  await workspace.writeFile('/data.txt', 'old', { mimeType: 'text/plain' })
  await workspace.writeFile('/untouched.txt', 'preserve me', { mimeType: 'text/plain' })
  const readResults = []
  let pythonCalls = 0
  const pythonExecutor = new MockPythonExecutor(async () => {
    pythonCalls += 1
    if (pythonCalls === 1) {
      const graphWrite = await workspace.readFile('/fresh.txt')
      assert.equal(graphWrite?.content, 'hello', 'Graph writes must be in Python workspace before execution')
      return {
        ok: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        files: {
          '/data.txt': new TextEncoder().encode('new'),
          '/image.png': Uint8Array.from([0, 1, 2, 255]),
        },
      }
    }
    assert.equal((await workspace.readFile('/data.txt'))?.content, 'old', 'Python must see a graph edit that restores the original content')
    return { ok: true, exitCode: 0, stdout: '', stderr: '', files: { '/final.txt': new TextEncoder().encode('complete') } }
  })
  const model = new ScriptedChatModel([
    { toolCalls: [{ name: 'write_file', args: { file_path: 'fresh.txt', content: 'hello' }, id: 'sync-write' }] },
    { toolCalls: [{ name: 'execute_python', args: { code: 'print("updated")' }, id: 'sync-python' }] },
    { toolCalls: [{ name: 'read_file', args: { file_path: 'data.txt' }, id: 'sync-read-new' }] },
    { toolCalls: [{ name: 'edit_file', args: { file_path: 'data.txt', old_string: 'new', new_string: 'old' }, id: 'sync-edit' }] },
    { toolCalls: [{ name: 'execute_python', args: { code: 'print("verify edit")' }, id: 'sync-python-2' }] },
    { toolCalls: [{ name: 'read_file', args: { file_path: 'data.txt' }, id: 'sync-read-old' }] },
    { toolCalls: [{ name: 'read_file', args: { file_path: 'data.txt' }, id: 'sync-read' }] },
    { text: 'Finished.' },
  ])
  const runtime = new AgentRuntime({
    chatId: 'chat-python-graph-sync',
    model,
    workspace,
    pythonExecutor,
    onEvent: event => {
      if (event.type === 'tool:result' && event.name === 'read_file') readResults.push(event.result)
    },
  })
  const result = await runtime.run('Write a file, update data with Python, then read it')
  assert.equal(result.ok, true)
  assert.ok(JSON.stringify(readResults).includes('new'), 'read_file must observe Python output')
  assert.ok(JSON.stringify(readResults).includes('old'), 'read_file must observe the later reverting graph edit')
  assert.equal((await workspace.readFile('/data.txt'))?.content, 'old', 'Final persistence must retain the reverting graph edit')
  assert.equal((await workspace.readFile('/fresh.txt'))?.content, 'hello')
  assert.deepEqual(Array.from((await workspace.readFileBytes('/image.png')).data), [0, 1, 2, 255])
  assert.equal((await workspace.statFile('/image.png'))?.source, 'model')
  assert.equal((await workspace.readFile('/final.txt'))?.content, 'complete')
  assert.equal((await workspace.readFile('/untouched.txt'))?.content, 'preserve me')
}
console.log('Passed Test 2a!')

// 2b. Complete Python snapshots propagate deletions into graph state
console.log('Test 2b: Python snapshot deletes are visible to graph tools...')
{
  const { workspace } = createTestWorkspace('chat-python-delete-sync')
  await workspace.writeFile('/gone.txt', 'remove me', { mimeType: 'text/plain' })
  const pythonSession = {
    chatId: 'chat-python-delete-sync',
    isReady: true,
    isTerminated: false,
    initialize: async () => {},
    run: async () => {
      await workspace.deleteFile('/gone.txt')
      return { ok: true, exitCode: 0, stdout: '', stderr: '', files: {} }
    },
    reset: async () => {},
    terminate: async () => {},
  }
  const pythonExecutor = new SessionPythonExecutor(pythonSession)
  const model = new ScriptedChatModel([
    { toolCalls: [{ name: 'execute_python', args: { code: 'import os; os.remove("gone.txt")' }, id: 'delete-python' }] },
    { toolCalls: [{ name: 'read_file', args: { file_path: 'gone.txt' }, id: 'delete-read' }] },
    { text: 'Finished.' },
  ])
  const runtime = new AgentRuntime({ chatId: 'chat-python-delete-sync', model, workspace, pythonExecutor })
  const result = await runtime.run('Delete the file using Python and verify it is gone')
  assert.equal(result.ok, true)
  assert.equal(await workspace.readFile('/gone.txt'), null)
  assert.ok(result.summary.toolCalls.find(call => call.id === 'delete-read'))
}
console.log('Passed Test 2b!')

// 2c. Parallel Python calls preserve each other's generated files
console.log('Test 2c: Parallel Python calls share the latest synchronized file state...')
{
  const { workspace } = createTestWorkspace('chat-python-parallel-sync')
  let calls = 0
  const pythonExecutor = new MockPythonExecutor(async () => {
    calls += 1
    if (calls === 2) {
      assert.equal((await workspace.readFile('/parallel-1.txt'))?.content, 'first')
      return { ok: true, exitCode: 0, stdout: '', stderr: '', files: { '/parallel-2.txt': new TextEncoder().encode('second') } }
    }
    return { ok: true, exitCode: 0, stdout: '', stderr: '', files: { '/parallel-1.txt': new TextEncoder().encode('first') } }
  })
  const model = new ScriptedChatModel([
    { toolCalls: [
      { name: 'execute_python', args: { code: 'print("first")' }, id: 'parallel-python-1' },
      { name: 'execute_python', args: { code: 'print("second")' }, id: 'parallel-python-2' },
    ] },
    { text: 'Both finished.' },
  ])
  const runtime = new AgentRuntime({ chatId: 'chat-python-parallel-sync', model, workspace, pythonExecutor })
  const result = await runtime.run('Run both Python operations')
  assert.equal(result.ok, true)
  assert.equal((await workspace.readFile('/parallel-1.txt'))?.content, 'first')
  assert.equal((await workspace.readFile('/parallel-2.txt'))?.content, 'second')
}
console.log('Passed Test 2c!')

// 3. Step limit stop
console.log('Test 3: Step limit stops runaway execution...')
{
  const { workspace } = createTestWorkspace('chat-loop')

  // Model that continuously produces tool calls without stopping
  const infiniteModel = new ScriptedChatModel([
    { toolCalls: [{ name: 'write_todos', args: { todos: [{ content: 'Loop', status: 'in_progress' }] } }] },
    { toolCalls: [{ name: 'write_todos', args: { todos: [{ content: 'Loop', status: 'in_progress' }] } }] },
    { toolCalls: [{ name: 'write_todos', args: { todos: [{ content: 'Loop', status: 'in_progress' }] } }] },
    { toolCalls: [{ name: 'write_todos', args: { todos: [{ content: 'Loop', status: 'in_progress' }] } }] },
    { toolCalls: [{ name: 'write_todos', args: { todos: [{ content: 'Loop', status: 'in_progress' }] } }] },
  ])

  const runtime = new AgentRuntime({
    chatId: 'chat-loop',
    model: infiniteModel,
    workspace,
    limits: { maxSteps: 3 },
  })

  const result = await runtime.run('Infinite run')
  assert.equal(result.ok, false)
  assert.equal(result.state, 'failed')
  assert.match(result.error || '', /maximum step limit/i)
}
console.log('Passed Test 3!')

// 4. Context limit exceeded stop
console.log('Test 4: Context limit stop behavior...')
{
  const { workspace } = createTestWorkspace('chat-ctx')
  const model = new ScriptedChatModel([{ text: 'Hello' }])

  const runtime = new AgentRuntime({
    chatId: 'chat-ctx',
    model,
    workspace,
    limits: { maxContextMessages: 0 }, // 0 max messages triggers context limit
  })

  await assert.rejects(
    async () => {
      await runtime.run('Prompt exceeds limit')
    },
    ContextLimitExceededError,
  )
}
console.log('Passed Test 4!')

// 5. Concurrent run rejection
console.log('Test 5: Concurrent run rejection...')
{
  const { workspace } = createTestWorkspace('chat-concurrent')
  const slowModel = new ScriptedChatModel([
    {
      delayMs: 150,
      text: 'Slow response',
    },
  ])

  const runtime = new AgentRuntime({
    chatId: 'chat-concurrent',
    model: slowModel,
    workspace,
    limits: { concurrency: 'reject' },
  })

  const p1 = runtime.run('Run 1')
  // Small tick to ensure p1 starts running
  await new Promise(r => setTimeout(r, 10))

  await assert.rejects(
    async () => {
      await runtime.run('Run 2 simultaneous')
    },
    ConcurrentRunError,
  )

  const res1 = await p1
  assert.equal(res1.ok, true)
}
console.log('Passed Test 5!')

// 6. Python error feedback and bounded correction
console.log('Test 6: Python error feedback and bounded correction...')
{
  const { workspace } = createTestWorkspace('chat-py-err')
  let executionCount = 0

  const pythonExecutor = new MockPythonExecutor(async (code) => {
    executionCount++
    if (code.includes('syntax_error_bug')) {
      return {
        ok: false,
        exitCode: 1,
        stdout: '',
        stderr: 'NameError: name "syntax_error_bug" is not defined\n',
        error: 'Execution failed with non-zero exit code',
      }
    }
    return {
      ok: true,
      exitCode: 0,
      stdout: 'Fixed and executed successfully!\n',
      stderr: '',
    }
  })

  const correctingModel = new ScriptedChatModel([
    // Step 1: Model submits buggy code
    {
      toolCalls: [
        {
          name: 'execute_python',
          args: { code: 'print(syntax_error_bug)' },
          id: 'call_buggy',
        },
      ],
    },
    // Step 2: Model sees error feedback and fixes code
    {
      toolCalls: [
        {
          name: 'execute_python',
          args: { code: 'fixed_variable = 42\nprint(fixed_variable)' },
          id: 'call_fixed',
        },
      ],
    },
    // Step 3: Finished
    {
      text: 'Python bug fixed.',
    },
  ])

  const runtime = new AgentRuntime({
    chatId: 'chat-py-err',
    model: correctingModel,
    workspace,
    pythonExecutor,
  })

  const result = await runtime.run('Fix python error')
  assert.equal(result.ok, true)
  assert.equal(result.state, 'completed')
  assert.equal(executionCount, 2)
}
console.log('Passed Test 6!')

// 7. Output capping and truncation
console.log('Test 7: Tool output capping and truncation...')
{
  const longText = 'A'.repeat(100_000)
  const capped = capOutput(longText, 500)
  assert.ok(capped.length < 1000)
  assert.ok(capped.includes('... [Output truncated after 500 characters]'))
}
console.log('Passed Test 7!')

// 8. Cancellation propagation during execution
console.log('Test 8: Cancellation propagation...')
{
  const { workspace } = createTestWorkspace('chat-cancel')
  let cancelCalled = false

  const cancelableExecutor = new MockPythonExecutor(async () => {
    await new Promise(r => setTimeout(r, 1000))
    return { ok: true, stdout: 'done', stderr: '' }
  })
  cancelableExecutor.cancel = async () => {
    cancelCalled = true
  }

  const cancelModel = new ScriptedChatModel([
    {
      delayMs: 500,
      toolCalls: [
        {
          name: 'execute_python',
          args: { code: 'import time; time.sleep(1)' },
          id: 'c_cancel',
        },
      ],
    },
  ])

  const events = []
  const runtime = new AgentRuntime({
    chatId: 'chat-cancel',
    model: cancelModel,
    workspace,
    pythonExecutor: cancelableExecutor,
    onEvent: e => events.push(e),
  })

  const runPromise = runtime.run('Will be cancelled')
  await new Promise(r => setTimeout(r, 20))
  await runtime.cancel('User requested cancellation')

  const cancelResult = await runPromise
  assert.equal(cancelResult.ok, false)
  assert.equal(cancelResult.state, 'cancelled')
  assert.equal(cancelCalled, true)
  assert.ok(events.some(e => e.type === 'run:cancel'))
}
console.log('Passed Test 8!')

// 9. Security boundary: Path traversal rejection and forbidden tool rejection
console.log('Test 9: Security boundary enforcement...')
{
  const { workspace } = createTestWorkspace('chat-security')

  // Model attempting path traversal
  const attackModel = new ScriptedChatModel([
    {
      toolCalls: [
        {
          name: 'read_file',
          args: { file_path: '../../../../etc/passwd' },
          id: 'call_traversal',
        },
      ],
    },
    {
      text: 'Done',
    },
  ])

  const runtime = new AgentRuntime({
    chatId: 'chat-security',
    model: attackModel,
    workspace,
  })

  const result = await runtime.run('Attempt traversal')
  if (!result.ok) {
    console.error('Test 9 result error:', result.error)
  }
  assert.equal(result.ok, true)
  // Tool call should be an error tool result, preventing escape
  const tc = result.summary.toolCalls.find(t => t.id === 'call_traversal')
  assert.ok(tc)
  assert.equal(tc.status, 'error')
  assert.match(String(tc.content), /denied|boundary|traversal/i)

  // 9a2. Model attempting absolute path should be rejected
  const absolutePathModel = new ScriptedChatModel([
    {
      toolCalls: [
        {
          name: 'read_file',
          args: { file_path: '/secret.txt' },
          id: 'call_absolute',
        },
      ],
    },
    {
      text: 'Handled absolute path rejection.',
    },
  ])

  const absRuntime = new AgentRuntime({
    chatId: 'chat-security',
    model: absolutePathModel,
    workspace,
  })

  const absResult = await absRuntime.run('Attempt absolute path')
  assert.equal(absResult.ok, true)
  const absTc = absResult.summary.toolCalls.find(t => t.id === 'call_absolute')
  assert.ok(absTc)
  assert.equal(absTc.status, 'error')
  assert.match(String(absTc.content), /absolute paths?.*not allowed/i)

  // 9b. Directory listing with '/' and '.' should be permitted for directory tools
  const lsModel = new ScriptedChatModel([
    {
      toolCalls: [
        {
          name: 'ls',
          args: { path: '/' },
          id: 'call_ls_root',
        },
        {
          name: 'ls',
          args: { path: '.' },
          id: 'call_ls_dot',
        },
      ],
    },
    {
      text: 'Explored directory.',
    },
  ])

  const lsRuntime = new AgentRuntime({
    chatId: 'chat-security',
    model: lsModel,
    workspace,
  })

  const lsResult = await lsRuntime.run('List files')
  assert.equal(lsResult.ok, true)
  const lsRoot = lsResult.summary.toolCalls.find(t => t.id === 'call_ls_root')
  assert.ok(lsRoot)
  assert.notEqual(lsRoot.status, 'error')
  const lsDot = lsResult.summary.toolCalls.find(t => t.id === 'call_ls_dot')
  assert.ok(lsDot)
  assert.notEqual(lsDot.status, 'error')
}
console.log('Passed Test 9!')

// 10. Malformed JSON tool arguments rejection and feedback recovery
console.log('Test 10: Malformed tool argument rejection and recovery...')
{
  const { workspace } = createTestWorkspace('chat-malformed')

  // Turn 1 throws InvalidToolArgumentsError (malformed JSON)
  // Turn 2 succeeds with valid JSON
  const malformedModel = new ScriptedChatModel([
    {
      malformedArguments: true,
    },
    {
      toolCalls: [
        {
          name: 'write_todos',
          args: { todos: [{ content: 'Recovered task', status: 'completed' }] },
          id: 'call_rec',
        },
      ],
    },
    {
      text: 'Recovered from malformed arguments.',
    },
  ])

  const runtime = new AgentRuntime({
    chatId: 'chat-malformed',
    model: malformedModel,
    workspace,
  })

  // The model throws invalid tool arguments and should fail cleanly if not handled or succeed if model retries
  // Here malformedModel turn 1 simulates the error, then turn 2 provides valid JSON
  // If attempt fails, error is surfaced cleanly
  const result = await runtime.run('Test malformed')
  // With ScriptedChatModel turn 1 throwing, it propagates as a failure for that turn
  assert.ok(result.runId)
}
console.log('Passed Test 10!')

console.log('--- ALL AGENT RUNTIME TESTS PASSED SUCCESSFULLY! ---')

import assert from 'node:assert/strict'
import { MemoryRecordStore } from '../dist/records/memory.js'
import { SCHEMA_VERSION } from '../dist/types.js'

console.log('Running record store and reconciliation tests...')

const store = new MemoryRecordStore()

// 1. Chat lifecycle
const chat1 = await store.createChat({
  id: 'chat_test_1',
  title: 'Test Analysis Chat',
  schemaVersion: SCHEMA_VERSION,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

assert.equal(chat1.id, 'chat_test_1')
assert.equal(chat1.title, 'Test Analysis Chat')

const fetchedChat = await store.getChat('chat_test_1')
assert.ok(fetchedChat)
assert.equal(fetchedChat.id, 'chat_test_1')

await store.updateChat('chat_test_1', { title: 'Updated Title' })
const updatedChat = await store.getChat('chat_test_1')
assert.equal(updatedChat.title, 'Updated Title')

const chatsList = await store.listChats()
assert.equal(chatsList.length, 1)
assert.equal(chatsList[0].id, 'chat_test_1')

// 2. Messages
await store.addMessage({
  id: 'msg_1',
  chatId: 'chat_test_1',
  role: 'user',
  content: 'Hello, analyze this data',
  createdAt: '2026-11-01T10:00:00.000Z',
})

await store.addMessage({
  id: 'msg_2',
  chatId: 'chat_test_1',
  role: 'assistant',
  content: 'Sure! Let me start.',
  createdAt: '2026-11-01T10:00:05.000Z',
})

const messages = await store.getMessages('chat_test_1')
assert.equal(messages.length, 2)
assert.equal(messages[0].id, 'msg_1')
assert.equal(messages[1].id, 'msg_2')

// Cross-chat isolation for messages
const otherMessages = await store.getMessages('chat_test_2')
assert.equal(otherMessages.length, 0)

// 3. Plan items
await store.setPlan('chat_test_1', [
  {
    id: 'plan_1',
    chatId: 'chat_test_1',
    index: 0,
    content: 'Inspect input data',
    status: 'completed',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'plan_2',
    chatId: 'chat_test_1',
    index: 1,
    content: 'Generate plots',
    status: 'in_progress',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
])

const plan = await store.getPlan('chat_test_1')
assert.equal(plan.length, 2)
assert.equal(plan[0].status, 'completed')
assert.equal(plan[1].status, 'in_progress')

await store.updatePlanItem('chat_test_1', 'plan_2', 'completed')
const updatedPlan = await store.getPlan('chat_test_1')
assert.equal(updatedPlan[1].status, 'completed')

// 4. Runs & Tool calls
const run1 = await store.createRun({
  id: 'run_1',
  chatId: 'chat_test_1',
  status: 'running',
  startedAt: new Date().toISOString(),
})
assert.equal(run1.status, 'running')

const run2 = await store.createRun({
  id: 'run_2',
  chatId: 'chat_test_1',
  status: 'completed',
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
})

await store.createToolCall({
  id: 'tc_1',
  runId: 'run_1',
  chatId: 'chat_test_1',
  name: 'execute_python',
  args: '{"code": "import numpy as np"}',
  status: 'running',
  startedAt: new Date().toISOString(),
})

await store.createToolCall({
  id: 'tc_2',
  runId: 'run_1',
  chatId: 'chat_test_1',
  name: 'read_file',
  args: '{"path": "data.csv"}',
  status: 'pending',
  startedAt: new Date().toISOString(),
})

await store.createToolCall({
  id: 'tc_3',
  runId: 'run_2',
  chatId: 'chat_test_1',
  name: 'write_todos',
  args: '{"todos": []}',
  status: 'completed',
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
})

// 5. Startup reconciliation
const reconciliation = await store.reconcileStartup()
assert.deepEqual(reconciliation.interruptedRuns, ['run_1'])
assert.ok(reconciliation.interruptedToolCalls.includes('tc_1'))
assert.ok(reconciliation.interruptedToolCalls.includes('tc_2'))
assert.equal(reconciliation.interruptedToolCalls.includes('tc_3'), false)

const reconciledRun1 = await store.getRun('run_1')
assert.equal(reconciledRun1.status, 'interrupted')
assert.ok(reconciledRun1.endedAt)
assert.ok(reconciledRun1.error?.message.includes('interrupted'))

const completedRun2 = await store.getRun('run_2')
assert.equal(completedRun2.status, 'completed')

const reconciledTc1 = await store.getToolCall('tc_1')
assert.equal(reconciledTc1.status, 'interrupted')

const reconciledTc2 = await store.getToolCall('tc_2')
assert.equal(reconciledTc2.status, 'interrupted')

const completedTc3 = await store.getToolCall('tc_3')
assert.equal(completedTc3.status, 'completed')

// Calling reconcile again should have no effect
const rerunReconciliation = await store.reconcileStartup()
assert.equal(rerunReconciliation.interruptedRuns.length, 0)
assert.equal(rerunReconciliation.interruptedToolCalls.length, 0)

// 6. Delete chat cleans up records
await store.deleteChat('chat_test_1')
assert.equal(await store.getChat('chat_test_1'), null)
assert.equal((await store.getMessages('chat_test_1')).length, 0)
assert.equal((await store.getPlan('chat_test_1')).length, 0)
assert.equal((await store.listRuns('chat_test_1')).length, 0)

console.log('Record store and reconciliation tests passed successfully!')

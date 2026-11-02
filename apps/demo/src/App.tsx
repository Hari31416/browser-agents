import { useState, useCallback, useEffect, useRef } from 'react'
import {
  AgentRuntime,
  RelayChatModel,
  RelayClient,
  ScriptedChatModel,
  SessionPythonExecutor,
  MockPythonExecutor,
  createRunId,
} from '@browser-agents/runtime'
import type { AgentEvent, ProviderResponse } from '@browser-agents/runtime'
import {
  WorkspaceManager,
  type ChatMessageRecord,
  type ChatSession,
  type PlanItemRecord,
  type RunRecord,
  type StorageStatus,
  type ToolCallRecord,
  type WorkspaceFile,
} from '@browser-agents/workspace'
import { PythonSessionManagerImpl } from '@browser-agents/python'

import { loadPreferences, savePreferences } from './lib/preferences'
import type {
  ActiveRunInfo,
  AssembledRequestInspection,
  ProviderPreferences,
  PythonState,
} from './types'

import { Sidebar } from './components/Sidebar'
import { ChatHeader } from './components/ChatHeader'
import { ConversationView } from './components/ConversationView'
import { WorkspaceFiles } from './components/WorkspaceFiles'
import { Composer } from './components/Composer'
import { ProviderModal } from './components/ProviderModal'
import { FilePreviewModal } from './components/FilePreviewModal'
import { RequestInspectorModal } from './components/RequestInspectorModal'
import { DataFlowModal } from './components/DataFlowModal'
import { ErrorBanner } from './components/ErrorBanner'

export function App() {
  // --- Persistent Preferences ---
  const [preferences, setPreferences] = useState<ProviderPreferences>(loadPreferences)

  // --- Workspace & Storage ---
  const workspaceManagerRef = useRef<WorkspaceManager>(new WorkspaceManager())
  const pythonManagerRef = useRef<PythonSessionManagerImpl>(new PythonSessionManagerImpl())
  const relayClientRef = useRef<RelayClient>(new RelayClient(preferences.relayUrl))
  const activeRuntimeRef = useRef<AgentRuntime | null>(null)

  const [chats, setChats] = useState<ChatSession[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(null)

  // --- Active Chat Records ---
  const [messages, setMessages] = useState<ChatMessageRecord[]>([])
  const [planItems, setPlanItems] = useState<PlanItemRecord[]>([])
  const [toolCalls, setToolCalls] = useState<ToolCallRecord[]>([])
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [files, setFiles] = useState<WorkspaceFile[]>([])

  // --- Relay Session & Provider ---
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [currentProvider, setCurrentProvider] = useState<ProviderResponse | null>(null)
  const [relayError, setRelayError] = useState<string | null>(null)

  // --- Python State ---
  const [pythonState, setPythonState] = useState<PythonState>({
    status: 'idle',
    packages: ['numpy', 'pandas', 'matplotlib'],
  })

  // --- Active Run Info ---
  const [activeRun, setActiveRun] = useState<ActiveRunInfo | null>(null)

  // --- Modals ---
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false)
  const [isInspectorOpen, setIsInspectorOpen] = useState(false)
  const [isDataFlowOpen, setIsDataFlowOpen] = useState(false)
  const [previewFile, setPreviewFile] = useState<WorkspaceFile | null>(null)
  const [inspectionData, setInspectionData] = useState<AssembledRequestInspection | null>(null)

  // --- Initial Startup & Reconciliation ---
  useEffect(() => {
    let mounted = true
    const init = async () => {
      const wm = workspaceManagerRef.current
      try {
        // Startup reconciliation: cleans up any interrupted runs
        await wm.reconcileStartup()

        // Status
        const status = wm.getStorageStatus()
        if (mounted) setStorageStatus(status)

        // List chats
        let chatList = await wm.listChats()
        if (chatList.length === 0) {
          const initialChat = await wm.createChat('Welcome Analysis')
          chatList = [initialChat]
        }

        if (mounted) {
          setChats(chatList)
          const chosenId = chatList[0].id
          setActiveChatId(chosenId)
        }
      } catch (err) {
        if (mounted) {
          setRelayError(`Storage initialization failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
    init()
    return () => {
      mounted = false
    }
  }, [])

  // --- Load Chat Data when activeChatId changes ---
  const loadChatData = useCallback(async (chatId: string) => {
    const wm = workspaceManagerRef.current
    try {
      const [msgs, plan, rList, tcList, wsFiles] = await Promise.all([
        wm.getMessages(chatId),
        wm.getPlan(chatId),
        wm.listRuns(chatId),
        wm.recordStore.listToolCallsForChat(chatId),
        wm.getWorkspace(chatId).listFiles(),
      ])
      setMessages(msgs)
      setPlanItems(plan)
      setRuns(rList)
      setToolCalls(tcList)
      setFiles(wsFiles)
      // Reset python interpreter state on chat switch: variables reset
      setPythonState({
        status: 'idle',
        packages: ['numpy', 'pandas', 'matplotlib'],
      })
    } catch (err) {
      console.warn('Failed to load chat data:', err)
    }
  }, [])

  useEffect(() => {
    if (activeChatId) {
      loadChatData(activeChatId)
    }
  }, [activeChatId, loadChatData])

  // --- Preferences update handler ---
  const handleSavePreferences = useCallback((newPrefs: ProviderPreferences) => {
    setPreferences(newPrefs)
    savePreferences(newPrefs)
    relayClientRef.current = new RelayClient(newPrefs.relayUrl)
  }, [])

  // --- Relay Disconnect handler ---
  const handleDisconnectRelay = useCallback(async () => {
    try {
      await relayClientRef.current.deleteSession()
    } catch {
      // Ignore network errors
    }
    setSessionToken(null)
    setCurrentProvider(null)
    setRelayError(null)
  }, [])

  // --- Chat Lifecycle Handlers ---
  const handleCreateChat = useCallback(async () => {
    const wm = workspaceManagerRef.current
    const newChat = await wm.createChat(`Chat ${chats.length + 1}`)
    const updatedChats = await wm.listChats()
    setChats(updatedChats)
    setActiveChatId(newChat.id)
  }, [chats.length])

  const handleDeleteChat = useCallback(async (chatId: string) => {
    const wm = workspaceManagerRef.current
    await wm.deleteChat(chatId)
    await pythonManagerRef.current.disposeSession(chatId)
    const updatedChats = await wm.listChats()
    setChats(updatedChats)
    if (activeChatId === chatId) {
      if (updatedChats.length > 0) {
        setActiveChatId(updatedChats[0].id)
      } else {
        const fallbackChat = await wm.createChat('New Chat')
        setChats([fallbackChat])
        setActiveChatId(fallbackChat.id)
      }
    }
  }, [activeChatId])

  const handleUpdateTitle = useCallback(async (newTitle: string) => {
    if (!activeChatId) return
    const wm = workspaceManagerRef.current
    await wm.updateChat(activeChatId, { title: newTitle })
    const updatedChats = await wm.listChats()
    setChats(updatedChats)
  }, [activeChatId])

  const handleExportChat = useCallback(async (chatId: string) => {
    const wm = workspaceManagerRef.current
    try {
      const archive = await wm.exportChat(chatId)
      const json = JSON.stringify(archive, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `chat-export-${chatId}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  // --- File Handlers ---
  const handleUploadFiles = useCallback(async (fileList: FileList) => {
    if (!activeChatId) return
    const wm = workspaceManagerRef.current
    const ws = wm.getWorkspace(activeChatId)

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i]
      const arrayBuffer = await file.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      const path = file.name.startsWith('/') ? file.name : `/${file.name}`
      await ws.writeFile(path, bytes, { mimeType: file.type || 'application/octet-stream' })
    }

    const updatedFiles = await ws.listFiles()
    setFiles(updatedFiles)
  }, [activeChatId])

  const handleDownloadFile = useCallback(async (path: string) => {
    if (!activeChatId) return
    const wm = workspaceManagerRef.current
    const ws = wm.getWorkspace(activeChatId)
    try {
      const res = await ws.readFileBytes(path)
      const blob = new Blob([res.data as unknown as BlobPart], {
        type: res.metadata.mimeType || 'application/octet-stream',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = path.split('/').pop() || 'download'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(`Download failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [activeChatId])

  const handleDeleteFile = useCallback(async (path: string) => {
    if (!activeChatId) return
    const wm = workspaceManagerRef.current
    const ws = wm.getWorkspace(activeChatId)
    await ws.deleteFile(path)
    const updatedFiles = await ws.listFiles()
    setFiles(updatedFiles)
  }, [activeChatId])

  const handlePreviewReadFileBytes = useCallback(async (path: string): Promise<Uint8Array | null> => {
    if (!activeChatId) return null
    const wm = workspaceManagerRef.current
    const ws = wm.getWorkspace(activeChatId)
    try {
      const res = await ws.readFileBytes(path)
      return res.data
    } catch {
      return null
    }
  }, [activeChatId])

  // --- Python Reset Handler ---
  const handleResetPython = useCallback(async () => {
    if (!activeChatId) return
    try {
      await pythonManagerRef.current.resetSession(activeChatId)
      setPythonState({
        status: 'ready',
        packages: ['numpy', 'pandas', 'matplotlib'],
      })
    } catch (err) {
      setPythonState({
        status: 'error',
        packages: ['numpy', 'pandas', 'matplotlib'],
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, [activeChatId])

  // --- Cancel Run Handler ---
  const handleCancelRun = useCallback(() => {
    if (activeRuntimeRef.current) {
      activeRuntimeRef.current.cancel('Cancelled by user')
    }
    setActiveRun(null)
  }, [])

  // --- Send Message & Agent Execution ---
  const handleSendMessage = useCallback(async (promptText: string) => {
    if (!activeChatId) return
    const wm = workspaceManagerRef.current
    const ws = wm.getWorkspace(activeChatId)

    // Check concurrency
    if (activeRun) {
      setRelayError('A run is already in progress for this workspace.')
      return
    }

    const now = new Date().toISOString()
    const userMsgId = `msg_${Math.random().toString(36).slice(2)}_${Date.now()}`
    const userMsg: ChatMessageRecord = {
      id: userMsgId,
      chatId: activeChatId,
      role: 'user',
      content: promptText,
      createdAt: now,
    }

    // Save user message
    await wm.addMessage(userMsg)
    setMessages(prev => [...prev, userMsg])

    // Prepare active run info
    const runId = createRunId()
    setActiveRun({
      runId,
      chatId: activeChatId,
      state: 'running',
      step: 1,
      prompt: promptText,
      streamingText: '',
      startedAt: now,
    })

    // Setup Model and Executor
    let model: RelayChatModel | ScriptedChatModel
    let pythonExecutor: SessionPythonExecutor | MockPythonExecutor

    if (preferences.isFixtureMode) {
      // Simulated Testbed Fixture Mode
      const fixtureResponseFile = '/analysis_output.txt'
      pythonExecutor = new MockPythonExecutor(async () => {
        setPythonState({ status: 'running', packages: ['numpy', 'pandas', 'matplotlib'] })
        const sampleOut = 'Dataset rows: 100\nColumns: 4\nMean calculation: 42.5\n'
        await ws.writeFile(fixtureResponseFile, sampleOut, { mimeType: 'text/plain' })
        setPythonState({ status: 'ready', packages: ['numpy', 'pandas', 'matplotlib'] })
        return {
          ok: true,
          exitCode: 0,
          stdout: sampleOut,
          stderr: '',
          files: {
            [fixtureResponseFile]: new TextEncoder().encode(sampleOut),
          },
          artifacts: [{ path: fixtureResponseFile, mimeType: 'text/plain', dataBase64: btoa(sampleOut) }],
        }
      })

      model = new ScriptedChatModel([
        {
          toolCalls: [
            {
              name: 'write_todos',
              args: {
                todos: [
                  { content: 'Inspect workspace files', status: 'in_progress' },
                  { content: 'Run data analysis with pandas', status: 'pending' },
                  { content: 'Save summary output to workspace', status: 'pending' },
                ],
              },
              id: `call_plan_${Date.now()}`,
            },
          ],
        },
        {
          toolCalls: [
            {
              name: 'execute_python',
              args: {
                code: 'import pandas as pd\nimport numpy as np\nprint("Executing analysis in browser WebAssembly...")\n',
              },
              id: `call_py_${Date.now()}`,
            },
          ],
        },
        {
          toolCalls: [
            {
              name: 'write_todos',
              args: {
                todos: [
                  { content: 'Inspect workspace files', status: 'completed' },
                  { content: 'Run data analysis with pandas', status: 'completed' },
                  { content: 'Save summary output to workspace', status: 'completed' },
                ],
              },
              id: `call_plan_done_${Date.now()}`,
            },
          ],
        },
        {
          text: `Analysis complete. Generated output has been written to \`${fixtureResponseFile}\`. You can preview or download it directly from the workspace files panel.`,
        },
      ])
    } else {
      // Real Relay Mode
      const activeModelId = preferences.selectedModel || preferences.customModel
      if (!currentProvider || !activeModelId) {
        setIsProviderModalOpen(true)
        setActiveRun(null)
        setRelayError('Please configure an endpoint and select a model first.')
        return
      }

      const client = relayClientRef.current
      if (sessionToken) {
        client.setSessionToken(sessionToken)
      }

      model = new RelayChatModel(client, {
        relayUrl: preferences.relayUrl,
        sessionToken: sessionToken || '',
        providerId: currentProvider.provider_id,
        model: activeModelId,
      })

      // Python Session for active chat
      try {
        setPythonState({ status: 'initializing', packages: ['numpy', 'pandas', 'matplotlib'] })
        const session = await pythonManagerRef.current.getSession(activeChatId, {
          workspace: ws,
          assetBaseUrl: '/runtime',
        })
        if (!session.isReady) {
          await session.initialize()
        }
        setPythonState({ status: 'ready', packages: ['numpy', 'pandas', 'matplotlib'] })
        pythonExecutor = new SessionPythonExecutor(session)
      } catch (err) {
        console.warn('Python session initialization warning:', err)
        // Fallback to mock executor with descriptive error
        pythonExecutor = new MockPythonExecutor(() => ({
          ok: false,
          exitCode: 1,
          stdout: '',
          stderr: `Pyodide initialization warning: ${err instanceof Error ? err.message : String(err)}`,
        }))
      }
    }

    // Prepare Inspection Data for user inspection modal
    setInspectionData({
      providerName: preferences.providerName,
      baseUrl: preferences.baseUrl,
      model: preferences.selectedModel || preferences.customModel || 'fixture-model',
      systemPrompt: 'Autonomous browser agent with isolated file tools and Python WebAssembly runtime.',
      messages: [
        ...messages.map(m => ({ role: m.role, content: m.content || '' })),
        { role: 'user', content: promptText },
      ],
      tools: [
        { name: 'write_todos', description: 'Create and update step-by-step task plan' },
        { name: 'execute_python', description: 'Run Python in isolated browser WebAssembly sandbox' },
        { name: 'read_file', description: 'Read file from chat workspace' },
        { name: 'write_file', description: 'Write or update file in chat workspace' },
        { name: 'list_directory', description: 'List files in chat workspace' },
      ],
    })

    // Instantiate AgentRuntime
    const runtime = new AgentRuntime({
      chatId: activeChatId,
      model,
      workspace: ws,
      pythonExecutor,
      recordStore: wm.recordStore,
      systemPrompt: 'Autonomous browser agent with isolated file tools and Python WebAssembly runtime.',
      limits: {
        maxSteps: 25,
        timeoutMs: 120_000,
        concurrency: 'reject',
      },
      onEvent: async (event: AgentEvent) => {
        if (event.type === 'text:delta') {
          setActiveRun(prev => prev ? { ...prev, streamingText: prev.streamingText + event.delta } : null)
        } else if (event.type === 'run:step') {
          setActiveRun(prev => prev ? { ...prev, step: event.stepNumber } : null)
        } else if (event.type === 'plan:update') {
          const nowStr = new Date().toISOString()
          setPlanItems(event.todos.map((t, idx) => ({
            id: t.id || `todo_${idx}`,
            chatId: activeChatId,
            index: idx,
            content: t.content,
            status: t.status,
            createdAt: nowStr,
            updatedAt: nowStr,
          })))
        } else if (event.type === 'tool:start') {
          const tcRecord: ToolCallRecord = {
            id: event.callId,
            runId: event.runId,
            chatId: activeChatId,
            name: event.name,
            args: JSON.stringify(event.args),
            status: 'running',
            startedAt: event.timestamp,
          }
          setToolCalls(prev => [...prev.filter(t => t.id !== event.callId), tcRecord])
        } else if (event.type === 'tool:result') {
          setToolCalls(prev =>
            prev.map(t =>
              t.id === event.callId
                ? { ...t, status: 'completed', result: event.result, endedAt: event.timestamp }
                : t,
            ),
          )
        } else if (event.type === 'tool:error') {
          setToolCalls(prev =>
            prev.map(t =>
              t.id === event.callId
                ? { ...t, status: 'failed', error: event.error, endedAt: event.timestamp }
                : t,
            ),
          )
        } else if (event.type === 'run:error') {
          setActiveRun(prev => prev ? { ...prev, state: 'failed', error: event.error } : null)
          setRelayError(`Run failed: ${event.error}`)
        } else if (event.type === 'run:cancel') {
          setActiveRun(prev => prev ? { ...prev, state: 'cancelled' } : null)
        }
      },
    })

    activeRuntimeRef.current = runtime

    try {
      const result = await runtime.run(promptText)

      // Add assistant response to messages
      if (result.summary.outputText) {
        const assistantMsg: ChatMessageRecord = {
          id: `msg_${Math.random().toString(36).slice(2)}_${Date.now()}`,
          chatId: activeChatId,
          role: 'assistant',
          content: result.summary.outputText,
          createdAt: new Date().toISOString(),
        }
        await wm.addMessage(assistantMsg)
        setMessages(prev => [...prev, assistantMsg])
      }

      // Refresh files and tool calls
      const [updatedFiles, updatedTc, updatedRuns] = await Promise.all([
        ws.listFiles(),
        wm.recordStore.listToolCallsForChat(activeChatId),
        wm.listRuns(activeChatId),
      ])
      setFiles(updatedFiles)
      setToolCalls(updatedTc)
      setRuns(updatedRuns)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      setActiveRun(prev => prev ? { ...prev, state: 'failed', error: errMsg } : null)

      // Explain malformed planning arguments clearly
      if (errMsg.includes('InvalidToolArgumentsError') || errMsg.includes('JSON')) {
        setRelayError(
          'The configured model failed to emit valid JSON for tool calls. Endpoint connectivity succeeded, but this model is incompatible with structured agent tool calling. Please select another model in settings.',
        )
      } else {
        setRelayError(errMsg)
      }
    } finally {
      setActiveRun(null)
      activeRuntimeRef.current = null
    }
  }, [activeChatId, activeRun, currentProvider, messages, preferences, sessionToken])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100 font-sans">
      {/* Sidebar: Chats, Storage Status, Settings */}
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={setActiveChatId}
        onCreateChat={handleCreateChat}
        onDeleteChat={handleDeleteChat}
        onExportChat={handleExportChat}
        storageStatus={storageStatus}
        preferences={preferences}
        sessionToken={sessionToken}
        onOpenSettings={() => setIsProviderModalOpen(true)}
      />

      {/* Main Conversation Column */}
      <main className="flex-1 flex flex-col min-w-0 h-full bg-zinc-900/30">
        {/* Error Banner */}
        <ErrorBanner
          message={relayError}
          onDismiss={() => setRelayError(null)}
          onAction={() => setIsProviderModalOpen(true)}
          actionLabel="Configure"
        />

        {/* Top Header */}
        <ChatHeader
          title={chats.find(c => c.id === activeChatId)?.title || 'Untitled Chat'}
          onUpdateTitle={handleUpdateTitle}
          preferences={preferences}
          pythonState={pythonState}
          onResetPython={handleResetPython}
          onOpenInspector={() => setIsInspectorOpen(true)}
          onOpenDataFlow={() => setIsDataFlowOpen(true)}
        />

        {/* Conversation Stream */}
        <ConversationView
          messages={messages}
          planItems={planItems}
          toolCalls={toolCalls}
          runs={runs}
          activeRun={activeRun}
          onDownloadFile={handleDownloadFile}
        />

        {/* Composer */}
        <Composer
          isRunning={Boolean(activeRun)}
          onSendMessage={handleSendMessage}
          onCancelRun={handleCancelRun}
          disabled={!preferences.isFixtureMode && (!currentProvider || !sessionToken)}
          disabledPlaceholder={
            !preferences.isFixtureMode && !sessionToken
              ? 'Connect to local relay and select a model in settings to begin'
              : 'Ask the agent to analyze files, generate charts, or write Python...'
          }
        />
      </main>

      {/* Workspace Files Panel */}
      <WorkspaceFiles
        files={files}
        onUploadFiles={handleUploadFiles}
        onDownloadFile={handleDownloadFile}
        onDeleteFile={handleDeleteFile}
        onPreviewFile={setPreviewFile}
      />

      {/* Modals */}
      <ProviderModal
        isOpen={isProviderModalOpen}
        onClose={() => setIsProviderModalOpen(false)}
        preferences={preferences}
        onSavePreferences={handleSavePreferences}
        sessionToken={sessionToken}
        onSetSessionToken={setSessionToken}
        currentProvider={currentProvider}
        onSetCurrentProvider={setCurrentProvider}
        onDisconnectRelay={handleDisconnectRelay}
      />

      <FilePreviewModal
        file={previewFile}
        onClose={() => setPreviewFile(null)}
        onDownload={handleDownloadFile}
        workspaceReadFileBytes={handlePreviewReadFileBytes}
      />

      <RequestInspectorModal
        isOpen={isInspectorOpen}
        onClose={() => setIsInspectorOpen(false)}
        inspectionData={inspectionData}
      />

      <DataFlowModal
        isOpen={isDataFlowOpen}
        onClose={() => setIsDataFlowOpen(false)}
      />
    </div>
  )
}

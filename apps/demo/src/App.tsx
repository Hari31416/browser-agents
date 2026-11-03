import { useState, useCallback, useEffect, useRef } from 'react'
import {
  AgentRuntime,
  OpenAIChatModel,
  DirectClient,
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
  const modelClientRef = useRef<RelayClient | DirectClient | null>(null)
  const restoredConnectionRef = useRef(false)
  const activeRuntimeRef = useRef<AgentRuntime | null>(null)
  const selectedChatIdRef = useRef<string | null>(null)
  const chatLoadRequestRef = useRef(0)
  const chatDataRevisionRef = useRef(new Map<string, number>())
  const activeRunIdRef = useRef<string | null>(null)
  const activeRunChatIdRef = useRef<string | null>(null)
  const activeRunAbortRef = useRef<AbortController | null>(null)
  const runSettlementsRef = useRef(new Map<string, { promise: Promise<void>; resolve: () => void }>())

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

  const touchChatData = useCallback((chatId: string) => {
    chatDataRevisionRef.current.set(chatId, (chatDataRevisionRef.current.get(chatId) ?? 0) + 1)
  }, [])

  const resetChatView = useCallback(() => {
    setMessages([])
    setPlanItems([])
    setToolCalls([])
    setRuns([])
    setFiles([])
    setPythonState({ status: 'idle', packages: ['numpy', 'pandas', 'matplotlib'] })
  }, [])

  const selectChat = useCallback((chatId: string | null) => {
    if (selectedChatIdRef.current === chatId) return
    selectedChatIdRef.current = chatId
    chatLoadRequestRef.current += 1
    resetChatView()
    setPreviewFile(null)
    setInspectionData(null)
    setRelayError(null)
    setActiveChatId(chatId)
  }, [resetChatView])

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
          selectedChatIdRef.current = chosenId
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
  const loadChatData = useCallback(async (chatId: string, requestId: number) => {
    const wm = workspaceManagerRef.current
    try {
      let loaded
      while (true) {
        const revision = chatDataRevisionRef.current.get(chatId) ?? 0
        loaded = await Promise.all([
          wm.getMessages(chatId),
          wm.getPlan(chatId),
          wm.listRuns(chatId),
          wm.recordStore.listToolCallsForChat(chatId),
          wm.getWorkspace(chatId).listFiles(),
        ])
        if (selectedChatIdRef.current !== chatId || chatLoadRequestRef.current !== requestId) return
        if ((chatDataRevisionRef.current.get(chatId) ?? 0) === revision) break
      }
      const [msgs, plan, rList, tcList, wsFiles] = loaded
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
      const requestId = ++chatLoadRequestRef.current
      void loadChatData(activeChatId, requestId)
    }
  }, [activeChatId, loadChatData])

  // --- Preferences update handler ---
  const handleSavePreferences = useCallback(async (
    newPrefs: ProviderPreferences, apiKey = '', discover = false,
  ): Promise<ProviderResponse | null> => {
    // Removing a persisted key must work even when the endpoint is offline.
    if (!newPrefs.saveApiKey) {
      const stored = loadPreferences()
      savePreferences({ ...stored, saveApiKey: false, savedApiKey: '' })
    }
    let client: RelayClient | DirectClient | null = null
    let provider: ProviderResponse | null = null
    let token: string | null = null
    if (!newPrefs.isFixtureMode) {
      if (newPrefs.connectionMode === 'relay') {
        const relay = new RelayClient(newPrefs.relayUrl)
        token = await relay.createSession()
        try {
          provider = await relay.registerProvider({ base_url: newPrefs.baseUrl,
            api_key: apiKey || undefined,
            models: !discover && (newPrefs.selectedModel || newPrefs.customModel)
              ? [newPrefs.selectedModel || newPrefs.customModel] : undefined })
        } catch (error) {
          await relay.deleteSession().catch(() => {})
          throw error
        }
        client = relay
      } else {
        const direct = new DirectClient(newPrefs.baseUrl, apiKey)
        const models = discover ? await direct.listModels() : []
        provider = { provider_id: 'direct', base_url: direct.baseUrl,
          has_api_key: Boolean(apiKey), discovered_models: models }
        client = direct
      }
    }
    const previous = modelClientRef.current
    modelClientRef.current = client
    if (previous instanceof RelayClient) void previous.deleteSession().catch(() => {})
    const nextPrefs = { ...newPrefs, selectedModel: newPrefs.selectedModel || newPrefs.customModel || provider?.discovered_models[0] || '' }
    setPreferences(nextPrefs)
    savePreferences(nextPrefs)
    setSessionToken(token)
    setCurrentProvider(provider)
    setRelayError(null)
    return provider
  }, [])

  useEffect(() => {
    if (restoredConnectionRef.current) return
    restoredConnectionRef.current = true
    const saved = loadPreferences()
    if (saved.isFixtureMode || !(saved.selectedModel || saved.customModel)) return
    // Saved keys reconnect in either mode. Keyless direct endpoints need no setup.
    if (saved.connectionMode === 'relay' && !saved.savedApiKey) return
    void handleSavePreferences(saved, saved.savedApiKey || '').catch(error => {
      setRelayError(error instanceof Error ? error.message : String(error))
    })
  }, [handleSavePreferences])

  const handleDisconnectRelay = useCallback(async () => {
    const client = modelClientRef.current
    modelClientRef.current = null
    if (client instanceof RelayClient) await client.deleteSession().catch(() => {})
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
    selectChat(newChat.id)
  }, [chats.length, selectChat])

  const handleDeleteChat = useCallback(async (chatId: string) => {
    const wm = workspaceManagerRef.current
    if (activeRunChatIdRef.current === chatId && activeRunIdRef.current) {
      const runId = activeRunIdRef.current
      activeRunAbortRef.current?.abort()
      activeRuntimeRef.current?.cancel('Chat deleted during an active run')
      const pending = runSettlementsRef.current.get(runId)
      if (pending) await pending.promise
    }
    await wm.deleteChat(chatId)
    await pythonManagerRef.current.disposeSession(chatId)
    const updatedChats = await wm.listChats()
    setChats(updatedChats)
    if (selectedChatIdRef.current === chatId) {
      if (updatedChats.length > 0) {
        selectChat(updatedChats[0].id)
      } else {
        const fallbackChat = await wm.createChat('New Chat')
        setChats([fallbackChat])
        selectChat(fallbackChat.id)
      }
    }
  }, [selectChat])

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
    const chatId = activeChatId
    if (!chatId) return
    const wm = workspaceManagerRef.current
    const ws = wm.getWorkspace(chatId)

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i]
      const arrayBuffer = await file.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      const path = file.name.startsWith('/') ? file.name : `/${file.name}`
      await ws.writeFile(path, bytes, { mimeType: file.type || 'application/octet-stream', source: 'user' })
    }

    const updatedFiles = await ws.listFiles()
    touchChatData(chatId)
    if (selectedChatIdRef.current === chatId) {
      setFiles(updatedFiles)
    }
  }, [activeChatId, touchChatData])

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
    const chatId = activeChatId
    if (!chatId) return
    const wm = workspaceManagerRef.current
    const ws = wm.getWorkspace(chatId)
    await ws.deleteFile(path)
    const updatedFiles = await ws.listFiles()
    touchChatData(chatId)
    if (selectedChatIdRef.current === chatId) {
      setFiles(updatedFiles)
    }
  }, [activeChatId, touchChatData])

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
    const chatId = activeChatId
    if (!chatId) return
    try {
      await pythonManagerRef.current.resetSession(chatId)
      if (selectedChatIdRef.current === chatId) {
        setPythonState({ status: 'ready', packages: ['numpy', 'pandas', 'matplotlib'] })
      }
    } catch (err) {
      if (selectedChatIdRef.current === chatId) {
        setPythonState({
          status: 'error',
          packages: ['numpy', 'pandas', 'matplotlib'],
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }, [activeChatId])

  // --- Cancel Run Handler ---
  const handleCancelRun = useCallback(() => {
    activeRunAbortRef.current?.abort()
    if (activeRuntimeRef.current) {
      activeRuntimeRef.current.cancel('Cancelled by user')
    }
  }, [])

  // --- Send Message & Agent Execution ---
  const handleSendMessage = useCallback(async (promptText: string) => {
    const runChatId = activeChatId
    if (!runChatId) return
    const wm = workspaceManagerRef.current
    const ws = wm.getWorkspace(runChatId)

    // Check concurrency
    if (activeRun || activeRunIdRef.current) {
      setRelayError('A run is already in progress for this workspace.')
      return
    }

    const now = new Date().toISOString()
    const runId = createRunId()
    activeRunIdRef.current = runId
    activeRunChatIdRef.current = runChatId
    const runAbortController = new AbortController()
    activeRunAbortRef.current = runAbortController
    let resolveRun: () => void = () => {}
    const runPromise = new Promise<void>(resolve => { resolveRun = resolve })
    runSettlementsRef.current.set(runId, { promise: runPromise, resolve: resolveRun })
    const finishRun = (runtime?: AgentRuntime) => {
      runSettlementsRef.current.delete(runId)
      resolveRun()
      if (activeRunIdRef.current === runId) {
        activeRunIdRef.current = null
        activeRunChatIdRef.current = null
        if (activeRunAbortRef.current === runAbortController) activeRunAbortRef.current = null
        setActiveRun(null)
      }
      if (!runtime || activeRuntimeRef.current === runtime) activeRuntimeRef.current = null
    }
    setActiveRun({
      runId,
      chatId: runChatId,
      state: 'running',
      step: 1,
      prompt: promptText,
      streamingText: '',
      startedAt: now,
    })

    let currentTurnText = ''
    const updateActiveRun = (update: (run: ActiveRunInfo) => ActiveRunInfo) => {
      if (activeRunIdRef.current !== runId) return
      setActiveRun(prev => prev?.runId === runId ? update(prev) : prev)
    }
    let runtime: AgentRuntime | undefined
    try {
      const storedHistory = await wm.getMessages(runChatId)
      const conversationHistory = storedHistory.flatMap(message =>
        message.role === 'user' || message.role === 'assistant'
          ? [{ role: message.role, content: message.content || '' }]
          : [],
      )

      const userMsgId = `msg_${Math.random().toString(36).slice(2)}_${Date.now()}`
      const userMsg: ChatMessageRecord = {
        id: userMsgId,
        chatId: runChatId,
        role: 'user',
        content: promptText,
        createdAt: now,
      }

      // Save user message
      await wm.addMessage(userMsg)
      touchChatData(runChatId)
      if (selectedChatIdRef.current === runChatId) setMessages(prev => [...prev, userMsg])

      // Setup Model and Executor
      let model: OpenAIChatModel | ScriptedChatModel
      let pythonExecutor: SessionPythonExecutor | MockPythonExecutor

      if (preferences.isFixtureMode) {
        // Simulated Testbed Fixture Mode
        const fixtureResponseFile = '/analysis_output.txt'
        pythonExecutor = new MockPythonExecutor(async () => {
          if (selectedChatIdRef.current === runChatId) setPythonState({ status: 'running', packages: ['numpy', 'pandas', 'matplotlib'] })
          const sampleOut = 'Dataset rows: 100\nColumns: 4\nMean calculation: 42.5\n'
          if (selectedChatIdRef.current === runChatId) setPythonState({ status: 'ready', packages: ['numpy', 'pandas', 'matplotlib'] })
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
        // Live model connection
        const activeModelId = preferences.selectedModel || preferences.customModel
        if (!currentProvider || !activeModelId) {
          setIsProviderModalOpen(true)
          setRelayError('Please configure an endpoint and select a model first.')
          return
        }

        const client = modelClientRef.current
        if (!client) {
          setRelayError('Configure a model connection first.')
          return
        }
        model = new OpenAIChatModel(client, {
          providerId: currentProvider.provider_id,
          model: activeModelId,
        })

        // Python Session for active chat
        try {
          if (selectedChatIdRef.current === runChatId) setPythonState({ status: 'initializing', packages: ['numpy', 'pandas', 'matplotlib'] })
          const session = await pythonManagerRef.current.getSession(runChatId, {
            workspace: ws,
            assetBaseUrl: '/runtime',
          })
          if (!session.isReady) {
            await session.initialize()
          }
          if (selectedChatIdRef.current === runChatId) setPythonState({ status: 'ready', packages: ['numpy', 'pandas', 'matplotlib'] })
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

      if (runAbortController.signal.aborted) {
        return
      }

      // Prepare Inspection Data for user inspection modal
      if (selectedChatIdRef.current === runChatId) setInspectionData({
        providerName: preferences.providerName,
        baseUrl: preferences.baseUrl,
        model: preferences.selectedModel || preferences.customModel || 'fixture-model',
        systemPrompt:
          'Autonomous browser agent with isolated file tools and Python WebAssembly runtime. All workspace files reside in the current working directory. Always use relative file paths (e.g., "Iris.csv", "./output.png"); never use absolute paths starting with "/". When generating files with Python, always save to the current working directory using relative paths so they are preserved in the workspace.',
        messages: [
          ...conversationHistory,
          { role: 'user', content: promptText },
        ],
        tools: [
          { name: 'write_todos', description: 'Create and update step-by-step task plan' },
          { name: 'execute_python', description: 'Run Python in isolated browser WebAssembly sandbox. Save output files using relative paths (e.g., "plot.png") in the current working directory' },
          { name: 'read_file', description: 'Read file from chat workspace using relative path (e.g., "data.csv")' },
          { name: 'write_file', description: 'Write or update file in chat workspace using relative path (e.g., "output.txt")' },
          { name: 'list_directory', description: 'List files in chat workspace ("." for root)' },
        ],
      })

      // Instantiate AgentRuntime
      runtime = new AgentRuntime({
        chatId: runChatId,
        model,
        workspace: ws,
        pythonExecutor,
        recordStore: wm.recordStore,
        systemPrompt:
          'Autonomous browser agent with isolated file tools and Python WebAssembly runtime. All workspace files reside in the current working directory. Always use relative file paths (e.g., "Iris.csv", "./output.png"); never use absolute paths starting with "/". When generating files with Python, always save to the current working directory using relative paths so they are preserved in the workspace.',
        limits: {
          maxSteps: 25,
          timeoutMs: 120_000,
          concurrency: 'reject',
        },
        onEvent: async (event: AgentEvent) => {
          if (event.type === 'text:delta') {
            currentTurnText += event.delta
            updateActiveRun(prev => ({ ...prev, streamingText: currentTurnText }))
          } else if (event.type === 'run:step') {
            updateActiveRun(prev => ({ ...prev, step: event.stepNumber }))
          } else if (event.type === 'plan:update') {
            touchChatData(runChatId)
            const nowStr = new Date().toISOString()
            if (selectedChatIdRef.current === runChatId) {
              setPlanItems(event.todos.map((t, idx) => ({
                id: t.id || `todo_${idx}`,
                chatId: runChatId,
                index: idx,
                content: t.content,
                status: t.status,
                createdAt: nowStr,
                updatedAt: nowStr,
              })))
            }
          } else if (event.type === 'tool:start') {
            // If LLM emitted text before this tool call, commit it so messages and tool calls stay intermingled
            if (currentTurnText.trim().length > 0) {
              const turnContent = currentTurnText.trim()
              currentTurnText = ''
              const turnMsg: ChatMessageRecord = {
                id: `msg_${Math.random().toString(36).slice(2)}_${Date.now()}`,
                chatId: runChatId,
                role: 'assistant',
                content: turnContent,
                createdAt: new Date(Date.parse(event.timestamp) - 1).toISOString(),
              }
              await wm.addMessage(turnMsg)
              touchChatData(runChatId)
              if (selectedChatIdRef.current === runChatId) setMessages(prev => [...prev, turnMsg])
              updateActiveRun(prev => ({ ...prev, streamingText: '' }))
            }

            const tcRecord: ToolCallRecord = {
              id: event.callId,
              runId: event.runId,
              chatId: runChatId,
              name: event.name,
              args: JSON.stringify(event.args),
              status: 'running',
              startedAt: event.timestamp,
            }
            touchChatData(runChatId)
            if (selectedChatIdRef.current === runChatId) {
              setToolCalls(prev => [...prev.filter(t => t.id !== event.callId), tcRecord])
            }
          } else if (event.type === 'tool:result') {
            touchChatData(runChatId)
            if (selectedChatIdRef.current === runChatId) {
              setToolCalls(prev =>
                prev.map(t => t.id === event.callId
                  ? { ...t, status: 'completed', result: event.result, endedAt: event.timestamp }
                  : t),
              )
            }
          } else if (event.type === 'tool:error') {
            touchChatData(runChatId)
            if (selectedChatIdRef.current === runChatId) {
              setToolCalls(prev =>
                prev.map(t => t.id === event.callId
                  ? { ...t, status: 'failed', error: event.error, endedAt: event.timestamp }
                  : t),
              )
            }
          } else if (event.type === 'run:error') {
            updateActiveRun(prev => ({ ...prev, state: 'failed', error: event.error }))
            if (selectedChatIdRef.current === runChatId) setRelayError(`Run failed: ${event.error}`)
          } else if (event.type === 'run:cancel') {
            updateActiveRun(prev => ({ ...prev, state: 'cancelled' }))
          }
        },
      })

      activeRuntimeRef.current = runtime

        const result = await runtime.run(promptText, {
          history: conversationHistory,
          currentMessageId: userMsgId,
          persistMessages: false,
          signal: runAbortController.signal,
        })

        // Earlier assistant segments are saved at tool boundaries. Save only the
        // text streamed since the last tool call, not the run's aggregate output.
        const remainingText = currentTurnText.trim()
        if (remainingText && result.state !== 'cancelled') {
          const assistantMsg: ChatMessageRecord = {
            id: `msg_${Math.random().toString(36).slice(2)}_${Date.now()}`,
            chatId: runChatId,
            role: 'assistant',
            content: remainingText,
            createdAt: new Date().toISOString(),
          }
          await wm.addMessage(assistantMsg)
          touchChatData(runChatId)
          if (selectedChatIdRef.current === runChatId) setMessages(prev => [...prev, assistantMsg])
        }

        // Refresh files and tool calls
        const [updatedFiles, updatedTc, updatedRuns] = await Promise.all([
          ws.listFiles(),
          wm.recordStore.listToolCallsForChat(runChatId),
          wm.listRuns(runChatId),
        ])
        touchChatData(runChatId)
        if (selectedChatIdRef.current === runChatId) {
          setFiles(updatedFiles)
          setToolCalls(updatedTc)
          setRuns(updatedRuns)
        }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      updateActiveRun(prev => ({ ...prev, state: 'failed', error: errMsg }))

      // Explain malformed planning arguments clearly
      if (selectedChatIdRef.current === runChatId && (errMsg.includes('InvalidToolArgumentsError') || errMsg.includes('JSON'))) {
        setRelayError(
          'The configured model failed to emit valid JSON for tool calls. Endpoint connectivity succeeded, but this model is incompatible with structured agent tool calling. Please select another model in settings.',
        )
      } else if (selectedChatIdRef.current === runChatId) {
        setRelayError(errMsg)
      }
    } finally {
      finishRun(runtime)
    }
  }, [activeChatId, activeRun, currentProvider, preferences, sessionToken, touchChatData])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100 font-sans">
      {/* Sidebar: Chats, Storage Status, Settings */}
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={selectChat}
        onCreateChat={handleCreateChat}
        onDeleteChat={handleDeleteChat}
        onExportChat={handleExportChat}
        storageStatus={storageStatus}
        preferences={preferences}
        connected={Boolean(currentProvider)}
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
          activeRun={activeRun?.chatId === activeChatId ? activeRun : null}
          onDownloadFile={handleDownloadFile}
        />

        {/* Composer */}
        <Composer
          isRunning={Boolean(activeRun)}
          onSendMessage={handleSendMessage}
          onCancelRun={handleCancelRun}
          disabled={!preferences.isFixtureMode && (!currentProvider || !(preferences.selectedModel || preferences.customModel))}
          disabledPlaceholder={
            !preferences.isFixtureMode && !currentProvider
              ? 'Configure an endpoint and select a model in settings to begin'
              : 'Ask the agent to analyze files, generate charts, or write Python...'
          }
        />
      </main>

      {/* Workspace Files Panel */}
      <WorkspaceFiles
        files={files}
        toolCalls={toolCalls}
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
        currentProvider={currentProvider}
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

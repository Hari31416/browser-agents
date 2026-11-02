import { useState, useCallback } from 'react'
import { AlertCircle, CheckCircle2, RefreshCw, X, Shield } from 'lucide-react'
import { RelayClient } from '@browser-agents/runtime'
import type { ProviderResponse } from '@browser-agents/runtime'
import type { ProviderPreferences } from '../types'

interface ProviderModalProps {
  isOpen: boolean
  onClose: () => void
  preferences: ProviderPreferences
  onSavePreferences: (prefs: ProviderPreferences) => void
  sessionToken: string | null
  onSetSessionToken: (token: string | null) => void
  currentProvider: ProviderResponse | null
  onSetCurrentProvider: (provider: ProviderResponse | null) => void
  onDisconnectRelay: () => void
}

export function ProviderModal({
  isOpen,
  onClose,
  preferences,
  onSavePreferences,
  sessionToken,
  onSetSessionToken,
  currentProvider,
  onSetCurrentProvider,
  onDisconnectRelay,
}: ProviderModalProps) {
  const [relayUrl, setRelayUrl] = useState(preferences.relayUrl)
  const [providerName, setProviderName] = useState(preferences.providerName)
  const [baseUrl, setBaseUrl] = useState(preferences.baseUrl)
  const [saveApiKey, setSaveApiKey] = useState(preferences.saveApiKey ?? false)
  const [apiKey, setApiKey] = useState(
    preferences.saveApiKey && preferences.savedApiKey ? preferences.savedApiKey : '',
  )
  const [discoveredModels, setDiscoveredModels] = useState<string[]>(
    currentProvider?.discovered_models ?? [],
  )
  const [selectedModel, setSelectedModel] = useState(preferences.selectedModel)
  const [customModel, setCustomModel] = useState(preferences.customModel)
  const [isFixtureMode, setIsFixtureMode] = useState(preferences.isFixtureMode)

  const [testingConnection, setTestingConnection] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleConnectAndRegister = useCallback(async () => {
    setTestingConnection(true)
    setStatusMessage('Connecting to local relay and registering endpoint...')
    setErrorMessage(null)

    try {
      const client = new RelayClient(relayUrl.trim())

      // 1. Establish session if not active
      let token = sessionToken
      if (!token) {
        token = await client.createSession()
        onSetSessionToken(token)
      } else {
        client.setSessionToken(token)
      }

      // 2. Register provider endpoint
      const manualModels = customModel.trim() ? [customModel.trim()] : undefined
      const response = await client.registerProvider({
        base_url: baseUrl.trim(),
        api_key: apiKey.trim() || undefined,
        models: manualModels,
      })

      onSetCurrentProvider(response)
      setDiscoveredModels(response.discovered_models)

      const activeModel =
        selectedModel && response.discovered_models.includes(selectedModel)
          ? selectedModel
          : response.discovered_models[0] || customModel.trim()

      if (activeModel) {
        setSelectedModel(activeModel)
      }

      const tokenToPersist = apiKey.trim() || (saveApiKey ? preferences.savedApiKey || '' : '')

      if (!saveApiKey) {
        setApiKey('')
      }

      // Save preferences to localStorage
      onSavePreferences({
        relayUrl: relayUrl.trim(),
        providerName: providerName.trim() || 'Custom Provider',
        baseUrl: baseUrl.trim(),
        selectedModel: activeModel || '',
        customModel: customModel.trim(),
        isFixtureMode: false,
        saveApiKey,
        savedApiKey: saveApiKey ? tokenToPersist : '',
      })

      setStatusMessage(`Provider registered: ${response.provider_id}`)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setStatusMessage(null)
    } finally {
      setTestingConnection(false)
    }
  }, [
    relayUrl,
    sessionToken,
    baseUrl,
    apiKey,
    customModel,
    selectedModel,
    providerName,
    saveApiKey,
    preferences.savedApiKey,
    onSetSessionToken,
    onSetCurrentProvider,
    onSavePreferences,
  ])

  const handleSaveOnly = useCallback(() => {
    const tokenToPersist = apiKey.trim() || (saveApiKey ? preferences.savedApiKey || '' : '')
    onSavePreferences({
      relayUrl: relayUrl.trim(),
      providerName: providerName.trim() || 'Configured Provider',
      baseUrl: baseUrl.trim(),
      selectedModel: selectedModel.trim(),
      customModel: customModel.trim(),
      isFixtureMode,
      saveApiKey,
      savedApiKey: saveApiKey ? tokenToPersist : '',
    })
    if (!saveApiKey) {
      setApiKey('')
    }
    onClose()
  }, [
    relayUrl,
    providerName,
    baseUrl,
    apiKey,
    saveApiKey,
    preferences.savedApiKey,
    selectedModel,
    customModel,
    isFixtureMode,
    onSavePreferences,
    onClose,
  ])

  const handleToggleFixtureMode = useCallback((enabled: boolean) => {
    setIsFixtureMode(enabled)
    if (enabled) {
      setSelectedModel('fixture-agent-model')
    }
  }, [])

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="provider-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-xl rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl p-6 text-zinc-100 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <h2 id="provider-modal-title" className="text-lg font-semibold tracking-tight">
              Model Endpoint Configuration
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Configure OpenAI-compatible endpoints routed through your local trusted relay.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close configuration modal"
            className="text-zinc-400 hover:text-zinc-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Execution Mode selector */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-zinc-300">Execution Mode</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleToggleFixtureMode(false)}
              className={`px-3 py-2 rounded text-xs font-medium border text-left transition ${
                !isFixtureMode
                  ? 'bg-zinc-800 border-zinc-600 text-zinc-100'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-300'
              }`}
            >
              <div className="font-semibold">Local Relay + LLM</div>
              <div className="text-[11px] text-zinc-400">Ollama, OpenAI, vLLM via local relay</div>
            </button>
            <button
              type="button"
              onClick={() => handleToggleFixtureMode(true)}
              className={`px-3 py-2 rounded text-xs font-medium border text-left transition ${
                isFixtureMode
                  ? 'bg-zinc-800 border-zinc-600 text-zinc-100'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-300'
              }`}
            >
              <div className="font-semibold">Simulated Testbed Fixture</div>
              <div className="text-[11px] text-zinc-400">Runs scripted plan, file, & python flow</div>
            </button>
          </div>
        </div>

        {!isFixtureMode ? (
          <>
            {/* Relay Status */}
            <div className="rounded border border-zinc-800 bg-zinc-950 p-3 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-sky-400" />
                <div>
                  <span className="font-medium text-zinc-200">Local Relay:</span>{' '}
                  <span className="text-zinc-400 font-mono">{relayUrl}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {sessionToken ? (
                  <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 text-[11px]">
                    Session Active
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800 text-[11px]">
                    Not Connected
                  </span>
                )}
                {sessionToken && (
                  <button
                    type="button"
                    onClick={onDisconnectRelay}
                    className="text-zinc-400 hover:text-zinc-200 text-[11px] underline ml-1"
                  >
                    Disconnect
                  </button>
                )}
              </div>
            </div>

            {/* Provider fields */}
            <div className="space-y-3">
              <div>
                <label htmlFor="input-relay-url" className="block text-xs text-zinc-400 mb-1">
                  Relay URL
                </label>
                <input
                  id="input-relay-url"
                  type="text"
                  value={relayUrl}
                  onChange={e => setRelayUrl(e.target.value)}
                  placeholder="http://127.0.0.1:8765"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-200 focus:outline-hidden focus:border-zinc-600 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="input-provider-name" className="block text-xs text-zinc-400 mb-1">
                    Provider Name
                  </label>
                  <input
                    id="input-provider-name"
                    type="text"
                    value={providerName}
                    onChange={e => setProviderName(e.target.value)}
                    placeholder="e.g. Local Ollama or OpenAI"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-200 focus:outline-hidden focus:border-zinc-600"
                  />
                </div>
                <div>
                  <label htmlFor="input-base-url" className="block text-xs text-zinc-400 mb-1">
                    Endpoint Base URL
                  </label>
                  <input
                    id="input-base-url"
                    type="text"
                    value={baseUrl}
                    onChange={e => setBaseUrl(e.target.value)}
                    placeholder="http://127.0.0.1:11434/v1"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-200 focus:outline-hidden focus:border-zinc-600 font-mono"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="input-api-key" className="block text-xs text-zinc-400">
                    API Key (Optional for local endpoints)
                  </label>
                  <span className="text-[11px] text-zinc-500">
                    {saveApiKey
                      ? 'Saved in browser local storage'
                      : 'Never persisted in browser storage'}
                  </span>
                </div>
                <input
                  id="input-api-key"
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-200 focus:outline-hidden focus:border-zinc-600 font-mono"
                />
                <div className="flex items-center gap-2 mt-2">
                  <input
                    id="save-api-key-checkbox"
                    type="checkbox"
                    checked={saveApiKey}
                    onChange={e => setSaveApiKey(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-950 text-sky-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                  />
                  <label
                    htmlFor="save-api-key-checkbox"
                    className="text-[11px] text-zinc-300 cursor-pointer select-none"
                  >
                    Save token in local storage so that it survives even when I come back to it
                  </label>
                </div>
              </div>

              <button
                type="button"
                onClick={handleConnectAndRegister}
                disabled={testingConnection}
                className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-100 px-4 py-2 rounded text-xs font-medium transition flex items-center justify-center gap-2"
              >
                {testingConnection ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Connecting & Discovering Models...</span>
                  </>
                ) : (
                  <span>Test Connection & Discover Models</span>
                )}
              </button>
            </div>

            {/* Model Selection */}
            <div className="space-y-3 border-t border-zinc-800 pt-3">
              <div>
                <label htmlFor="select-discovered-model" className="block text-xs text-zinc-400 mb-1">
                  Discovered Models ({discoveredModels.length})
                </label>
                {discoveredModels.length > 0 ? (
                  <select
                    id="select-discovered-model"
                    value={selectedModel}
                    onChange={e => setSelectedModel(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-200 focus:outline-hidden focus:border-zinc-600 font-mono"
                  >
                    {discoveredModels.map(m => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-[11px] text-zinc-500 italic bg-zinc-950 border border-zinc-800/80 rounded px-3 py-2">
                    No models discovered automatically. Enter a model ID manually below.
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="input-custom-model" className="block text-xs text-zinc-400 mb-1">
                  Manual Model ID Fallback
                </label>
                <input
                  id="input-custom-model"
                  type="text"
                  value={customModel}
                  onChange={e => {
                    setCustomModel(e.target.value)
                    if (!selectedModel) setSelectedModel(e.target.value)
                  }}
                  placeholder="e.g. qwen2.5-coder:7b or gpt-4o"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-200 focus:outline-hidden focus:border-zinc-600 font-mono"
                />
              </div>

              {/* Tool Compatibility Warning */}
              <div className="rounded border border-amber-900/60 bg-amber-950/20 p-2.5 text-xs text-amber-300 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-amber-200">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Agent Tool Compatibility Note</span>
                </div>
                <p className="text-[11px] leading-relaxed text-amber-300/90">
                  Model listing and connection tests confirm endpoint connectivity, but some models fail when emitting complex nested JSON for planning and tool arguments. If tool calling fails or emits malformed arguments, switch to an instruction-tuned model.
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded border border-zinc-800 bg-zinc-950 p-4 text-xs text-zinc-300 space-y-2">
            <div className="font-semibold text-zinc-100 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Simulated Testbed Mode Selected</span>
            </div>
            <p className="text-zinc-400 text-[11px] leading-relaxed">
              In simulated fixture mode, multi-step planning, file staging, and Python execution are exercised with deterministic local fixtures without requiring an external LLM server. This is ideal for offline testing and verification.
            </p>
          </div>
        )}

        {statusMessage && (
          <div className="p-2.5 rounded bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="p-2.5 rounded bg-red-950/40 border border-red-800 text-xs text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-200 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveOnly}
            className="bg-zinc-100 hover:bg-zinc-200 text-zinc-900 px-4 py-1.5 rounded text-xs font-medium transition"
          >
            Save Preferences
          </button>
        </div>
      </div>
    </div>
  )
}

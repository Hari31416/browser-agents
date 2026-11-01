import { useState, useCallback, useRef } from 'react'
import { RelayClient } from '@browser-agents/runtime'
import type { ProviderResponse } from '@browser-agents/runtime'

export function App() {
  const [relayUrl, setRelayUrl] = useState('http://127.0.0.1:8765')
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:11434/v1')
  const [apiKey, setApiKey] = useState('')
  const [provider, setProvider] = useState<ProviderResponse | null>(null)
  const [selectedModel, setSelectedModel] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [prompt, setPrompt] = useState('Explain how browser agents work in two sentences.')
  const [streamingOutput, setStreamingOutput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const clientRef = useRef<RelayClient>(new RelayClient(relayUrl))

  const handleInitSession = useCallback(async () => {
    setStatusMessage('Connecting to relay...')
    setErrorMessage(null)
    try {
      const client = new RelayClient(relayUrl)
      clientRef.current = client
      const token = await client.createSession()
      setSessionToken(token)
      setStatusMessage('Relay session established')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setStatusMessage(null)
    }
  }, [relayUrl])

  const handleRegisterProvider = useCallback(async () => {
    if (!sessionToken) {
      setErrorMessage('Initialize a relay session first')
      return
    }
    setStatusMessage('Registering endpoint with relay...')
    setErrorMessage(null)
    try {
      const client = clientRef.current
      const manualModels = customModel.trim() ? [customModel.trim()] : undefined
      const response = await client.registerProvider({
        base_url: baseUrl.trim(),
        api_key: apiKey.trim() || undefined,
        models: manualModels,
      })
      setProvider(response)
      if (response.discovered_models.length > 0) {
        setSelectedModel(response.discovered_models[0])
      } else if (customModel.trim()) {
        setSelectedModel(customModel.trim())
      }
      setStatusMessage(`Provider registered: ${response.provider_id}`)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setStatusMessage(null)
    }
  }, [sessionToken, baseUrl, apiKey, customModel])

  const handleTestStream = useCallback(async () => {
    const activeModel = selectedModel || customModel
    if (!provider || !activeModel) {
      setErrorMessage('Select or enter a model before testing generation')
      return
    }

    setErrorMessage(null)
    setIsStreaming(true)
    setStreamingOutput('')
    setStatusMessage('Streaming response...')

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const client = clientRef.current
      const result = await client.streamChat(
        {
          provider_id: provider.provider_id,
          model: activeModel,
          messages: [{ role: 'user', content: prompt }],
          stream: true,
        },
        {
          signal: controller.signal,
          onDelta: chunk => {
            setStreamingOutput(prev => prev + chunk)
          },
        },
      )
      setStreamingOutput(result.text)
      setStatusMessage('Stream completed successfully')
    } catch (err) {
      if (controller.signal.aborted) {
        setStatusMessage('Stream cancelled by user')
      } else {
        setErrorMessage(err instanceof Error ? err.message : String(err))
        setStatusMessage(null)
      }
    } finally {
      setIsStreaming(false)
      abortControllerRef.current = null
    }
  }, [provider, selectedModel, customModel, prompt])

  const handleCancelStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
      setIsStreaming(false)
      setStatusMessage('Stream aborted')
    }
  }, [])

  const handleEndSession = useCallback(async () => {
    try {
      await clientRef.current.deleteSession()
    } catch {
      // Ignore network errors on session end
    }
    setSessionToken(null)
    setProvider(null)
    setSelectedModel('')
    setStreamingOutput('')
    setStatusMessage('Session ended and credentials cleared')
  }, [])

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8 flex flex-col items-center">
      <div className="w-full max-w-3xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Browser Agents Relay Console</h1>
          <p className="text-zinc-400 mt-1">
            Foundation relay and model connection for browser-based autonomous agents.
          </p>
        </div>

        {/* Step 1: Trusted Relay Session */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">1. Local Relay Session</h2>
            {sessionToken ? (
              <span className="px-2 py-1 text-xs font-medium bg-emerald-950 text-emerald-400 border border-emerald-800 rounded">
                Active Session
              </span>
            ) : (
              <span className="px-2 py-1 text-xs font-medium bg-zinc-800 text-zinc-400 rounded">
                Disconnected
              </span>
            )}
          </div>
          <div className="flex gap-4">
            <input
              type="text"
              value={relayUrl}
              onChange={e => setRelayUrl(e.target.value)}
              placeholder="http://127.0.0.1:8765"
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600"
            />
            {!sessionToken ? (
              <button
                onClick={handleInitSession}
                className="bg-zinc-100 hover:bg-zinc-200 text-zinc-900 px-4 py-2 rounded text-sm font-medium transition"
              >
                Connect Relay
              </button>
            ) : (
              <button
                onClick={handleEndSession}
                className="bg-red-950 hover:bg-red-900 text-red-200 border border-red-800 px-4 py-2 rounded text-sm font-medium transition"
              >
                End Session
              </button>
            )}
          </div>
        </section>

        {/* Step 2: Endpoint Registration */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">2. Model Endpoint Setup</h2>
            {provider && (
              <span className="text-xs text-zinc-400">
                ID: {provider.provider_id}
              </span>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Endpoint Base URL</label>
              <input
                type="text"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1 or http://127.0.0.1:11434/v1"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                API Key (Optional for local keyless endpoints)
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600"
              />
            </div>

            <button
              onClick={handleRegisterProvider}
              disabled={!sessionToken}
              className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-100 px-4 py-2 rounded text-sm font-medium transition"
            >
              Register Endpoint & Discover Models
            </button>
          </div>
        </section>

        {/* Step 3: Model Selection */}
        {provider && (
          <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold">3. Select Model</h2>

            {provider.discovered_models.length > 0 ? (
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Discovered Models</label>
                <select
                  value={selectedModel}
                  onChange={e => setSelectedModel(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600"
                >
                  {provider.discovered_models.map(m => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Manual Model Identifier (Endpoint lacks discovery)
                </label>
                <input
                  type="text"
                  value={customModel}
                  onChange={e => setCustomModel(e.target.value)}
                  placeholder="e.g. gpt-4o, llama3, qwen2.5"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600"
                />
              </div>
            )}
          </section>
        )}

        {/* Step 4: Verification Stream */}
        {provider && (selectedModel || customModel) && (
          <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold">4. Test Forwarding & Cancellation</h2>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">Test Prompt</label>
              <textarea
                rows={2}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleTestStream}
                disabled={isStreaming}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-medium transition"
              >
                {isStreaming ? 'Streaming...' : 'Send Test Request'}
              </button>
              {isStreaming && (
                <button
                  onClick={handleCancelStream}
                  className="bg-amber-700 hover:bg-amber-600 text-white px-4 py-2 rounded text-sm font-medium transition"
                >
                  Abort Stream
                </button>
              )}
            </div>

            {streamingOutput && (
              <div className="mt-4">
                <label className="block text-xs text-zinc-400 mb-1">Streaming Output</label>
                <pre className="p-4 bg-zinc-950 border border-zinc-800 rounded text-sm text-zinc-300 font-mono whitespace-pre-wrap">
                  {streamingOutput}
                </pre>
              </div>
            )}
          </section>
        )}

        {/* Status and Error banners */}
        {statusMessage && (
          <div className="p-3 bg-zinc-900 border border-zinc-800 rounded text-sm text-zinc-300">
            {statusMessage}
          </div>
        )}
        {errorMessage && (
          <div className="p-3 bg-red-950 border border-red-800 rounded text-sm text-red-300">
            {errorMessage}
          </div>
        )}
      </div>
    </div>
  )
}

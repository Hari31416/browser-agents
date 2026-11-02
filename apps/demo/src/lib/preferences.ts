import type { ProviderPreferences } from '../types'

const PREFERENCES_KEY = 'browser_agents_preferences_v1'

const DEFAULT_PREFERENCES: ProviderPreferences = {
  relayUrl: 'http://127.0.0.1:8765',
  providerName: 'Local Ollama',
  baseUrl: 'http://127.0.0.1:11434/v1',
  selectedModel: '',
  customModel: '',
  isFixtureMode: false,
  saveApiKey: false,
  savedApiKey: '',
}

export function loadPreferences(): ProviderPreferences {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_PREFERENCES
    }
    const raw = localStorage.getItem(PREFERENCES_KEY)
    if (!raw) {
      return DEFAULT_PREFERENCES
    }
    const parsed = JSON.parse(raw) as Partial<ProviderPreferences>
    const saveApiKey = Boolean(parsed.saveApiKey)
    return {
      relayUrl: typeof parsed.relayUrl === 'string' && parsed.relayUrl.trim() ? parsed.relayUrl : DEFAULT_PREFERENCES.relayUrl,
      providerName: typeof parsed.providerName === 'string' ? parsed.providerName : DEFAULT_PREFERENCES.providerName,
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : DEFAULT_PREFERENCES.baseUrl,
      selectedModel: typeof parsed.selectedModel === 'string' ? parsed.selectedModel : '',
      customModel: typeof parsed.customModel === 'string' ? parsed.customModel : '',
      isFixtureMode: Boolean(parsed.isFixtureMode),
      saveApiKey,
      savedApiKey: saveApiKey && typeof parsed.savedApiKey === 'string' ? parsed.savedApiKey : '',
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function savePreferences(preferences: ProviderPreferences): void {
  try {
    if (typeof localStorage === 'undefined') return
    const saveApiKey = Boolean(preferences.saveApiKey)
    const safePayload: ProviderPreferences = {
      relayUrl: preferences.relayUrl.trim(),
      providerName: preferences.providerName.trim(),
      baseUrl: preferences.baseUrl.trim(),
      selectedModel: preferences.selectedModel.trim(),
      customModel: preferences.customModel.trim(),
      isFixtureMode: preferences.isFixtureMode,
      saveApiKey,
      ...(saveApiKey && preferences.savedApiKey ? { savedApiKey: preferences.savedApiKey.trim() } : {}),
    }
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(safePayload))
  } catch {
    // Ignore storage write issues
  }
}

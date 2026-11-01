import { PythonInitializationError } from './errors.js'
import type { AssetManifest, RuntimeAssets } from './types.js'

export class AssetLoader {
  private readonly baseUrl: string
  private static cachedAssets: RuntimeAssets | null = null

  constructor(baseUrl = '/runtime') {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  static getCachedAssets(): RuntimeAssets | null {
    return this.cachedAssets
  }

  static setCachedAssets(assets: RuntimeAssets): void {
    this.cachedAssets = assets
  }

  static clearCache(): void {
    this.cachedAssets = null
  }

  async load(forceRefresh = false): Promise<RuntimeAssets> {
    if (!forceRefresh && AssetLoader.cachedAssets) {
      return AssetLoader.cachedAssets
    }

    try {
      const manifestUrl = `${this.baseUrl}/manifest.json`
      const manifestResp = await fetch(manifestUrl)
      if (!manifestResp.ok) {
        throw new Error(`Failed to fetch manifest from ${manifestUrl}: HTTP ${manifestResp.status}`)
      }

      const manifest = (await manifestResp.json()) as AssetManifest
      if (!manifest || !Array.isArray(manifest.assets)) {
        throw new Error('Invalid manifest shape: assets array missing')
      }

      const assets: RuntimeAssets = {}

      await Promise.all(
        manifest.assets.map(async asset => {
          if (!/^[\w.+-]+$/.test(asset.file)) {
            throw new Error(`Invalid manifest asset file path: '${asset.file}'`)
          }

          const fileUrl = `${this.baseUrl}/${asset.file}`
          const fileResp = await fetch(fileUrl)
          if (!fileResp.ok) {
            throw new Error(`Failed to fetch asset ${asset.file}: HTTP ${fileResp.status}`)
          }

          const arrayBuffer = await fileResp.arrayBuffer()
          const bytes = new Uint8Array(arrayBuffer)

          if (bytes.byteLength !== asset.bytes) {
            throw new Error(
              `Asset length mismatch for ${asset.file}: expected ${asset.bytes}, got ${bytes.byteLength}`,
            )
          }

          const digestBuffer = await crypto.subtle.digest('SHA-256', bytes)
          const digest = Array.from(new Uint8Array(digestBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')

          if (digest !== asset.sha256) {
            throw new Error(
              `Asset SHA-256 integrity mismatch for ${asset.file}: expected ${asset.sha256}, got ${digest}`,
            )
          }

          assets[asset.file] = bytes
        }),
      )

      AssetLoader.cachedAssets = assets
      return assets
    } catch (err) {
      throw new PythonInitializationError(
        `Failed to load runtime assets: ${err instanceof Error ? err.message : String(err)}`,
        err,
      )
    }
  }
}

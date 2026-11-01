import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export interface BrowserAlias {
  find: string | RegExp
  replacement: string
}

export interface BrowserPlugin {
  name: string
  resolveId(id: string): string | undefined
}

export const browserAliases: BrowserAlias[] = [
  {
    find: /^(node:)?crypto$/,
    replacement: fileURLToPath(new URL('./sha256.js', import.meta.url)),
  },
  {
    find: /^(node:)?buffer$/,
    replacement: require.resolve('buffer/'),
  },
  {
    find: /^(node:)?path$/,
    replacement: require.resolve('path-browserify'),
  },
  {
    find: /^(node:)?util$/,
    replacement: require.resolve('util/'),
  },
]

export function browserUtilities(): BrowserPlugin {
  return {
    name: 'browser-node-utilities',
    resolveId(id: string): string | undefined {
      for (const alias of browserAliases) {
        if (alias.find instanceof RegExp && alias.find.test(id)) {
          return alias.replacement
        }
      }
      return undefined
    },
  }
}

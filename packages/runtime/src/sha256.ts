import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export interface HashApi {
  update(input: string | Uint8Array): HashApi
  digest(encoding?: string): Uint8Array | string
}

export function createHash(algorithm: string): HashApi {
  if (algorithm.toLowerCase() !== 'sha256') {
    throw new Error('Only SHA-256 is supported by this browser adapter.')
  }
  const hash = sha256.create()
  const api: HashApi = {
    update(input: string | Uint8Array) {
      hash.update(typeof input === 'string' ? new TextEncoder().encode(input) : input)
      return api
    },
    digest(encoding?: string) {
      if (encoding !== undefined && encoding !== 'hex') {
        throw new Error('Unsupported digest encoding')
      }
      const bytes = hash.digest()
      return encoding === 'hex' ? bytesToHex(bytes) : bytes
    },
  }
  return api
}

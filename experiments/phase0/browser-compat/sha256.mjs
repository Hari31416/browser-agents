import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
// Real synchronous SHA-256 for Deep Agents' content-addressed binary blobs.
// Unsupported Node crypto algorithms/APIs deliberately remain unsupported.
export function createHash(algorithm) {
  if(algorithm.toLowerCase()!=='sha256')throw new Error('Only SHA-256 is supported by this browser adapter.');
  const hash=sha256.create();
  const api={
    update(input){hash.update(typeof input==='string'?new TextEncoder().encode(input):input);return api;},
    digest(encoding){if(encoding!==undefined&&encoding!=='hex')throw new Error('Unsupported digest encoding');const bytes=hash.digest();return encoding==='hex'?bytesToHex(bytes):bytes;},
  };
  return api;
}

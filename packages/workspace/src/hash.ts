export async function computeHash(data: Uint8Array): Promise<string> {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  // Fallback FNV-1a 64-bit hex hash if Web Crypto subtle is unavailable
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    h1 = Math.imul(h1 ^ data[i], 0x01000193)
    h2 = Math.imul(h2 ^ ((data[i] << 1) & 0xff), 0x01000193)
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0')
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0')
  return `${part1}${part2}`
}

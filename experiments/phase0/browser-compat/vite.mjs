import {fileURLToPath} from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Actual browser utilities and synchronous SHA-256; no filesystem or async-hooks mocks.
export const browserAliases = [
  { find:/^(node:)?crypto$/,replacement:fileURLToPath(new URL('./sha256.mjs',import.meta.url)) },
  { find:/^(node:)?buffer$/,replacement:require.resolve('buffer/') },
  { find: /^(node:)?path$/, replacement: require.resolve('path-browserify') },
  { find: /^(node:)?util$/, replacement: require.resolve('util/') },
];
export function browserUtilities() {
  return {
    name: 'browser-node-utilities',
    resolveId(id) { return browserAliases.find(alias => alias.find.test(id))?.replacement; },
  };
}

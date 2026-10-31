// Trusted development-time preparation. Generated Python never runs this code.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'public/runtime');
await mkdir(out, { recursive: true });
const packageRoot = dirname(fileURLToPath(import.meta.resolve('pyodide/package.json')));
const lock = JSON.parse(await readFile(join(packageRoot, 'pyodide-lock.json'), 'utf8'));
const version = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')).version;
const names = new Set();
function include(name) {
  if (names.has(name)) return;
  const pkg = lock.packages[name];
  if (!pkg) throw Error(`Missing package ${name}`);
  names.add(name);
  for (const dependency of pkg.depends) include(dependency);
}
['numpy', 'pandas', 'matplotlib'].forEach(include);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const assets = [];
for (const file of ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
  await copyFile(join(packageRoot, file), join(out, file));
  const bytes = await readFile(join(out, file));
  assets.push({ file, sha256: sha(bytes), bytes: bytes.length });
}
for (const name of names) {
  const pkg = lock.packages[name];
  if (!/^[a-zA-Z0-9_.+-]+$/.test(pkg.file_name)) throw Error('Unsafe asset name');
  let bytes;
  try { bytes = await readFile(join(out, pkg.file_name)); } catch {}
  if (!bytes || sha(bytes) !== pkg.sha256) {
    const response = await fetch(`https://cdn.jsdelivr.net/pyodide/v${version}/full/${pkg.file_name}`);
    if (!response.ok) throw Error(`Asset HTTP ${response.status}: ${name}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (sha(bytes) !== pkg.sha256) throw Error(`Asset integrity failed: ${name}`);
    await writeFile(join(out, pkg.file_name), bytes);
  }
  assets.push({ file: pkg.file_name, package: name, sha256: pkg.sha256, bytes: bytes.length });
}
await writeFile(join(out, 'manifest.json'), JSON.stringify({ version, assets }, null, 2) + '\n');
console.log(JSON.stringify({ version, files: assets.length, bytes: assets.reduce((n, a) => n + a.bytes, 0) }));

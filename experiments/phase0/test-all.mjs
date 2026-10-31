import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const run = (args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(Error(`Check failed: ${args.at(-1)} (${code})`)));
});
// Fail on an occupied port instead of reusing an unrelated service.
const server = spawn(process.execPath, ['serve.mjs'], { stdio: ['ignore', 'pipe', 'inherit'] });
try {
  await Promise.race([
    new Promise((resolve, reject) => {
      server.stdout.once('data', resolve); server.once('error', reject);
      server.once('exit', () => reject(Error('Fixture server could not start; free port 5173')));
    }),
    delay(5000).then(() => { throw Error('Fixture startup timeout'); }),
  ]);
  for (const script of ['test-framework.mjs', 'test-isolated.mjs', 'test-protocol.mjs']) await run([script]);
  if (process.argv.includes('--provider')) await run(['--env-file=../../.env', 'test-provider.mjs']);
} finally { server.kill('SIGTERM'); }

import assert from 'node:assert/strict';
import { mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/dist/index.html');
  await page.waitForFunction(() => window.phase0Result, null, { timeout: 10000 });
  const result = await page.evaluate(() => window.phase0Result);
  assert.equal(result.ok, false, 'Reevaluate the fallback decision if Deep Agents begins working');
  assert.match(result.error, /constructor|AsyncLocalStorage|not defined/, 'Unexpected framework failure needs investigation');
  const files = await readdir('dist/assets');
  const worker = files.find(name => /^agent-.*\.js$/.test(name));
  const report = { browser: browser.version(), candidate: 'Deep Agents browser export', supported: false, error: result.error,
    uncompressedWorkerBytes: (await stat('dist/assets/' + worker)).size, decision: 'Use the bounded explicit browser loop demonstrated by the protocol and real-provider probes' };
  await mkdir('results', { recursive: true }); await writeFile('results/framework.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }

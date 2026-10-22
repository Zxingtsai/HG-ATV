import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/processes.mjs';
const stubborn = "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)";
test('media subprocess timeout also terminates a child that ignores SIGTERM', async () => {
  const started = performance.now();
  await assert.rejects(run(process.execPath, ['-e', stubborn], { timeout: 1500 }), { code: 'PROCESS_TIMEOUT' });
  assert.ok(performance.now() - started < 10000);
});
test('cancelling media processing has a bounded shutdown even for an uncooperative child', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  const started = performance.now();
  try { await assert.rejects(run(process.execPath, ['-e', stubborn], { signal: controller.signal }), { code: 'CANCELLED' }); }
  finally { clearTimeout(timer); }
  assert.ok(performance.now() - started < 10000);
});

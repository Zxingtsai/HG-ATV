import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MediaCache } from '../src/media.mjs';
import { preparePlayer } from '../scripts/prepare-player.mjs';
const SER = '7690961604636052505', EPI = '7690963410778868761';

test('same-episode overlapping requests share preparation; switching away cancels it and retry starts fresh', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hongguo-media-test-'));
  const cache = new MediaCache({ dataDir: dir }, {});
  let calls = 0, resolveSecond;
  cache.prepare = async (series, episode, key, signal) => {
    calls++;
    if (calls === 1) return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    return new Promise(resolve => { resolveSecond = () => resolve({ path: 'clear', dir: join(dir, 'clear'), bytes: 1, until: Date.now() + 10000, usedAt: Date.now() }); });
  };
  try {
    const a = cache.get(SER, EPI), b = cache.get(SER, EPI);
    const results = Promise.allSettled([a, b]);
    assert.equal(calls, 1);
    cache.abortExcept('different');
    const c = cache.get(SER, EPI);
    assert.equal(calls, 2);
    assert.deepEqual((await results).map(x => x.status), ['rejected', 'rejected']);
    resolveSecond(); assert.equal((await c).path, 'clear');
    assert.equal((await cache.get(SER, EPI)).path, 'clear'); assert.equal(calls, 2);
  } finally { await cache.close(); await rm(dir, { recursive: true, force: true }); }
});
test('clear media cache evicts old entries at the configured three-episode bound', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hongguo-media-test-'));
  const cache = new MediaCache({ dataDir: dir }, {});
  try {
    for (let n = 0; n < 4; n++) {
      const folder = join(dir, String(n)); await mkdir(folder); await writeFile(join(folder, 'episode.mp4'), 'media');
      cache.entries.set(String(n), { dir: folder, bytes: 5, until: Date.now() + 10000, usedAt: n });
    }
    await cache.prune('3');
    assert.deepEqual([...cache.entries.keys()], ['1', '2', '3']);
    await assert.rejects(readFile(join(dir, '0', 'episode.mp4')), { code: 'ENOENT' });
  } finally { await cache.close(); await rm(dir, { recursive: true, force: true }); }
});
test('a modified player component is never accepted or executed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hongguo-vendor-test-'));
  try {
    await mkdir(join(dir, 'vendor')); await writeFile(join(dir, 'vendor', 'official-player-worker.js'), 'globalThis.bad=true');
    await assert.rejects(preparePlayer(dir, async () => new Response('modified bundle')), /SHA-256/);
    assert.equal(await readFile(join(dir, 'vendor', 'official-player-worker.js'), 'utf8'), 'globalThis.bad=true');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

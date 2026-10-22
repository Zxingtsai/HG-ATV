import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pairing } from '../src/auth.mjs';
import { createService, parseRange } from '../src/main.mjs';
import { PlaybackManager } from '../src/playback.mjs';
import { EventEmitter } from 'node:events';
const SER = '7690961604636052505', EPI = '7690963410778868761';
const temp = () => mkdtemp(join(tmpdir(), 'hongguo-tv-test-'));

test('pairing persists hashes only and all paired devices survive concurrent writes', async () => {
  const dir = await temp();
  try {
    const auth = await new Pairing(dir).init();
    await assert.rejects(auth.pair('invalid', 'a'), { code: 'PAIR_CODE_INVALID' });
    const pairs = await Promise.all(['a', 'b', 'c'].map(address => auth.pair(auth.code, address, '电视')));
    const text = await readFile(auth.path, 'utf8');
    for (const pair of pairs) assert.ok(!text.includes(pair.token));
    const restarted = await new Pairing(dir).init();
    for (const pair of pairs) assert.equal(restarted.authenticate('Bearer ' + pair.token).length, 64);
    assert.throws(() => restarted.authenticate('Bearer ' + 'a'.repeat(43)), { code: 'UNAUTHORIZED' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('wrong pairing codes have a bounded attempt window', async () => {
  const dir = await temp(); let now = 1000;
  try {
    const auth = await new Pairing(dir, { clock: () => now }).init();
    for (let n = 0; n < 5; n++) await assert.rejects(auth.pair('no', 'a'), { status: 401 });
    await assert.rejects(auth.pair(auth.code, 'a'), { status: 429 });
    now += 60001;
    assert.ok((await auth.pair(auth.code, 'a')).token);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('byte ranges clamp ends and reject invalid, multiple and unsafe ranges', () => {
  assert.equal(parseRange(undefined, 100), null);
  assert.deepEqual(parseRange('bytes=10-200', 100), { start: 10, end: 99 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=0-', 100), { start: 0, end: 99 });
  for (const input of ['bytes=-', 'bytes=-0', 'bytes=100-', 'bytes=5-4', 'bytes=0-1,3-4', 'bytes=90071992547409920-']) assert.throws(() => parseRange(input, 100), { status: 416 });
});
test('API and every HLS resource require pairing; errors never include upstream details', async () => {
  const dir = await temp();
  const path = join(dir, 'segment000000.ts'); await writeFile(path, Buffer.from('0123456789'));
  const pairing = await new Pairing(dir).init();
  const website = { getHome: async () => { throw new Error('https://private/key=secret'); } };
  const playback = { streamFile: (id, name) => { if (name !== 'segment000000.ts') throw Object.assign(new Error('missing'), { code: 'NOT_FOUND', status: 404 }); return path; }, close: async () => {} };
  const service = await createService({ dataDir: dir }, { website, pairing, media: {}, playback, initializeMedia: false });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  try {
    assert.equal((await fetch(base + '/health')).status, 200);
    for (const resource of ['/api/home', '/stream/00000000-0000-0000-0000-000000000000/segment000000.ts']) assert.equal((await fetch(base + resource)).status, 401);
    const pair = await (await fetch(base + '/api/pair', { method: 'POST', body: JSON.stringify({ code: pairing.code }) })).json();
    const headers = { Authorization: 'Bearer ' + pair.token };
    const error = await (await fetch(base + '/api/home', { headers })).text();
    assert.ok(!error.includes('private') && !error.includes('secret'));
    const resource = base + '/stream/00000000-0000-0000-0000-000000000000/segment000000.ts';
    const response = await fetch(resource, { headers: { ...headers, Range: 'bytes=2-5' } });
    assert.equal(response.status, 206); assert.equal(await response.text(), '2345');
    assert.equal((await fetch(resource, { method: 'HEAD', headers })).headers.get('content-length'), '10');
    assert.equal((await fetch(base + '/api/playback', { method: 'POST', headers, body: '[' })).status, 400);
  } finally { await service.close(); await rm(dir, { recursive: true, force: true }); }
});
test('session ownership, replacement, and encoder serialization hold during overlapping seeks', async () => {
  const dir = await temp(); const children = []; let active = 0, maximum = 0;
  const media = { key: () => 'same', abortExcept() {}, get: async () => ({ path: 'unused', duration: 100 }), close: async () => {} };
  const website = { getDrama: async () => ({ episodes: [{ id: EPI }] }) };
  function spawnFn(command, args) {
    const child = new EventEmitter(); child.stderr = { resume() {} };
    children.push(child); maximum = Math.max(maximum, ++active);
    const folder = args.at(-1).replace(/[\\/]index\.m3u8$/, '');
    writeFile(join(folder, 'index.m3u8'), '#EXTM3U\n#EXTINF:2,\nsegment000000.ts\n');
    child.kill = () => { if (!child.killed) { child.killed = true; setTimeout(() => { active--; child.emit('close', 255); }, 20); } return true; };
    return child;
  }
  const manager = await new PlaybackManager({ dataDir: dir, profile: '720p', encoder: 'libx264', ffmpeg: 'unused' }, website, media, { spawnFn }).init();
  try {
    const first = await manager.start('owner', { seriesId: SER, episodeId: EPI });
    await new Promise(resolve => setTimeout(resolve, 80));
    await assert.rejects(manager.start('another', { seriesId: SER, episodeId: EPI }), { code: 'BUSY' });
    assert.throws(() => manager.get(first.id, 'another'), { status: 404 });
    const overlapping = await Promise.allSettled([10, 20].map(startSeconds => manager.start('owner', { seriesId: SER, episodeId: EPI, startSeconds })));
    const third = overlapping[1].value; assert.equal(overlapping[1].status, 'fulfilled');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(maximum, 1);
    assert.ok(overlapping[0].status === 'rejected' || manager.sessions.get(overlapping[0].value.id).cancelled);
    assert.equal(manager.get(third.id, 'owner').positionBaseSeconds, 20);
    assert.throws(() => manager.streamFile(third.id, '../episode.mp4', 'owner'), { status: 404 });
    assert.deepEqual(manager.stop(third.id, 'owner'), { ok: true });
  } finally { await manager.close(); await rm(dir, { recursive: true, force: true }); }
});

test('a slow earlier detail lookup cannot replace the newest seek', async () => {
  const dir = await temp(); const resolves = [];
  const media = { key: () => 'same', abortExcept() {}, get: async () => ({ path: 'unused', duration: 100 }), close: async () => {} };
  const website = { getDrama: () => new Promise(resolve => resolves.push(() => resolve({ episodes: [{ id: EPI }] }))) };
  const spawnFn = () => { const child = new EventEmitter(); child.stderr = { resume() {} }; child.kill = () => { queueMicrotask(() => child.emit('close', 255)); return true; }; return child; };
  const manager = await new PlaybackManager({ dataDir: dir }, website, media, { spawnFn }).init();
  try {
    const old = manager.start('owner', { seriesId: SER, episodeId: EPI, startSeconds: 10 });
    const rejected = assert.rejects(old, { code: 'PLAYBACK_SUPERSEDED' });
    const latest = manager.start('owner', { seriesId: SER, episodeId: EPI, startSeconds: 20 });
    resolves[1](); const session = await latest; resolves[0](); await rejected;
    assert.equal(manager.active.id, session.id); assert.equal(manager.active.positionBaseSeconds, 20);
  } finally { await manager.close(); await rm(dir, { recursive: true, force: true }); }
});

test('shutdown waits for the encoder even after rapid seeks evict its old session record', async () => {
  const dir = await temp(); let live = 0, cleanWhileLive = false;
  const media = { key: () => 'same', abortExcept() {}, get: async () => ({ path: 'unused', duration: 100 }), close: async () => { cleanWhileLive = live !== 0; } };
  const website = { getDrama: async () => ({ episodes: [{ id: EPI }] }) };
  const spawnFn = () => {
    const child = new EventEmitter(); child.stderr = { resume() {} }; live++;
    child.kill = signal => { if (signal === 'SIGKILL' && !child.killed) { child.killed = true; live--; queueMicrotask(() => child.emit('close', 255)); } return true; };
    return child;
  };
  const manager = await new PlaybackManager({ dataDir: dir }, website, media, { spawnFn }).init();
  try {
    const first = await manager.start('owner', { seriesId: SER, episodeId: EPI });
    while (live === 0) await new Promise(resolve => setTimeout(resolve, 5));
    for (let n = 0; n < 21; n++) await manager.start('owner', { seriesId: SER, episodeId: EPI, startSeconds: n });
    assert.equal(manager.sessions.has(first.id), false);
    await manager.close(); assert.equal(live, 0); assert.equal(cleanWhileLive, false);
  } finally { await manager.close(); await rm(dir, { recursive: true, force: true }); }
});

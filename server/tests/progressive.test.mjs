import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fragments } from '../src/fragmented-mp4.cjs';
import { GrowingMediaServer } from '../src/growing-media.mjs';
import { MediaCache } from '../src/media.mjs';
import { PlaybackManager } from '../src/playback.mjs';
import { run } from '../src/processes.mjs';
const SER = '7690961604636052505', EPI = '7690963410778868761';
const box = (type, body = Buffer.alloc(0)) => { const header = Buffer.alloc(8); header.writeUInt32BE(body.length + 8); header.write(type, 4); return Buffer.concat([header, body]); };
async function* chunks(buffer, size) { for (let i = 0; i < buffer.length; i += size) yield buffer.subarray(i, i + size); }
const collect = async iterator => { const result = []; for await (const part of iterator) result.push(part); return result; };
async function until(fn, timeout = 20000) {
  const end = Date.now() + timeout;
  for (;;) { const value = await fn(); if (value) return value; if (Date.now() >= end) throw Error('Condition timed out'); await delay(40); }
}
test('incremental MP4 framing tolerates every network split and rejects incomplete/oversized boxes', async () => {
  const init = Buffer.concat([box('ftyp'), box('moov')]);
  const body = Buffer.concat([box('moof'), box('mdat', Buffer.from('sample'))]);
  const input = Buffer.concat([init, body, body, box('mfra')]);
  for (let size = 1; size <= input.length; size++) {
    const result = await collect(fragments(chunks(input, size)));
    assert.deepEqual(result.map(p => p.kind), ['init', 'fragment', 'fragment']);
    assert.deepEqual(result.map(p => p.data), [init, body, body]);
  }
  for (const invalid of [input.subarray(0, 3), Buffer.concat([init, box('moof')]), Buffer.concat([init, body.subarray(0, -1)]), box('mdat'), Buffer.from('ffffffff6d646174', 'hex'), Buffer.from('000000006d646174', 'hex')]) {
    await assert.rejects(collect(fragments(chunks(invalid, 3))));
  }
  const extended = Buffer.alloc(16); extended.writeUInt32BE(1); extended.write('free', 4); extended.writeBigUInt64BE(16n, 8);
  assert.equal((await collect(fragments(chunks(Buffer.concat([init, extended, body]), 1)))).length, 2);
});
test('growing loopback source waits at temporary EOF, supports replay, and ends only on finish', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hg-growing-'));
  const server = await new GrowingMediaServer().init();
  try {
    const path = join(dir, 'track'); await writeFile(path, 'first'); const source = server.add(path);
    const response = await fetch(source.url, { headers: { Range: 'bytes=10-' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('accept-ranges'), 'none');
    const reader = response.body.getReader(); assert.equal(Buffer.from((await reader.read()).value).toString(), 'first');
    let ended = false; const next = reader.read().then(r => { ended = true; return r; });
    await delay(150); assert.equal(ended, false);
    await writeFile(path, 'firstsecond');
    assert.equal(Buffer.from((await next).value).toString(), 'second');
    source.finish(); assert.equal((await reader.read()).done, true);
    assert.equal(await (await fetch(source.url)).text(), 'firstsecond');
    await source.dispose(); assert.equal((await fetch(source.url)).status, 404);
    assert.equal((await fetch(source.url + '/../wrong')).status, 404);
  } finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
});

// Identity SDK only for generated unencrypted test media; never used in production.
const fakeSdk = `self.onmessage = ({data:m}) => { if(m.method==='updateValue')return;
postMessage({id:m.id,method:m.method,args:{data:{res:m.buf||m.args.buf,videoTrack:{samples:[1]},audioTrack:{samples:[1]}}}}); };`;
function prefix(buffer, count = 8) {
  let offset = 0, media = 0;
  while (offset < buffer.length) { const size = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8); offset += size; if (type === 'mdat' && ++media === count) return offset; }
  throw Error('Fixture must contain enough fragments');
}
test('real FFmpeg starts HLS before both downloads finish, survives seek, completes, and handles failure/cancel', { timeout: 90000 }, async t => {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  try { await run(ffmpeg, ['-version']); } catch { t.skip('FFmpeg is required for progressive integration'); return; }
  const dir = await mkdtemp(join(tmpdir(), 'hg-progressive-'));
  const mediaPaths = [join(dir, 'video.mp4'), join(dir, 'audio.mp4')];
  try {
    for (const [index, source] of ['testsrc2=size=160x90:rate=10', 'sine=frequency=440:sample_rate=48000'].entries()) {
      const result = await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', source, '-t', '16',
        ...(index === 0 ? ['-c:v', 'libx264', '-threads', '1', '-g', '10', '-pix_fmt', 'yuv420p'] : ['-c:a', 'aac']),
        '-movflags', '+empty_moov+default_base_moof+frag_keyframe', '-frag_duration', '1000000', mediaPaths[index]]);
      assert.equal(result.code, 0);
    }
    const buffers = await Promise.all(mediaPaths.map(path => readFile(path)));
    for (const mode of ['complete', 'failure', 'cancel']) await t.test(mode, async () => {
      const root = join(dir, mode); await mkdir(root);
      let release, rejectGate;
      const gate = new Promise((resolve, reject) => { release = resolve; rejectGate = reject; }); gate.catch(() => {});
      let finished = 0;
      const fetchFn = async (url, { signal }) => {
        const buffer = buffers[url.pathname === '/video' ? 0 : 1], split = prefix(buffer);
        let phase = 0, detach;
        return new Response(new ReadableStream({
          start(controller) {
            const abort = () => controller.error(new Error('aborted'));
            signal.addEventListener('abort', abort, { once: true });
            detach = () => signal.removeEventListener('abort', abort);
          },
          async pull(controller) {
            if (phase++ === 0) { controller.enqueue(buffer.subarray(0, split)); return; }
            try { await gate; signal.throwIfAborted(); controller.enqueue(buffer.subarray(split)); controller.close(); finished++; }
            catch (error) { if (!signal.aborted) controller.error(error); }
            finally { detach(); }
          }
        }), { headers: { 'Content-Length': String(buffer.length) } });
      };
      const config = { dataDir: root, ffmpeg, profile: '720p', encoder: 'libx264' };
      const website = { getDrama: async () => ({ episodes: (mode === 'complete' ? [EPI, '7690963491330477081', '7690963495944211481'] : [EPI]).map(id => ({ id })) }), getPlayInfo: async () => ({ duration: 16,
        main_url: 'https://test.qznovelvod.com/video', player_access_key: '', audio: { main_url: 'https://test.qznovelvod.com/audio', player_access_key: '' } }) };
      const cache = new MediaCache(config, website, { fetchFn });
      await mkdir(cache.dir); cache.sdkPath = join(root, 'fake-sdk.cjs'); await writeFile(cache.sdkPath, fakeSdk);
      cache.growing = await new GrowingMediaServer().init();
      const manager = await new PlaybackManager(config, website, cache).init();
      try {
        const session = await manager.start('tv', { seriesId: SER, episodeId: EPI });
        const ready = await until(() => { const s = manager.get(session.id, 'tv'); if (s.status === 'error') throw Error(JSON.stringify(s)); return s.status === 'ready' && s; });
        assert.equal(finished, 0, 'HLS must start while upstream is deliberately held open');
        const playlist = await readFile(manager.streamFile(ready.id, 'index.m3u8', 'tv'), 'utf8');
        assert.match(playlist, /#EXTINF:/); assert.ok(!playlist.includes('#EXT-X-ENDLIST'));
        const segment = playlist.match(/segment\d+\.ts/)[0];
        assert.equal((await run(ffmpeg, ['-v', 'error', '-i', manager.streamFile(ready.id, segment, 'tv'), '-f', 'null', '-'])).code, 0);
        if (mode === 'complete') {
          const seek = await manager.start('tv', { seriesId: SER, episodeId: EPI, startSeconds: 2 });
          await until(() => manager.get(seek.id, 'tv').status === 'ready'); assert.equal(finished, 0);
          release();
          await until(() => cache.entries.has(cache.key(SER, EPI))); await manager.active.encoderClosed;
          const final = await readFile(manager.streamFile(seek.id, 'index.m3u8', 'tv'), 'utf8'); assert.match(final, /#EXT-X-ENDLIST/);
          const duration = [...final.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
          assert.ok(duration >= 13.5 && duration <= 14.5, `seeked duration ${duration}`);
          assert.equal((await run(ffmpeg, ['-v', 'error', '-i', manager.streamFile(seek.id, 'index.m3u8', 'tv'), '-f', 'null', '-'])).code, 0);
          assert.ok((await cache.get(SER, EPI)).path.endsWith('episode.mp4'));
          await until(() => manager.get(seek.id, 'tv').prefetch?.completed === 2);
          assert.equal(cache.entries.size, 3); assert.equal(cache.pending.size, 0);
        } else if (mode === 'failure') {
          rejectGate(Error('upstream lost'));
          await until(() => manager.get(session.id, 'tv').status === 'error');
          await until(() => cache.pending.size === 0);
          assert.equal(cache.entries.size, 0); assert.equal(cache.growing.sources.size, 0);
        } else {
          manager.stop(session.id, 'tv'); release();
          await until(() => cache.pending.size === 0);
          assert.equal(cache.entries.size, 0); assert.equal(cache.growing.sources.size, 0);
        }
      } finally { release(); await manager.close(); }
      assert.deepEqual(await readdir(cache.dir), []);
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

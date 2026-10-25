// Anonymous official-website smoke probe. Never writes signed URLs or access keys.
// Holds each CDN response after >=8 complete media boxes until the first HLS is ready.
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { WORKER_SHA256 } from './prepare-player.mjs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WebsiteClient } from '../src/website.mjs';
import { MediaCache } from '../src/media.mjs';
import { PlaybackManager } from '../src/playback.mjs';
import { run } from '../src/processes.mjs';
const [outputArg, seriesId = '7690961604636052505', episodeId = '7690963410778868761'] = process.argv.slice(2);
if (!outputArg || !/^\d{10,24}$/.test(seriesId) || !/^\d{10,24}$/.test(episodeId)) throw Error('Usage: node --use-env-proxy scripts/probe-progressive.mjs NEW_REPORT_PATH [seriesId episodeId]');
const output = resolve(outputArg), dir = await mkdtemp(join(tmpdir(), 'hg-progressive-live-'));
const config = { dataDir: dir, ffmpeg: process.env.HONGGUO_FFMPEG || 'ffmpeg', profile: '720p', encoder: 'libx264' };
const report = { workerSha256: WORKER_SHA256, observedAt: new Date().toISOString(), seriesId, episodeId, scope: 'Anonymous website + pinned official player; software FFmpeg; CDN bodies held after 8 mdat boxes until playable HLS. No physical TV validation.', tracks: [] };
let release;
const gate = new Promise(resolve => { release = resolve; });
const fetchFn = async (url, options) => {
  const response = await fetch(url, options);
  if (!response.ok || !response.body) return response;
  const track = { bytes: 0, mediaBoxes: 0, held: false, finished: false }; report.tracks.push(track);
  const reader = response.body.getReader(); let pending = Buffer.alloc(0), offset = 0;
  return new Response(new ReadableStream({
    async pull(controller) {
      try {
        if (track.mediaBoxes >= 8 && !track.held) {
          track.held = true;
          // Abort also releases the probe gate through the outer finally block.
          await gate;
        }
        options.signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) { track.finished = true; controller.close(); return; }
        track.bytes += value.length; pending = Buffer.concat([pending.subarray(offset), value]); offset = 0;
        while (pending.length - offset >= 8) {
          let size = pending.readUInt32BE(offset); const type = pending.toString('ascii', offset + 4, offset + 8);
          if (size === 1) { if (pending.length - offset < 16) break; size = Number(pending.readBigUInt64BE(offset + 8)); }
          if (size < 8 || size > 32 * 1024 * 1024) throw Error('Invalid probe MP4 bounds');
          if (pending.length - offset < size) break;
          if (type === 'mdat') track.mediaBoxes++;
          offset += size;
        }
        controller.enqueue(value);
      } catch (error) { controller.error(error); await reader.cancel().catch(() => {}); }
    },
    cancel() { return reader.cancel(); }
  }), { status: response.status, headers: response.headers });
};
const snapshot = process.env.HONGGUO_PROBE_DETAIL_HTML
  ? await readFile(process.env.HONGGUO_PROBE_DETAIL_HTML, 'utf8') : null;
report.detailSource = snapshot === null ? { mode: 'live' }
  : { mode: 'retained-public-html', sha256: createHash('sha256').update(snapshot).digest('hex') };
const website = new WebsiteClient({ fetchFn: (url, options) => snapshot !== null && url.pathname === '/detail'
  ? Promise.resolve(new Response(snapshot)) : fetch(url, options) });
const cache = new MediaCache(config, website, { fetchFn });
let manager;
const started = Date.now();
try {
  await cache.init(); manager = await new PlaybackManager(config, website, cache).init();
  const session = await manager.start('probe', { seriesId, episodeId });
  for (;;) {
    const view = manager.get(session.id, 'probe');
    if (view.status === 'error') throw Object.assign(Error('Playback failed'), { code: view.errorCode });
    if (view.status === 'ready') {
      report.firstHlsMs = Date.now() - started;
      report.tracksAtFirstHls = structuredClone(report.tracks);
      report.startedBeforeDownloadFinished = report.tracks.some(track => !track.finished);
      report.durationSeconds = view.durationSeconds;
      break;
    }
    if (Date.now() - started > 90000) throw Error('Probe readiness timeout');
    await delay(100);
  }
  release();
  await cache.get(seriesId, episodeId);
  report.downloadAndCacheMs = Date.now() - started;
  await manager.active.encoderClosed;
  if (manager.get(session.id, 'probe').status !== 'ready') throw Error('Encoder failed');
  const path = manager.streamFile(session.id, 'index.m3u8', 'probe');
  const playlist = await readFile(path, 'utf8');
  report.endList = playlist.includes('#EXT-X-ENDLIST');
  report.hlsSeconds = [...playlist.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
  report.segments = [...playlist.matchAll(/#EXTINF:/g)].length;
  const decoded = await run(config.ffmpeg, ['-v', 'error', '-i', path, '-progress', 'pipe:1', '-f', 'null', '-'], { timeout: 180000 });
  report.decodeExitCode = decoded.code;
  report.decodedSeconds = Number([...decoded.stdout.matchAll(/^out_time_us=(\d+)/gm)].at(-1)?.[1] || 0) / 1e6;
  report.ok = report.startedBeforeDownloadFinished && report.endList && decoded.code === 0 && report.decodedSeconds >= report.durationSeconds - 2;
} catch (error) { report.ok = false; report.errorCode = error.code || 'PROBE_FAILED'; }
finally {
  release(); if (manager) await manager.close(); else await cache.close();
  await rm(dir, { recursive: true, force: true });
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;

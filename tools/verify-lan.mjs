// Opt-in real source integration: normal official API + player + authenticated HLS.
// Does not write access keys, pairing tokens or signed upstream URLs.
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configuration } from '../server/src/config.mjs';
import { createService } from '../server/src/main.mjs';
import { chooseEncoder } from '../server/src/encoding.mjs';
import { run } from '../server/src/processes.mjs';
if (!process.argv.includes('--real-source')) throw new Error('Explicit --real-source is required');
const dataDir = await mkdtemp(join(tmpdir(), 'hongguo-real-'));
const config = { ...configuration(), bind: '127.0.0.1', dataDir };
config.encoder = await chooseEncoder(config.ffmpeg, config.encoder);
// Reuse only the SHA-256 verified public worker; no credentials or media cache copied.
const service = await createService(config);
await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${service.server.address().port}`;
const record = { observedAt: new Date().toISOString(), environment: 'Linux cloud; not the user Windows hardware', profile: config.profile, encoder: config.encoder, stages: [] };
try {
  const paired = await (await fetch(base + '/api/pair', { method: 'POST', body: JSON.stringify({ code: service.pairing.code, clientName: 'real-source-verification' }) })).json();
  const headers = { Authorization: 'Bearer ' + paired.token };
  const request = async (path, options = {}) => {
    const r = await fetch(base + path, { ...options, headers });
    const value = await r.json();
    if (!r.ok) throw new Error(value.error?.code || 'RequestFailed');
    return value;
  };
  const home = await request('/api/home');
  record.homeSections = home.sections.map(s => ({ title: s.title, count: s.items.length }));
  const seriesId = '7690961604636052505', episodeId = '7690963410778868761';
  record.seriesId = seriesId; record.episodeId = episodeId;
  record.phase = 'playback';
  const started = performance.now();
  let session = await request('/api/playback', { method: 'POST', body: JSON.stringify({ seriesId, episodeId }) });
  for (let n = 0; n < 240; n++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    session = await request('/api/playback/' + session.id);
    if (record.stages.at(-1) !== session.stage) { record.stages.push(session.stage); console.log(session.stage); }
    if (session.status === 'error') throw new Error(session.errorCode);
    if (session.status === 'ready') break;
  }
  if (session.status !== 'ready') throw new Error('ReadyTimeout');
  record.firstReadySeconds = (performance.now() - started) / 1000;
  record.expectedDuration = session.durationSeconds;
  record.phase = 'transcode';
  let manifest;
  for (let n = 0; n < 600; n++) {
    const response = await fetch(base + session.playlistUrl, { headers });
    manifest = await response.text();
    if (manifest.includes('#EXT-X-ENDLIST')) break;
    const current = await request('/api/playback/' + session.id);
    if (current.status === 'error') throw new Error(current.errorCode);
    await request('/api/playback/' + session.id + '/heartbeat', { method: 'POST', body: '{}' });
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!manifest.includes('#EXT-X-ENDLIST')) throw new Error('TranscodeTimeout');
  record.phase = 'segments';
  const playlistBase = session.playlistUrl.slice(0, session.playlistUrl.lastIndexOf('/') + 1);
  const segments = manifest.split('\n').filter(line => /^segment\d{6}\.ts$/.test(line));
  for (const name of segments) {
    const response = await fetch(base + playlistBase + name, { headers });
    if (!response.ok) throw new Error('SegmentFailed');
    await writeFile(join(dataDir, name), new Uint8Array(await response.arrayBuffer()));
  }
  const localPlaylist = join(dataDir, 'verification.m3u8');
  await writeFile(localPlaylist, manifest);
  record.phase = 'decode';
  const decoded = await run(config.ffmpeg, ['-v', 'error', '-xerror', '-i', localPlaylist, '-progress', 'pipe:1', '-nostats', '-f', 'null', '-'], { timeout: 360000 });
  record.segmentCount = segments.length;
  record.completeHlsDecoded = decoded.code === 0 && decoded.stdout.includes('progress=end') && !decoded.stderr.trim();
  record.decodeFrame = Number([...decoded.stdout.matchAll(/^frame=(\d+)/gm)].at(-1)?.[1] || 0);
  record.decodeOutTime = [...decoded.stdout.matchAll(/^out_time=(.+)$/gm)].at(-1)?.[1];
  if (!record.completeHlsDecoded) throw new Error('FullDecodeFailed');
  record.phase = 'seek';
  const seekStart = performance.now();
  session = await request('/api/playback', { method: 'POST', body: JSON.stringify({ seriesId, episodeId, startSeconds: 50 }) });
  for (let n = 0; n < 60; n++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    session = await request('/api/playback/' + session.id);
    if (session.status !== 'preparing') break;
  }
  record.seekReadySeconds = (performance.now() - seekStart) / 1000;
  record.seekPassed = session.status === 'ready' && session.positionBaseSeconds === 50;
  await request('/api/playback/' + session.id, { method: 'DELETE' });
  record.stoppedSessionStatus = (await fetch(base + '/api/playback/' + session.id, { headers })).status;
  record.passed = record.completeHlsDecoded && record.seekPassed && record.stoppedSessionStatus === 404;
} catch (error) { console.log('Verification error:', error.name, String(error.message).slice(0,100)); record.passed = false; record.failureCode = /^[A-Z_]+$/.test(error.message) ? error.message : 'INTEGRATION_FAILED'; }
finally { await service.close(); await rm(dataDir, { recursive: true, force: true }); }
await writeFile(new URL('../research/protocol-pass2/web-player/product-integration.json', import.meta.url), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));
if (!record.passed) process.exitCode = 1;

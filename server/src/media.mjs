import { mkdir, rm, stat, open, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AppError, cancelled } from './errors.mjs';
import { run } from './processes.mjs';
import { GrowingMediaServer } from './growing-media.mjs';
import { preparePlayer } from '../scripts/prepare-player.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const MAX_TRACK_BYTES = 256 * 1024 * 1024;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36';
const unavailable = () => new AppError('PLAYBACK_UNAVAILABLE', '这集暂时无法播放，请稍后重试或选择其他集', 502);
function mediaUrl(raw) {
  const url = new URL(raw);
  // Only official CDN responses can supply these URLs; clients cannot supply URLs.
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !['qznovelvod.com', 'douyinvod.com', 'bytevod.com', 'bytecdn.cn', 'fqnovelpic.com', 'snssdk.com', 'pstatp.com', 'hongguoduanju.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host))) throw unavailable();
  return url;
}
async function download(raw, path, signal, fetchFn = fetch) {
  const url = mediaUrl(raw);
  const response = await fetchFn(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]), redirect: 'error',
    headers: { 'User-Agent': UA, Referer: 'https://hongguoduanju.com/' } });
  if (!response.ok || Number(response.headers.get('content-length') || 0) > MAX_TRACK_BYTES) throw unavailable();
  const file = await open(path, 'w', 0o600); let total = 0;
  try {
    for await (const chunk of response.body) {
      signal.throwIfAborted(); total += chunk.length;
      if (total > MAX_TRACK_BYTES) throw unavailable();
      let offset = 0;
      while (offset < chunk.length) offset += (await file.write(chunk, offset, chunk.length - offset)).bytesWritten;
    }
  } finally { await file.close(); }
  if (total < 100) throw unavailable();
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) !== total) throw unavailable();
  await writeFile(path + '.complete', '', { mode: 0o600 });
}
export class MediaCache {
  constructor(config, website, { fetchFn = fetch } = {}) { this.fetchFn = fetchFn; this.config = config; this.website = website; this.entries = new Map(); this.pending = new Map(); this.pins = new Map(); this.dir = join(config.dataDir, 'media'); }
  async init() {
    // This directory is exclusively temporary. Never scan/delete outside it.
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.dir)) if (/^[a-f0-9]{32}(?:-[a-f0-9-]{36})?$/.test(name)) await rm(join(this.dir, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    this.sdkPath = await preparePlayer(this.config.dataDir);
    this.growing = await new GrowingMediaServer().init();
    return this;
  }
  key(seriesId, episodeId) { return createHash('sha256').update(`${seriesId}:${episodeId}`).digest('hex').slice(0, 32); }
  pin(key) {
    this.pins.set(key, (this.pins.get(key) || 0) + 1);
    let released = false;
    return () => {
      if (released) return; released = true;
      const count = this.pins.get(key) - 1;
      if (count) this.pins.set(key, count); else this.pins.delete(key);
    };
  }
  async get(seriesId, episodeId, onStage = () => {}, { progressive = false } = {}) {
    const key = this.key(seriesId, episodeId), cached = this.entries.get(key);
    if (cached && (cached.until > Date.now() || this.pins.has(key))) { cached.usedAt = Date.now(); return cached; }
    if (cached) { await cached.release?.(); await rm(cached.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); this.entries.delete(key); }
    const existing = this.pending.get(key);
    if (existing && !existing.controller.signal.aborted) {
      existing.listeners.add(onStage); onStage(existing.stage); return this.waitFor(existing, onStage, progressive);
    }
    const controller = new AbortController(), listeners = new Set([onStage]);
    const job = { controller, listeners, stage: '正在取得播放信息' };
    let readyResolve, readyReject;
    job.ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    job.ready.catch(() => {});
    const stage = text => { job.stage = text; for (const listener of listeners) listener(text); };
    job.promise = this.prepare(seriesId, episodeId, key, controller.signal, stage, readyResolve)
      .then(async result => { this.entries.set(key, result); await this.prune(key); readyResolve(result); return result; })
      .catch(error => { readyReject(error); throw error; })
      .finally(() => { if (this.pending.get(key) === job) this.pending.delete(key); });
    job.promise.catch(() => {}); // May finish/fail after a progressive caller has started playing.
    this.pending.set(key, job);
    return this.waitFor(job, onStage, progressive);
  }
  waitFor(job, listener, progressive) {
    const result = progressive ? job.ready.then(media => ({ ...media, completion: job.promise })) : job.promise;
    return result.finally(() => job.listeners.delete(listener));
  }
  abortExcept(keepKey) { for (const [key, job] of this.pending) if (key !== keepKey) job.controller.abort(); }
  async prepare(seriesId, episodeId, key, signal, stage, onReady = () => {}) {
    const dir = join(this.dir, key + '-' + randomUUID());
    await mkdir(dir, { recursive: true, mode: 0o700 });
    let sources = [];
    const release = async () => { await Promise.all(sources.map(source => source.dispose())); };
    try {
      stage('正在取得播放信息');
      let info;
      for (const definition of ['720p', '480p', '360p']) {
        try { info = await this.website.getPlayInfo(seriesId, episodeId, definition, { signal }); break; }
        catch (error) { if (signal.aborted) throw cancelled(); if (error.code !== 'PLAYBACK_UNAVAILABLE') throw error; }
      }
      if (!info) throw unavailable();
      const duration = Number(info.duration);
      if (!Number.isFinite(duration) || duration <= 0) throw unavailable();
      stage('正在缓冲首批音视频');
      const encryptedVideo = join(dir, 'video.encrypted.mp4'), encryptedAudio = join(dir, 'audio.encrypted.mp4');
      const video = join(dir, 'video.clear.mp4'), audio = join(dir, 'audio.clear.mp4');
      sources = [this.growing.add(video), this.growing.add(audio)];
      const workController = new AbortController();
      const workSignal = AbortSignal.any([signal, workController.signal]);
      const downloads = [download(info.main_url, encryptedVideo, workSignal, this.fetchFn), download(info.audio.main_url, encryptedAudio, workSignal, this.fetchFn)];
      const job = { sdkPath: this.sdkPath, tracks: [
        { input: encryptedVideo, output: video, growing: true, isVideo: true, secretKey: info.player_access_key },
        { input: encryptedAudio, output: audio, growing: true, isVideo: false, secretKey: info.audio.player_access_key }] };
      let lines = '', videoReady = false, audioReady = false, announced = false;
      const worker = run(process.execPath, [join(here, 'sdk-worker.cjs')], {
        input: JSON.stringify(job), signal: workSignal, timeout: 180000,
        onStdout(chunk) {
          lines += chunk;
          let end;
          while ((end = lines.indexOf('\n')) !== -1) {
            const message = JSON.parse(lines.slice(0, end)); lines = lines.slice(end + 1);
            if (message.event === 'trackReady') {
              if (message.isVideo) videoReady = true; else audioReady = true;
              if (videoReady && audioReady && !announced) {
                announced = true;
                onReady({ dir, duration, inputs: sources.map(source => source.url) });
              }
            }
            if (message.event === 'trackDone') sources[message.isVideo ? 0 : 1].finish();
          }
        }
      }).then(result => {
        const final = JSON.parse(result.stdout.trim().split('\n').at(-1));
        if (result.code !== 0 || !final.ok) throw new AppError('PLAYER_FORMAT_ERROR', '这集的播放格式暂不兼容，请尝试其他集', 502);
      });
      const work = [...downloads, worker];
      try { await Promise.all(work); }
      catch (error) { workController.abort(); await Promise.allSettled(work); throw error; }
      stage('正在保存本集缓存');
      const path = join(dir, 'episode.mp4');
      const merged = await run(this.config.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-i', video, '-i', audio,
        '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', path], { signal, timeout: 60000 });
      if (merged.code) throw new AppError('MEDIA_FORMAT_ERROR', '视频处理失败，请重试', 502);
      signal.throwIfAborted();
      // Signed URLs / access keys live only in this stack and child stdin.
      info = null;
      await Promise.all([encryptedVideo, encryptedAudio, encryptedVideo + '.complete', encryptedAudio + '.complete'].map(path => rm(path, { force: true })));
      return { dir, path, duration, release, bytes: (await stat(path)).size + (await stat(video)).size + (await stat(audio)).size, until: Date.now() + 15 * 60000, usedAt: Date.now() };
    } catch (error) {
      await release();
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      if (signal.aborted) throw cancelled();
      if (error instanceof AppError || error.name === 'WebsiteError') throw error;
      throw new AppError('MEDIA_PREPARE_FAILED', '准备视频失败，请检查服务器网络后重试', 502);
    }
  }
  async prune(keepKey) {
    let bytes = [...this.entries.values()].reduce((sum, value) => sum + value.bytes, 0);
    const sorted = [...this.entries].filter(([key]) => key !== keepKey && !this.pins.has(key)).sort((a, b) => a[1].usedAt - b[1].usedAt);
    for (const [key, value] of sorted) {
      if (this.entries.size <= 3 && bytes <= 1024 ** 3 && value.until > Date.now()) continue;
      await value.release?.();
      await rm(value.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); this.entries.delete(key); bytes -= value.bytes;
    }
  }
  async close() {
    this.abortExcept();
    await Promise.allSettled([...this.pending.values()].map(job => job.promise));
    await Promise.allSettled([...this.entries].map(async ([key, entry]) => {
      await entry.release?.();
      await rm(entry.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      this.entries.delete(key);
    }));
    await this.growing?.close();
  }
}

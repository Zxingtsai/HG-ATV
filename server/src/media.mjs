import { mkdir, rm, stat, open, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AppError, cancelled } from './errors.mjs';
import { run } from './processes.mjs';
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
async function download(raw, path, signal) {
  const url = mediaUrl(raw);
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]), redirect: 'error',
    headers: { 'User-Agent': UA, Referer: 'https://hongguoduanju.com/' } });
  if (!response.ok || Number(response.headers.get('content-length') || 0) > MAX_TRACK_BYTES) throw unavailable();
  const file = await open(path, 'w', 0o600); let total = 0;
  try {
    for await (const chunk of response.body) {
      signal.throwIfAborted(); total += chunk.length;
      if (total > MAX_TRACK_BYTES) throw unavailable();
      await file.write(chunk);
    }
  } finally { await file.close(); }
  if (total < 100) throw unavailable();
}
export class MediaCache {
  constructor(config, website) { this.config = config; this.website = website; this.entries = new Map(); this.pending = new Map(); this.dir = join(config.dataDir, 'media'); }
  async init() {
    // This directory is exclusively temporary. Never scan/delete outside it.
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.dir)) if (/^[a-f0-9]{32}(?:-[a-f0-9-]{36})?$/.test(name)) await rm(join(this.dir, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    this.sdkPath = await preparePlayer(this.config.dataDir);
    return this;
  }
  key(seriesId, episodeId) { return createHash('sha256').update(`${seriesId}:${episodeId}`).digest('hex').slice(0, 32); }
  async get(seriesId, episodeId, onStage = () => {}) {
    const key = this.key(seriesId, episodeId), cached = this.entries.get(key);
    if (cached && cached.until > Date.now()) { cached.usedAt = Date.now(); return cached; }
    if (cached) { await rm(cached.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); this.entries.delete(key); }
    const existing = this.pending.get(key);
    if (existing && !existing.controller.signal.aborted) {
      existing.listeners.add(onStage); onStage(existing.stage); return existing.promise.finally(() => existing.listeners.delete(onStage));
    }
    const controller = new AbortController(), listeners = new Set([onStage]);
    const job = { controller, listeners, stage: '正在取得播放信息' };
    const stage = text => { job.stage = text; for (const listener of listeners) listener(text); };
    job.promise = this.prepare(seriesId, episodeId, key, controller.signal, stage)
      .then(async result => { this.entries.set(key, result); await this.prune(key); return result; })
      .finally(() => { if (this.pending.get(key) === job) this.pending.delete(key); });
    this.pending.set(key, job);
    return job.promise.finally(() => listeners.delete(onStage));
  }
  abortExcept(keepKey) { for (const [key, job] of this.pending) if (key !== keepKey) job.controller.abort(); }
  async prepare(seriesId, episodeId, key, signal, stage) {
    const dir = join(this.dir, key + '-' + randomUUID());
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      stage('正在取得播放信息');
      let info;
      for (const definition of ['720p', '480p', '360p']) {
        try { info = await this.website.getPlayInfo(seriesId, episodeId, definition, { signal }); break; }
        catch (error) { if (signal.aborted) throw cancelled(); if (error.code !== 'PLAYBACK_UNAVAILABLE') throw error; }
      }
      if (!info) throw unavailable();
      stage('正在准备本集视频');
      const encryptedVideo = join(dir, 'video.encrypted.mp4'), encryptedAudio = join(dir, 'audio.encrypted.mp4');
      const downloadController = new AbortController();
      const downloadSignal = AbortSignal.any([signal, downloadController.signal]);
      const downloads = [download(info.main_url, encryptedVideo, downloadSignal), download(info.audio.main_url, encryptedAudio, downloadSignal)];
      try { await Promise.all(downloads); }
      catch (error) { downloadController.abort(); await Promise.allSettled(downloads); throw error; }
      stage('正在处理播放格式');
      const video = join(dir, 'video.clear.mp4'), audio = join(dir, 'audio.clear.mp4');
      const job = { sdkPath: this.sdkPath, tracks: [
        { input: encryptedVideo, output: video, isVideo: true, secretKey: info.player_access_key },
        { input: encryptedAudio, output: audio, isVideo: false, secretKey: info.audio.player_access_key }] };
      const result = await run(process.execPath, [join(here, 'sdk-worker.cjs')], {
        input: JSON.stringify(job), signal, timeout: 180000 });
      if (result.code !== 0 || !JSON.parse(result.stdout).ok) throw new AppError('PLAYER_FORMAT_ERROR', '这集的播放格式暂不兼容，请尝试其他集', 502);
      const path = join(dir, 'episode.mp4');
      const merged = await run(this.config.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-i', video, '-i', audio,
        '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', path], { signal, timeout: 60000 });
      if (merged.code) throw new AppError('MEDIA_FORMAT_ERROR', '视频处理失败，请重试', 502);
      signal.throwIfAborted();
      const duration = Number(info.duration);
      if (!Number.isFinite(duration) || duration <= 0) throw unavailable();
      // Signed URLs / access keys live only in this stack and child stdin.
      info = null;
      await Promise.all([encryptedVideo, encryptedAudio, video, audio].map(path => rm(path, { force: true })));
      return { dir, path, duration, bytes: (await stat(path)).size, until: Date.now() + 15 * 60000, usedAt: Date.now() };
    } catch (error) {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      if (signal.aborted) throw cancelled();
      if (error instanceof AppError || error.name === 'WebsiteError') throw error;
      throw new AppError('MEDIA_PREPARE_FAILED', '准备视频失败，请检查服务器网络后重试', 502);
    }
  }
  async prune(keepKey) {
    let bytes = [...this.entries.values()].reduce((sum, value) => sum + value.bytes, 0);
    const sorted = [...this.entries].filter(([key]) => key !== keepKey).sort((a, b) => a[1].usedAt - b[1].usedAt);
    for (const [key, value] of sorted) {
      if (this.entries.size <= 3 && bytes <= 1024 ** 3 && value.until > Date.now()) continue;
      await rm(value.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); this.entries.delete(key); bytes -= value.bytes;
    }
  }
  async close() {
    this.abortExcept();
    await Promise.allSettled([...this.pending.values()].map(job => job.promise));
    await Promise.allSettled([...this.entries].map(async ([key, entry]) => {
      await rm(entry.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      this.entries.delete(key);
    }));
  }
}

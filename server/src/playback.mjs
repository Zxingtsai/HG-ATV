import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError, invalid, publicError } from './errors.mjs';
import { videoArgs, threads } from './encoding.mjs';
export class PlaybackManager {
  constructor(config, website, media, { spawnFn = spawn, clock = Date.now } = {}) {
    this.config = config; this.website = website; this.media = media; this.spawnFn = spawnFn; this.clock = clock;
    this.sessions = new Map(); this.generations = new Map(); this.closed = false; this.active = null; this.encoderChain = Promise.resolve(); this.lastEncoderClosed = Promise.resolve(); this.dir = join(config.dataDir, 'streams');
    this.timer = setInterval(() => { if (this.active && this.clock() - this.active.touchedAt > 120000) this.stop(this.active.id, this.active.owner); }, 15000);
    this.timer.unref();
  }
  async init() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.dir)) if (/^[a-f0-9-]{36}$/.test(name)) await rm(join(this.dir, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    return this;
  }
  async start(owner, input) {
    const { seriesId, episodeId } = input;
    const startSeconds = input.startSeconds ?? 0;
    if (typeof seriesId !== 'string' || typeof episodeId !== 'string' || !/^[0-9]{10,24}$/.test(seriesId) || !/^[0-9]{10,24}$/.test(episodeId) || typeof startSeconds !== 'number' || !Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds > 86400) throw invalid();
    if (this.active && this.active.owner !== owner) throw new AppError('BUSY', '服务器正在为另一台电视播放，请稍后再试', 409);
    const generation = (this.generations.get(owner) || 0) + 1;
    this.generations.set(owner, generation);
    const detail = await this.website.getDrama(seriesId);
    if (this.closed || this.generations.get(owner) !== generation) throw new AppError('PLAYBACK_SUPERSEDED', '此播放请求已被新的操作替换', 409);
    if (!detail.episodes.some(episode => episode.id === episodeId)) throw new AppError('EPISODE_NOT_FOUND', '未找到这一集，请刷新选集', 404);
    if (this.active && this.active.owner !== owner) throw new AppError('BUSY', '服务器正在为另一台电视播放，请稍后再试', 409);
    const previous = this.active;
    if (previous) this.retire(previous);
    this.media.abortExcept(this.media.key(seriesId, episodeId));
    const session = { id: randomUUID(), owner, seriesId, episodeId, status: 'preparing',
      stage: '正在准备播放', positionBaseSeconds: startSeconds, touchedAt: this.clock(), cancelled: false };
    session.dir = join(this.dir, session.id);
    this.sessions.set(session.id, session); this.active = session;
    while (this.sessions.size > 20) this.sessions.delete(this.sessions.keys().next().value);
    session.task = this.prepare(session, previous);
    return this.view(session);
  }
  async prepare(session, previous) {
    try {
      await this.lastEncoderClosed;
      if (session.cancelled) return;
      const media = await this.media.get(session.seriesId, session.episodeId, text => { if (!session.cancelled) session.stage = text; });
      if (session.cancelled) return;
      session.durationSeconds = media.duration;
      session.positionBaseSeconds = Math.min(session.positionBaseSeconds, Math.max(0, media.duration - 0.5));
      session.stage = '正在启动播放';
      await mkdir(session.dir, { recursive: true, mode: 0o700 });
      // Serialize encoder replacement even when two seek requests arrive together.
      const predecessor = this.encoderChain;
      this.encoderChain = (async () => {
        await predecessor.catch(() => {});
        await this.lastEncoderClosed;
        if (session.cancelled) return;
        this.encode(session, media.path);
        this.lastEncoderClosed = session.encoderClosed;
      })();
      await this.encoderChain;
      if (session.cancelled) return;
      const deadline = this.clock() + 60000;
      while (session.status === 'preparing' && !session.cancelled) {
        try {
          const playlist = await readFile(join(session.dir, 'index.m3u8'), 'utf8');
          if (playlist.includes('#EXTINF:')) { session.status = 'ready'; session.stage = '可以播放'; return; }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (this.clock() > deadline) throw new AppError('ENCODER_TIMEOUT', '转码启动超时，请检查服务器编码器或切换至 720p', 504);
        await new Promise(resolve => { const timer = setTimeout(resolve, 200); timer.unref(); });
      }
    } catch (error) {
      if (session.cancelled) return;
      const safe = publicError(error);
      session.status = 'error'; session.errorCode = safe.error.code; session.message = safe.error.message;
      if (session.encoder) session.encoder.kill();
    }
  }
  encode(session, path) {
    const args = ['-hide_banner', '-v', 'error', '-y', '-threads', String(threads), '-filter_threads', String(threads), '-ss', String(session.positionBaseSeconds), '-i', path,
      '-map', '0:v:0', '-map', '0:a:0?', ...videoArgs(this.config.profile, this.config.encoder),
      '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0', '-hls_playlist_type', 'event',
      '-hls_flags', 'independent_segments+temp_file', '-hls_segment_filename', join(session.dir, 'segment%06d.ts'), join(session.dir, 'index.m3u8')];
    const child = this.spawnFn(this.config.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    session.encoder = child;
    // Raw stderr is never surfaced or persisted. FFmpeg receives local files only.
    child.stderr?.resume();
    session.encoderClosed = new Promise(resolve => {
      let finished = false;
      const done = code => {
        if (finished) return; finished = true;
        session.encoder = null;
        if (code !== 0 && !session.cancelled) {
          session.status = 'error'; session.errorCode = 'ENCODER_FAILED';
          session.message = '服务器转码失败，请尝试 auto 编码器和 720p 设置';
        }
        resolve();
      };
      child.on('error', () => done(-1)); child.on('close', done);
    });
  }
  owned(id, owner) {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner || session.cancelled) throw new AppError('PLAYBACK_NOT_FOUND', '播放已结束，请重新播放', 404);
    return session;
  }
  view(session) {
    return { id: session.id, status: session.status, stage: session.stage, seriesId: session.seriesId, episodeId: session.episodeId,
      positionBaseSeconds: session.positionBaseSeconds, durationSeconds: session.durationSeconds,
      ...(session.status === 'ready' ? { playlistUrl: `/stream/${session.id}/index.m3u8` } : {}),
      ...(session.status === 'error' ? { errorCode: session.errorCode, message: session.message } : {}) };
  }
  get(id, owner) { const session = this.owned(id, owner); session.touchedAt = this.clock(); return this.view(session); }
  heartbeat(id, owner) { this.owned(id, owner).touchedAt = this.clock(); return { ok: true }; }
  stop(id, owner) { const session = this.owned(id, owner); this.generations.set(owner, (this.generations.get(owner) || 0) + 1); this.retire(session); if (this.active === session) { this.active = null; this.media.abortExcept(); } return { ok: true }; }
  retire(session) {
    session.cancelled = true;
    const child = session.encoder;
    if (child) {
      child.kill();
      const killTimer = setTimeout(() => { if (session.encoder === child) child.kill('SIGKILL'); }, 3000); killTimer.unref();
    }
    const cleanup = async () => { await session.task?.catch(() => {}); await session.encoderClosed; await rm(session.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); };
    const timer = setTimeout(() => cleanup().catch(() => {}), 5000); timer.unref();
  }
  streamFile(id, name, owner) {
    const session = this.owned(id, owner);
    if (session.status !== 'ready' || !/^(index\.m3u8|segment\d{6}\.ts)$/.test(name)) throw new AppError('NOT_FOUND', '播放文件不存在', 404);
    return join(session.dir, name);
  }
  async close() {
    clearInterval(this.timer); this.closed = true;
    for (const session of this.sessions.values()) if (!session.cancelled) this.retire(session);
    this.active = null;
    this.media.abortExcept();
    await this.lastEncoderClosed;
    await Promise.allSettled([...this.sessions.values()].map(session => session.encoderClosed));
    await this.media.close();
    await Promise.allSettled([...this.sessions.values()].map(async session => { await session.task; await session.encoderClosed; await rm(session.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }));
  }
}

import { createServer } from 'node:http';
import { open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
// FFmpeg-only loopback inputs. An incomplete local file is never advertised as EOF.
// Intentionally non-seekable: playback uses decode/discard for unfinished inputs.
export class GrowingMediaServer {
  constructor() { this.sources = new Map(); this.tasks = new Set(); }
  async init() {
    this.server = createServer((req, res) => {
      const task = this.serve(req, res).catch(() => res.destroy()).finally(() => this.tasks.delete(task));
      this.tasks.add(task);
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve);
    });
    return this;
  }
  add(path) {
    const token = '/' + randomUUID();
    const source = { path, done: false, failed: false, responses: new Set(), tasks: new Set() };
    this.sources.set(token, source);
    return {
      url: `http://127.0.0.1:${this.server.address().port}${token}`,
      finish: () => { source.done = true; },
      dispose: async () => {
        source.failed = true; this.sources.delete(token);
        for (const res of source.responses) res.destroy();
        await Promise.allSettled([...source.tasks]);
      }
    };
  }
  async serve(req, res) {
    const source = this.sources.get(req.url);
    if (!source || req.method !== 'GET') { res.writeHead(404); res.end(); return; }
    let release;
    const task = new Promise(resolve => { release = resolve; });
    source.tasks.add(task); source.responses.add(res);
    let file;
    try {
      file = await open(source.path, 'r');
      // Ignore Range legally with 200: total length is not yet known and seeking
      // ahead in the downloaded bytes is not a reliable media-time seek.
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'Accept-Ranges': 'none' });
      res.flushHeaders();
      let position = 0;
      while (!res.destroyed && !source.failed) {
        const buffer = Buffer.allocUnsafe(65536);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
        if (bytesRead) {
          position += bytesRead;
          if (!res.write(buffer.subarray(0, bytesRead))) {
            await new Promise(resolve => {
              const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
              res.once('drain', done); res.once('close', done);
              if (res.destroyed) done();
            });
          }
        } else if (source.done && position >= (await file.stat()).size) { res.end(); break; }
        else await delay(50);
      }
    } finally {
      await file?.close(); source.responses.delete(res); source.tasks.delete(task); release();
    }
  }
  async close() {
    if (!this.server) return;
    for (const source of this.sources.values()) {
      source.failed = true;
      for (const res of source.responses) res.destroy();
    }
    this.server.closeAllConnections();
    await new Promise(resolve => this.server.close(resolve));
    await Promise.allSettled([...this.tasks]); this.sources.clear();
  }
}

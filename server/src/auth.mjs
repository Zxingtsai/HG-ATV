import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from './errors.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');
export class Pairing {
  constructor(dataDir, { clock = Date.now } = {}) {
    this.path = join(dataDir, 'paired-clients.json'); this.clock = clock;
    this.code = String(randomInt(0, 1000000)).padStart(6, '0'); this.clients = []; this.attempts = new Map(); this.writes = Promise.resolve();
  }
  async init() {
    await mkdir(join(this.path, '..'), { recursive: true, mode: 0o700 });
    try {
      const rows = JSON.parse(await readFile(this.path, 'utf8'));
      if (!Array.isArray(rows) || rows.some(c => !/^[a-f0-9]{64}$/.test(c.hash))) throw new Error();
      this.clients = rows.slice(-32);
    } catch (error) { if (error.code !== 'ENOENT') throw new Error('配对记录无法读取，请检查数据目录'); }
    return this;
  }
  async pair(code, address, name = '') {
    const now = this.clock();
    for (const [key, value] of this.attempts) if (value.until <= now) this.attempts.delete(key);
    const attempt = this.attempts.get(address) || { count: 0, until: now + 60000 };
    if (++attempt.count > 5 || this.attempts.size > 1024) throw new AppError('RATE_LIMIT', '尝试过于频繁，请一分钟后重试', 429);
    this.attempts.set(address, attempt);
    const input = Buffer.from(typeof code === 'string' ? code : '');
    const expected = Buffer.from(this.code);
    if (input.length !== expected.length || !timingSafeEqual(input, expected)) throw new AppError('PAIR_CODE_INVALID', '配对码不正确，请查看服务器窗口', 401);
    if (this.clients.length >= 32) throw new AppError('PAIR_LIMIT', '配对设备数量已达上限', 409);
    const token = randomBytes(32).toString('base64url');
    this.clients.push({ hash: digest(token), name: String(name).slice(0, 60), createdAt: now });
    this.writes = this.writes.catch(() => {}).then(async () => {
      await writeFile(this.path + '.tmp', JSON.stringify(this.clients), { mode: 0o600 });
      await rename(this.path + '.tmp', this.path);
    });
    await this.writes;
    return { token, serverName: '红果 TV 家庭服务' };
  }
  authenticate(header) {
    if (typeof header !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) throw new AppError('UNAUTHORIZED', '请重新连接并配对服务器', 401);
    const hash = digest(header.slice(7));
    if (!this.clients.some(c => timingSafeEqual(Buffer.from(c.hash, 'hex'), Buffer.from(hash, 'hex')))) throw new AppError('UNAUTHORIZED', '请重新连接并配对服务器', 401);
    return hash;
  }
}

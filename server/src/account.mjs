import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { OfficialAccountBrowser } from './account-browser.mjs';
import { AppError } from './errors.mjs';

const storageError = () => new AppError('ACCOUNT_STORAGE_ERROR', '账号记录无法读取或保存，请检查数据目录，或退出并重新登录', 500);
const AAD = Buffer.from('HG-ATV:official-web-account:v1');
const COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;

export function accountCookies(rows, now = Date.now()) {
  if (!Array.isArray(rows)) throw storageError();
  return rows.filter(row => row && ['hongguoduanju.com', '.hongguoduanju.com'].includes(row.domain) &&
    COOKIE_NAME.test(row.name) && typeof row.value === 'string' && row.value.length <= 8192 && !/[\x00-\x20\x7f;]/.test(row.value) &&
    typeof row.path === 'string' && row.path.startsWith('/') && row.path.length <= 1024 && !/[\x00-\x20\x7f]/.test(row.path) &&
    typeof row.secure === 'boolean' && typeof row.expires === 'number' && Number.isFinite(row.expires) && (row.expires <= 0 || row.expires * 1000 > now))
    .slice(0, 100).map(row => ({ name: row.name, value: row.value, domain: row.domain, path: row.path,
      secure: true, httpOnly: row.httpOnly === true, expires: row.expires,
      ...(['Strict', 'Lax', 'None'].includes(row.sameSite) ? { sameSite: row.sameSite } : {}) }));
}

export function cookieHeaderFor(rows, target, now = Date.now()) {
  let url; try { url = new URL(target); } catch { return ''; }
  if (url.origin !== 'https://hongguoduanju.com' || url.username || url.password) return '';
  const header = accountCookies(rows, now).filter(row => url.pathname === row.path ||
    (url.pathname.startsWith(row.path) && (row.path.endsWith('/') || url.pathname[row.path.length] === '/')))
    .sort((a, b) => b.path.length - a.path.length).map(row => `${row.name}=${row.value}`).join('; ');
  return header.length <= 16384 ? header : '';
}

export class AccountStore {
  constructor(dataDir) { this.directory = join(dataDir, 'account'); this.path = join(this.directory, 'session.enc'); this.keyPath = join(this.directory, 'session.key'); }
  async key(create = false) {
    try {
      if (create) {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        try { await writeFile(this.keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      const key = await readFile(this.keyPath);
      if (key.length !== 32) throw storageError();
      return key;
    } catch { throw storageError(); }
  }
  async load() {
    let raw;
    try { raw = await readFile(this.path); }
    catch (error) { if (error.code === 'ENOENT') return null; throw storageError(); }
    try {
      if (raw.length > 256 * 1024) throw storageError();
      const encrypted = JSON.parse(raw);
      if (encrypted.version !== 1) throw storageError();
      const decipher = createDecipheriv('aes-256-gcm', await this.key(), Buffer.from(encrypted.iv, 'base64'));
      decipher.setAAD(AAD); decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
      const data = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.data, 'base64')), decipher.final()]).toString('utf8'));
      if (typeof data.nickname !== 'string' || data.nickname.length > 80 || !Number.isFinite(data.verifiedAt)) throw storageError();
      return { nickname: data.nickname, verifiedAt: data.verifiedAt, cookies: accountCookies(data.cookies) };
    } catch { throw storageError(); }
  }
  async save(data) {
    const temporary = this.path + '.' + randomBytes(8).toString('hex') + '.tmp';
    try {
      const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
      if (plaintext.length > 180 * 1024) throw storageError();
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', await this.key(true), iv);
      cipher.setAAD(AAD);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      await writeFile(temporary, JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') }), { flag: 'wx', mode: 0o600 });
      await rename(temporary, this.path);
    } catch { throw storageError(); }
    finally { await rm(temporary, { force: true }).catch(() => {}); }
  }
  async clear() {
    try { await rm(this.path, { force: true }); await rm(this.keyPath, { force: true }); }
    catch { throw storageError(); }
  }
}

const MESSAGES = {
  signed_out: '尚未登录红果账号', saved: '已保存账号，请验证会话后使用', opening: '正在打开官网登录组件…',
  waiting_scan: '请用红果短剧 App 的“扫一扫”扫描二维码', waiting_confirm: '已扫码，请在手机上确认登录',
  verifying: '正在向官网验证登录状态…', authenticated: '官网账号已登录', expired: '会话或二维码已过期，请重新扫码',
};

export class AccountManager {
  constructor(dataDir, { browserFactory = options => new OfficialAccountBrowser(options), store = new AccountStore(dataDir), clock = Date.now, loginTimeoutMs = 300000 } = {}) {
    this.store = store; this.browserFactory = browserFactory; this.clock = clock; this.loginTimeoutMs = loginTimeoutMs;
    this.commands = Promise.resolve(); this.generation = 0; this.revision = 0; this.state = 'signed_out'; this.credentials = null;
  }
  async init() {
    try {
      this.credentials = await this.store.load();
      if (this.credentials?.cookies.length) this.state = 'saved';
    } catch { this.state = 'error'; this.errorCode = 'ACCOUNT_STORAGE_ERROR'; }
    return this;
  }
  status({ admin = false } = {}) {
    return { source: 'official_web', state: this.state, authenticated: this.state === 'authenticated',
      ...(this.credentials ? { nickname: this.credentials.nickname, verifiedAt: this.credentials.verifiedAt } : {}),
      message: this.message || MESSAGES[this.state] || '账号操作失败，请重试',
      ...(this.errorCode ? { errorCode: this.errorCode } : {}),
      ...(admin && this.image && ['waiting_scan', 'waiting_confirm'].includes(this.state) ? { qrImage: this.image } : {}) };
  }
  cookieHeader(url) { return this.state === 'authenticated' && this.credentials ? cookieHeaderFor(this.credentials.cookies, url, this.clock()) : ''; }
  mutate(action) {
    const command = this.commands.catch(() => {}).then(action);
    this.commands = command; return command;
  }
  async stopCurrent() {
    ++this.generation;
    const browser = this.browser;
    if (browser) await browser.close();
    await this.work?.catch(() => {});
    this.browser = null; this.image = null;
  }
  start({ verifyOnly = false } = {}) {
    return this.mutate(async () => {
      await this.stopCurrent();
      ++this.revision;
      this.state = verifyOnly ? 'verifying' : 'opening'; this.errorCode = null; this.message = null;
      const generation = this.generation;
      this.work = this.run(generation, verifyOnly).catch(error => {
        if (generation !== this.generation) return;
        this.state = error.code === 'ACCOUNT_QR_EXPIRED' ? 'expired' : 'error';
        this.errorCode = error instanceof AppError ? error.code : 'ACCOUNT_BROWSER_FAILED';
        this.message = error instanceof AppError ? error.message : '登录暂时失败，请重试';
      });
      return this.status({ admin: true });
    });
  }
  async run(generation, verifyOnly) {
    let confirmed = false, expired = false;
    const current = () => generation === this.generation;
    const browser = this.browserFactory({ onState: event => {
      if (!current() || confirmed) return;
      if (event.state === 'confirmed') { confirmed = true; this.state = 'verifying'; this.image = null; }
      else if (event.state === 'expired') expired = true;
      else if (['waiting_scan', 'waiting_confirm'].includes(event.state)) {
        this.state = event.state; if (event.image) this.image = event.image;
      }
    } });
    this.browser = browser;
    let timedOut = false;
    const deadlineTimer = setTimeout(() => { timedOut = true; browser.close().catch(() => {}); }, this.loginTimeoutMs);
    const accept = async result => {
      if (!current()) return;
      const cookies = accountCookies(await browser.cookies(), this.clock());
      if (!cookies.length) throw new AppError('ACCOUNT_VERIFY_FAILED', '官网未返回可保存的登录会话，请重试', 502);
      const credentials = { cookies, nickname: String(result.nickname || '红果用户').slice(0, 80), verifiedAt: this.clock() };
      if (!current()) return;
      await this.store.save(credentials);
      if (!current()) return;
      this.credentials = credentials; this.state = 'authenticated'; this.image = null; ++this.revision;
    };
    try {
      await browser.open(this.credentials?.cookies || []);
      if (!current()) return;
      const result = await browser.verify();
      if (!current()) return;
      if (result?.failed) throw new AppError('ACCOUNT_VERIFY_FAILED', '官网暂时无法验证账号，请稍后重试', 502);
      if (result?.authenticated === true) { await accept(result); return; }
      if (result?.authenticated !== false) throw new AppError('ACCOUNT_VERIFY_FAILED', '官网账号响应不完整，请重试', 502);
      this.credentials = null; await this.store.clear();
      if (!current()) return;
      if (verifyOnly) { this.state = 'expired'; return; }
      await browser.showQrLogin();
      const deadline = this.clock() + this.loginTimeoutMs;
      while (current() && this.clock() < deadline) {
        if (expired) throw new AppError('ACCOUNT_QR_EXPIRED', MESSAGES.expired, 409);
        if (confirmed) {
          // The official SDK completes its redirect after confirmation.
          for (let attempt = 0; attempt < 5 && current(); attempt++) {
            await delay(1500);
            const check = await browser.verify().catch(() => null);
            if (check?.authenticated === true) { await accept(check); return; }
          }
          if (current()) throw new AppError('ACCOUNT_VERIFY_FAILED', '手机已确认，但官网会话验证尚未成功，请重试', 502);
          return;
        }
        await delay(500);
      }
      if (current()) throw new AppError('ACCOUNT_QR_EXPIRED', MESSAGES.expired, 409);
    } catch (error) {
      if (timedOut) throw new AppError('ACCOUNT_QR_EXPIRED', MESSAGES.expired, 409);
      throw error;
    } finally { clearTimeout(deadlineTimer); await browser.close(); if (this.browser === browser) this.browser = null; }
  }
  cancel() {
    return this.mutate(async () => { await this.stopCurrent(); ++this.revision; this.state = this.credentials ? 'saved' : 'signed_out'; this.errorCode = null; this.message = null; return this.status(); });
  }
  logout() {
    return this.mutate(async () => {
      await this.stopCurrent(); ++this.revision; this.credentials = null; this.state = 'signed_out'; this.errorCode = null; this.message = null;
      await this.store.clear(); return this.status();
    });
  }
  close() { return this.mutate(() => this.stopCurrent()); }
}

// Use the official web UI and SDK in a separate, temporary browser profile.
// CDP runs over inherited pipes: no debugging port, phone injection or signatures.
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from './errors.mjs';

const ORIGIN = 'https://hongguoduanju.com';
const fail = (code = 'ACCOUNT_BROWSER_FAILED', message = '登录浏览器暂时不可用，请重试') => new AppError(code, message, 502);

export class DevToolsPipe extends EventEmitter {
  constructor(readable, writable, { timeout = 20000 } = {}) {
    super(); this.input = readable; this.output = writable; this.timeout = timeout;
    this.buffer = Buffer.alloc(0); this.pending = new Map(); this.sequence = 0; this.closed = false;
    readable.on('data', chunk => this.receive(chunk));
    readable.on('end', () => this.close()); readable.on('error', () => this.close());
    writable.on('error', () => this.close());
  }
  receive(chunk) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 8 * 1024 * 1024) return this.close();
    let end;
    while ((end = this.buffer.indexOf(0)) !== -1) {
      const raw = this.buffer.subarray(0, end); this.buffer = this.buffer.subarray(end + 1);
      let message; try { message = JSON.parse(raw.toString('utf8')); } catch { this.close(); return; }
      if (message.id) {
        const entry = this.pending.get(message.id); if (!entry) continue;
        this.pending.delete(message.id); clearTimeout(entry.timer);
        if (message.error) entry.reject(fail()); else entry.resolve(message.result || {});
      } else if (message.method) this.emit('event', message);
    }
  }
  call(method, params = {}, sessionId, timeout = this.timeout) {
    if (this.closed) return Promise.reject(fail());
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(fail('ACCOUNT_TIMEOUT', '官网登录响应超时，请重试')); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.output.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0', error => {
        if (error) this.close();
      });
    });
  }
  close() {
    if (this.closed) return; this.closed = true;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(fail()); }
    this.pending.clear(); this.emit('closed');
  }
}

export async function findBrowser(configured = process.env.HONGGUO_BROWSER) {
  const candidates = configured ? [configured] : process.platform === 'win32' ? [
    join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
    join(process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local', 'Google/Chrome/Application/chrome.exe'),
  ] : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  for (const candidate of candidates) {
    if (!isAbsolute(candidate)) continue;
    try { await access(candidate); return candidate; } catch {}
  }
  throw fail('ACCOUNT_BROWSER_MISSING', '请在服务器安装 Microsoft Edge 或 Chrome，或用 HONGGUO_BROWSER 指定完整程序路径');
}

// The site returns JPEG base64 today. Accept PNG as well, but never remote URLs.
export function qrImage(value) {
  if (typeof value !== 'string' || value.length > 1024 * 1024) return null;
  const raw = value.replace(/^data:image\/(?:jpeg|png);base64,/, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  const bytes = Buffer.from(raw, 'base64');
  const type = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'jpeg'
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' : null;
  return type ? `data:image/${type};base64,${raw}` : null;
}

export class OfficialAccountBrowser {
  constructor({ browserPath, noSandbox = process.env.HONGGUO_BROWSER_NO_SANDBOX === '1', onState = () => {} } = {}) {
    this.browserPath = browserPath; this.noSandbox = noSandbox; this.onState = onState;
    this.requests = new Map(); this.tasks = new Set(); this.stopped = false;
  }
  async open(cookies = []) {
    if (this.stopped) throw fail();
    const executable = await findBrowser(this.browserPath);
    if (this.stopped) throw fail();
    const directory = await mkdtemp(join(tmpdir(), 'hg-account-'));
    if (this.stopped) { await rm(directory, { recursive: true, force: true }); throw fail(); }
    this.directory = directory;
    const args = ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${this.directory}`,
      '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', '--window-size=1280,900', 'about:blank'];
    if (this.noSandbox) args.push('--no-sandbox');
    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (proxy) {
      const url = new URL(proxy);
      if (url.username || url.password) throw fail('ACCOUNT_PROXY_UNSUPPORTED', '登录浏览器暂不支持带用户名密码的代理配置');
      args.push(`--proxy-server=${url.origin}`);
    }
    this.child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
    this.pipe = new DevToolsPipe(this.child.stdio[4], this.child.stdio[3]);
    this.exit = new Promise(resolve => { this.child.once('exit', resolve); this.child.once('error', resolve); });
    this.child.once('error', () => this.pipe.close()); this.child.once('exit', () => this.pipe.close());
    this.version = (await this.pipe.call('Browser.getVersion')).product;
    const { targetId } = await this.pipe.call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.pipe.call('Target.attachToTarget', { targetId, flatten: true });
    this.sessionId = sessionId;
    await this.call('Page.enable'); await this.call('Runtime.enable'); await this.call('Network.enable');
    this.pipe.on('event', event => this.networkEvent(event));
    if (cookies.length) await this.call('Network.setCookies', { cookies: cookies.map(cookie => ({
      name: cookie.name, value: cookie.value, path: cookie.path,
      ...(cookie.domain.startsWith('.') ? { domain: cookie.domain } : { url: ORIGIN + cookie.path }),
      secure: true, httpOnly: cookie.httpOnly === true,
      ...(cookie.expires > 0 ? { expires: cookie.expires } : {}),
      ...(['Strict', 'Lax', 'None'].includes(cookie.sameSite) ? { sameSite: cookie.sameSite } : {}),
    })) });
    await this.call('Page.navigate', { url: ORIGIN + '/' });
    await this.waitUntil(async () => this.evaluate('Boolean(window.rspackChunkhongguo && document.querySelector("header,button"))'), 60000);
  }
  call(method, params, timeout) { return this.pipe.call(method, params, this.sessionId, timeout); }
  async evaluate(expression, timeout = 20000) {
    const value = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout);
    if (value.exceptionDetails) throw fail('ACCOUNT_SITE_CHANGED', '官网登录组件未能正常运行，请稍后重试或更新服务端');
    return value.result?.value;
  }
  async waitUntil(predicate, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (!this.stopped && Date.now() < deadline) {
      if (await predicate()) return;
      await delay(300);
    }
    throw fail('ACCOUNT_TIMEOUT', '官网登录响应超时，请重试');
  }
  // Execute the site's own checkLogin, including its normal SDK request handling.
  // Do not copy signed requests or treat QR confirmation alone as authentication.
  async verify() {
    return this.evaluate(`(async () => {
      let runtime;
      const chunks = window.rspackChunkhongguo;
      if (!chunks) throw Error('site unavailable');
      chunks.push([['hg_account_verify_' + Date.now()], {}, r => runtime = r]);
      await Promise.all(['5y',32,'u2'].map(id => runtime.e(id)));
      const {WebInterfaceSdk} = runtime('V1');
      try {
        const result = await new WebInterfaceSdk({aid:8662,isBoe:false}).login.checkLogin({});
        const data = result && typeof result.data === 'object' ? result.data : result;
        const flag = data?.has_login ?? result?.has_login;
        const uid = data?.user_id;
        const loggedIn = flag === true || flag === 1 ||
          (typeof uid === 'string' && /^[1-9][0-9]*$/.test(uid)) || (typeof uid === 'number' && uid > 0);
        if (!loggedIn) return {authenticated:false};
        const user = data.user_info || data.user || data;
        const nickname = [user.screen_name,user.nickname,user.user_name,user.name,data.screen_name,data.nickname]
          .find(x=>typeof x==='string' && x.length>0) || '红果用户';
        return {authenticated:true,nickname:nickname.slice(0,80)};
      } catch(e) {
        if (Number(e?.error_code) === 13) return {authenticated:false};
        return {failed:true};
      }
    })()`, 60000);
  }
  async showQrLogin() {
    await this.waitUntil(async () => this.evaluate(`(() => {
      if (document.querySelector('.web-login')) return true;
      const button = [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='登录');
      if (!button) return false;
      button.click(); return false;
    })()`), 45000);
    await this.waitUntil(async () => this.hasQr === true, 45000);
  }
  networkEvent(event) {
    if (event.sessionId !== this.sessionId || this.stopped) return;
    const data = event.params;
    if (event.method === 'Network.responseReceived') {
      let url; try { url = new URL(data.response.url); } catch { return; }
      if (url.origin === ORIGIN && ['/passport/web/get_qrcode/', '/passport/web/check_qrconnect/'].includes(url.pathname)) {
        this.requests.set(data.requestId, { path: url.pathname, status: data.response.status });
      }
    } else if (event.method === 'Network.loadingFailed') this.requests.delete(data.requestId);
    else if (event.method === 'Network.loadingFinished' && this.requests.has(data.requestId)) {
      const request = this.requests.get(data.requestId); this.requests.delete(data.requestId);
      if (data.encodedDataLength > 1024 * 1024 || request.status !== 200) return;
      const task = this.readQrResponse(data.requestId, request.path).catch(() => {});
      this.tasks.add(task); task.finally(() => this.tasks.delete(task));
    }
  }
  async readQrResponse(requestId, path) {
    const result = await this.call('Network.getResponseBody', { requestId });
    const text = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body;
    if (text.length > 1024 * 1024) return;
    const response = JSON.parse(text), data = response.data;
    if (response.message !== 'success' || !data || Number(data.error_code || 0) !== 0) return;
    const image = qrImage(data.qrcode);
    if (image) { this.hasQr = true; this.onState({ state: 'waiting_scan', image }); }
    if (path.includes('check_qrconnect')) {
      const status = String(data.status);
      if (['2', 'scanned'].includes(status)) this.onState({ state: 'waiting_confirm' });
      else if (['3', 'confirmed'].includes(status)) this.onState({ state: 'confirmed' });
      else if (['expired', '5'].includes(status)) this.onState({ state: 'expired' });
    }
  }
  async cookies() {
    const { cookies } = await this.call('Network.getCookies', { urls: [ORIGIN + '/', ORIGIN + '/passport/account/info/v2/'] });
    return cookies;
  }
  async close() {
    if (this.closing) return this.closing;
    this.stopped = true;
    this.closing = (async () => {
      if (this.pipe && !this.pipe.closed) {
        await this.pipe.call('Browser.close', {}, undefined, 1500).catch(() => {});
      }
      if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
        const exited = await Promise.race([this.exit.then(() => true), delay(1500).then(() => false)]);
        if (!exited) {
          this.child.kill();
          const terminated = await Promise.race([this.exit.then(() => true), delay(2000).then(() => false)]);
          if (!terminated) { this.child.kill('SIGKILL'); await Promise.race([this.exit, delay(1000)]); }
        }
      }
      this.pipe?.close();
      if (this.directory) await rm(this.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
    })();
    return this.closing;
  }
}

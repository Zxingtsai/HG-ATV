// Anonymous end-to-end probe. Never records QR values, cookies or account data.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createService } from '/workspace/HG-ATV/server/src/main.mjs';
import { AccountManager } from '/workspace/HG-ATV/server/src/account.mjs';
import { OfficialAccountBrowser } from '/workspace/HG-ATV/server/src/account-browser.mjs';
const dir = await mkdtemp(join(tmpdir(), 'hg-login-smoke-'));
const observations = [], browsers = [];
const account = await new AccountManager(dir, { browserFactory: options => {
  const browser = new OfficialAccountBrowser({ ...options, noSandbox: true }); browsers.push(browser); return browser;
} }).init();
const service = await createService({ dataDir: dir }, { account, media: {}, playback: { close: async () => {} }, website: {}, initializeMedia: false });
await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${service.server.address().port}`;
const result = { at: new Date().toISOString(), scope: 'Real local HTTP control -> owned Chromium -> official anonymous SDK verification -> real QR response -> local cancellation. No phone, SMS, account confirmation, credential values or QR data retained.' };
try {
  const page = await fetch(origin + '/account'), html = await page.text();
  const token = /const token="([A-Za-z0-9_-]{43})"/.exec(html)[1];
  const headers = { 'X-HG-Account-Token': token, Origin: origin, 'Content-Type': 'application/json' };
  result.ui_status = page.status;
  result.start_status = (await fetch(origin + '/account/api/start', { method: 'POST', headers, body: '{}' })).status;
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    const state = await (await fetch(origin + '/account/api/status', { headers })).json();
    if (observations.at(-1)?.state !== state.state) { observations.push({ state: state.state, authenticated: state.authenticated }); console.log('State:', state.state); }
    if (state.state === 'waiting_scan') {
      result.qr_ready = /^data:image\/(?:jpeg|png);base64,/.test(state.qrImage);
      result.qr_image_bytes = state.qrImage?.length;
      break;
    }
    if (state.state === 'error') { result.errorCode = state.errorCode; break; }
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  const cancel = await (await fetch(origin + '/account/api/cancel', { method: 'POST', headers, body: '{}' })).json();
  result.cancel_state = cancel.state;
  result.cookie_header_after_cancel_empty = account.cookieHeader('https://hongguoduanju.com/') === '';
  result.browsers = browsers.map(browser => ({ version: browser.version, exited: browser.child?.exitCode !== null || browser.child?.signalCode !== null }));
  result.states = observations;
} finally { await service.close(); await rm(dir, { recursive: true, force: true }); }
await writeFile(new URL('./smoke-api-result.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (!result.qr_ready || result.cancel_state !== 'signed_out' || !result.browsers.every(browser => browser.exited)) process.exitCode = 1;

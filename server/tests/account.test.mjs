import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountStore, AccountManager, accountCookies, cookieHeaderFor } from '../src/account.mjs';
import { DevToolsPipe, OfficialAccountBrowser, qrImage } from '../src/account-browser.mjs';
import { createAccountRoutes } from '../src/account-http.mjs';
import { WebsiteClient } from '../src/website.mjs';
import { createService } from '../src/main.mjs';

const cookie = (extra = {}) => ({ name: 'sessionid', value: 'test-only-session', domain: '.hongguoduanju.com', path: '/', secure: true, httpOnly: true, expires: -1, ...extra });
const credentials = { nickname: '测试账号', verifiedAt: 1234, cookies: [cookie()] };
const temp = () => mkdtemp(join(tmpdir(), 'hg-account-test-'));
const jpeg = '/9j/AA=='; // Header-only fixture, never displayed as an actual QR code.

test('DevTools pipe handles split/coalesced frames, events, timeout and disconnect', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const pipe = new DevToolsPipe(input, output, { timeout: 100 });
  let event; pipe.on('event', value => { event = value; });
  const first = pipe.call('Test.first'), second = pipe.call('Test.second');
  input.write('{"id":2,"res'); input.write('ult":{"ok":2}}\0{"method":"Test.event","params":{}}\0{"id":1,"result":{"ok":1}}\0');
  assert.deepEqual(await first, { ok: 1 }); assert.deepEqual(await second, { ok: 2 });
  assert.equal(event.method, 'Test.event');
  await assert.rejects(pipe.call('Test.timeout'), { code: 'ACCOUNT_TIMEOUT' });
  const pending = pipe.call('Test.disconnect'); pipe.close();
  await assert.rejects(pending, { code: 'ACCOUNT_BROWSER_FAILED' });
  assert.equal(pipe.pending.size, 0);
});

test('QR images accept JPEG/PNG bytes, never script, arbitrary URLs or oversized data', () => {
  assert.ok(qrImage(jpeg).startsWith('data:image/jpeg;base64,'));
  assert.equal(qrImage('https://example.com/track'), null);
  assert.equal(qrImage('data:image/svg+xml,<svg onload="alert(1)"/>'), null);
  assert.equal(qrImage('a'.repeat(1024 * 1024 + 1)), null);
});

test('a cancelled browser cannot launch a new process after close', async () => {
  const browser = new OfficialAccountBrowser();
  await browser.close();
  await assert.rejects(browser.open(), { code: 'ACCOUNT_BROWSER_FAILED' });
  assert.equal(browser.child, undefined);
});

test('session cookies stay on exact HTTPS origin with proper path and expiration filtering', () => {
  const rows = [cookie(), cookie({ name: 'scoped', path: '/passport', value: 'scoped-value' }),
    cookie({ name: 'expired', expires: 1 }), cookie({ domain: '.evil-hongguoduanju.com' }),
    cookie({ name: 'injection', value: 'x; other=y' })];
  assert.equal(accountCookies(rows).length, 2);
  assert.equal(accountCookies([cookie({ secure: false })])[0].secure, true);
  assert.equal(cookieHeaderFor(rows, 'https://hongguoduanju.com/'), 'sessionid=test-only-session');
  assert.equal(cookieHeaderFor(rows, 'https://hongguoduanju.com/passport/x'), 'scoped=scoped-value; sessionid=test-only-session');
  assert.ok(!cookieHeaderFor(rows, 'https://hongguoduanju.com/passports').includes('scoped='));
  for (const target of ['http://hongguoduanju.com/', 'https://hongguoduanju.com.evil/', 'https://cdn.hongguoduanju.com/', 'https://u:p@hongguoduanju.com/']) assert.equal(cookieHeaderFor(rows, target), '');
});

test('account persistence is authenticated encryption; tampering fails and logout removes both files', async () => {
  const dir = await temp();
  try {
    const store = new AccountStore(dir);
    assert.equal(await store.load(), null);
    await store.save(credentials);
    assert.deepEqual(await store.load(), credentials);
    const text = await readFile(store.path, 'utf8');
    assert.ok(!text.includes('test-only-session') && !text.includes('测试账号'));
    const envelope = JSON.parse(text); envelope.tag = Buffer.alloc(16).toString('base64');
    await writeFile(store.path, JSON.stringify(envelope));
    await assert.rejects(store.load(), { code: 'ACCOUNT_STORAGE_ERROR' });
    await store.clear(); assert.deepEqual(await readdir(store.directory), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('restored cookies are not authenticated until official verification; secrets never enter status', async () => {
  const dir = await temp(); let closed = 0;
  try {
    const store = new AccountStore(dir); await store.save(credentials);
    const manager = await new AccountManager(dir, { store, browserFactory: () => ({
      open: async rows => assert.equal(rows[0].value, 'test-only-session'),
      verify: async () => ({ authenticated: true, nickname: '已验证用户' }),
      cookies: async () => [cookie()], close: async () => { closed++; },
    }) }).init();
    assert.equal(manager.status().state, 'saved'); assert.equal(manager.cookieHeader('https://hongguoduanju.com/'), '');
    await manager.start({ verifyOnly: true }); await manager.work;
    assert.equal(manager.status().authenticated, true); assert.equal(closed, 1);
    assert.equal(manager.cookieHeader('https://hongguoduanju.com/'), 'sessionid=test-only-session');
    assert.ok(!JSON.stringify(manager.status({ admin: true })).includes('test-only-session'));
    await manager.logout(); assert.equal(await store.load(), null); assert.equal(manager.status().state, 'signed_out');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('QR confirmation alone cannot authenticate; official verification is still required', async () => {
  const dir = await temp(); let verifyCount = 0, closeCount = 0, stored = false;
  const store = { load: async () => null, clear: async () => {}, save: async () => { stored = true; } };
  const manager = await new AccountManager(dir, { store, browserFactory: ({ onState }) => ({
    open: async () => {}, verify: async () => ({ authenticated: ++verifyCount > 1, nickname: '确认后验证' }),
    showQrLogin: async () => { onState({ state: 'waiting_scan', image: `data:image/jpeg;base64,${jpeg}` }); onState({ state: 'confirmed' }); },
    cookies: async () => [cookie()], close: async () => { closeCount++; },
  }) }).init();
  await manager.start();
  assert.equal(manager.status().authenticated, false);
  await manager.work;
  assert.equal(verifyCount, 2); assert.equal(manager.status().authenticated, true); assert.equal(stored, true); assert.equal(closeCount, 1);
  await rm(dir, { recursive: true, force: true });
});

test('logout during delayed verification cannot resurrect or persist the account', async () => {
  let release, entered, saved = false;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const manager = await new AccountManager('unused', {
    store: { load: async () => null, clear: async () => {}, save: async () => { saved = true; } },
    browserFactory: () => ({ open: async () => {}, verify: async () => { entered(); await blocked; return { authenticated: true }; },
      cookies: async () => [cookie()], close: async () => { release(); } }),
  }).init();
  await manager.start(); await started; await manager.logout();
  assert.equal(manager.status().state, 'signed_out'); assert.equal(saved, false); assert.equal(manager.cookieHeader('https://hongguoduanju.com/'), '');
});

test('a stalled official verification hits the overall deadline and closes its browser', async () => {
  let rejectCheck, closed = 0;
  const manager = await new AccountManager('unused', { loginTimeoutMs: 30,
    store: { load: async () => null }, browserFactory: () => ({ open: async () => {},
      verify: () => new Promise((resolve, reject) => { rejectCheck = reject; }),
      close: async () => { closed++; rejectCheck?.(Error('closed')); },
    }),
  }).init();
  await manager.start(); await manager.work;
  assert.equal(manager.status().state, 'expired'); assert.equal(manager.status().authenticated, false); assert.ok(closed >= 1);
});

test('browser failure is bounded and sanitized, expired official session is removed', async () => {
  const failed = await new AccountManager('unused', { store: { load: async () => null }, browserFactory: () => ({ open: async () => { throw Error('secret cookie'); }, close: async () => {} }) }).init();
  await failed.start(); await failed.work;
  assert.equal(failed.status().state, 'error'); assert.ok(!JSON.stringify(failed.status()).includes('secret'));
  let cleared = false;
  const expired = await new AccountManager('unused', { store: { load: async () => credentials, clear: async () => { cleared = true; } },
    browserFactory: () => ({ open: async () => {}, verify: async () => ({ authenticated: false }), close: async () => {} }) }).init();
  await expired.start({ verifyOnly: true }); await expired.work;
  assert.equal(expired.status().state, 'expired'); assert.equal(cleared, true);
});

test('account controls require loopback, local Host, same Origin and per-process token', async () => {
  let starts = 0;
  const route = createAccountRoutes({ status: () => ({ state: 'signed_out' }), start: async () => { starts++; return {}; } }, (response, status, value) => { response.status = status; response.value = value; });
  const request = (overrides = {}) => ({ socket: { remoteAddress: '127.0.0.1', localPort: 8751 }, headers: { host: '127.0.0.1:8751' }, async *[Symbol.asyncIterator]() {}, ...overrides });
  let html;
  await route(request(), { writeHead() {}, end(value) { html = value; } }, '/account', 'GET');
  const token = /const token="([A-Za-z0-9_-]{43})"/.exec(html)[1];
  for (const req of [request({ socket: { remoteAddress: '192.168.1.2', localPort: 8751 } }), request({ headers: { host: 'evil.test:8751' } })]) await assert.rejects(route(req, {}, '/account', 'GET'), { status: 403 });
  await assert.rejects(route(request(), {}, '/account/api/start', 'POST'), { status: 403 });
  await assert.rejects(route(request({ headers: { host: '127.0.0.1:8751', origin: 'https://evil.test', 'x-hg-account-token': token } }), {}, '/account/api/start', 'POST'), { status: 403 });
  await assert.rejects(route(request({ headers: { host: '127.0.0.1:8751', 'x-hg-account-token': 'é'.repeat(43) } }), {}, '/account/api/start', 'POST'), { status: 403 });
  await route(request({ headers: { host: '127.0.0.1:8751', origin: 'http://127.0.0.1:8751', 'x-hg-account-token': token } }), {}, '/account/api/start', 'POST');
  assert.equal(starts, 1);
});

test('authenticated website requests use cookies only on the official host; cache switches account scope', async () => {
  let scope = 0; const seen = [];
  const html = '<script>window._ROUTER_DATA={"loaderData":{"home":{"homeSections":[]}}}</script>';
  const client = new WebsiteClient({ cookieProvider: () => 'sessionid=test-only-session', cacheScope: () => scope,
    fetchFn: async (url, options) => { seen.push(options.headers.Cookie); return new Response(html); } });
  await client.getHome(); await client.getHome(); assert.equal(seen.length, 1);
  scope++; await client.getHome(); assert.equal(seen.length, 2); assert.equal(seen[0], 'sessionid=test-only-session');
  const other = new WebsiteClient({ baseUrl: 'https://example.test', cookieProvider: () => 'secret', fetchFn: async (url, options) => { assert.equal(options.headers.Cookie, undefined); return new Response(html); } });
  await other.getHome();
});

test('an in-flight response from the previous account cannot populate the new account cache', async () => {
  let scope = 0; const replies = [];
  const html = '<script>_ROUTER_DATA={"loaderData":{"home":{"homeSections":[]}}}</script>';
  const client = new WebsiteClient({ cacheScope: () => scope, fetchFn: () => new Promise(resolve => replies.push(resolve)) });
  const old = client.getHome(); const rejected = assert.rejects(old, { code: 'SOURCE_CANCELLED' });
  scope++;
  const next = client.getHome(); assert.equal(replies.length, 2);
  replies[0](new Response(html)); replies[1](new Response(html));
  await rejected; await next; await client.getHome(); assert.equal(replies.length, 2);
});

test('real HTTP account UI has no-store/CSP; LAN account status still needs pairing', async () => {
  const dir = await temp();
  const service = await createService({ dataDir: dir }, { media: {}, playback: { close: async () => {} }, website: {}, initializeMedia: false });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  try {
    const page = await fetch(base + '/account'); assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store'); assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    assert.equal((await fetch(base + '/api/account')).status, 401);
    assert.equal((await fetch(base + '/account/api/status')).status, 403);
    assert.equal((await fetch(base + '/account', { headers: { Origin: 'https://evil.test' } })).status, 403);
    const text = await page.text(); const token = /const token="([A-Za-z0-9_-]{43})"/.exec(text)[1];
    const response = await fetch(base + '/account/api/status', { headers: { 'X-HG-Account-Token': token } });
    assert.deepEqual(await response.json(), service.account.status({ admin: true }));
  } finally { await service.close(); await rm(dir, { recursive: true, force: true }); }
});

test('paired QR routes isolate operations and keep QR out of general account status', async () => {
  const dir = await temp();
  const manager = await new AccountManager(dir, { browserFactory: ({ onState }) => ({
    open: async () => {}, verify: async () => ({ authenticated: false }),
    showQrLogin: async () => { onState({ state: 'waiting_scan', image: `data:image/jpeg;base64,${jpeg}` }); },
    close: async () => {},
  }) }).init();
  const { Pairing } = await import('../src/auth.mjs');
  const pairing = await new Pairing(dir).init();
  const first = await pairing.pair(pairing.code, 'a'), second = await pairing.pair(pairing.code, 'b');
  const headers = { Authorization: `Bearer ${first.token}`, 'Content-Type': 'application/json' };
  const other = { Authorization: `Bearer ${second.token}` };
  const service = await createService({ dataDir: dir }, { pairing, account: manager, media: {}, playback: { close: async () => {} }, website: {}, initializeMedia: false });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  try {
    for (const [method, path] of [['POST','/api/account/login'], ['POST','/api/account/logout'], ['GET','/api/account/login/00000000-0000-0000-0000-000000000000'], ['DELETE','/api/account/login/00000000-0000-0000-0000-000000000000']]) {
      assert.equal((await fetch(base+path, { method })).status, 401);
    }
    assert.equal((await fetch(base+'/api/account/login', { method: 'POST', headers, body: '{"verifyOnly":"false"}' })).status, 400);
    const started = await fetch(base+'/api/account/login', { method: 'POST', headers, body: '{}' });
    assert.equal(started.status, 200); assert.equal(started.headers.get('cache-control'), 'no-store');
    const { operationId } = await started.json(), path = `/api/account/login/${operationId}`;
    for (let i=0; manager.state === 'opening' && i<20; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await (await fetch(base+path,{ headers })).json()).qrImage, `data:image/jpeg;base64,${jpeg}`);
    assert.equal((await (await fetch(base+'/api/account',{ headers })).json()).qrImage, undefined);
    assert.equal((await fetch(base+path,{headers:other})).status,409);
    assert.equal((await fetch(base+path,{method:'DELETE',headers:other})).status,409);
    assert.equal((await fetch(base+path,{method:'DELETE',headers})).status,200);
    assert.equal((await fetch(base+path,{headers})).status,409);
    assert.equal((await fetch(base+'/api/account/logout',{method:'POST',headers,body:'{}'})).status,200);
    assert.equal(manager.state,'signed_out');
  } finally { await service.close(); await rm(dir, { recursive: true, force: true }); }
});

test('account lists require pairing, bound limits, and block unverified favorite writes', async () => {
  const dir=await temp(); const {Pairing}=await import('../src/auth.mjs'); const pairing=await new Pairing(dir).init();
  const paired=await pairing.pair(pairing.code,'device'), headers={Authorization:`Bearer ${paired.token}`}; let reads=0,writes=0;
  const service=await createService({dataDir:dir},{pairing,accountLibrary:{
    async list(kind,options){reads++;assert.equal(kind,'history');assert.equal(options.fresh,true);return {items:[{id:'1000000000000000001'},{id:'1000000000000000002'}],revision:1,writable:false};},
    async setFavorite(){writes++;},
  },media:{},playback:{close:async()=>{}},website:{},initializeMedia:false});
  await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve)); const base=`http://127.0.0.1:${service.server.address().port}`;
  try {
    for(const [method,path] of [['GET','/api/account/history'],['GET','/api/account/favorites'],['PUT','/api/account/favorites/1000000000000000001'],['DELETE','/api/account/favorites/1000000000000000001']])assert.equal((await fetch(base+path,{method})).status,401);
    assert.equal((await fetch(base+'/api/account/history?limit=0',{headers})).status,400);
    const result=await fetch(base+'/api/account/history?limit=1&refresh=1',{headers}); assert.equal(result.headers.get('cache-control'),'no-store');
    const data=await result.json();assert.equal(data.items.length,1);assert.equal(data.total,2);assert.equal(reads,1);
    for(const method of ['PUT','DELETE']){const result=await fetch(base+'/api/account/favorites/1000000000000000001',{method,headers});assert.equal(result.status,501);assert.equal((await result.json()).error.code,'ACCOUNT_FAVORITES_READ_ONLY');}
    assert.equal(writes,0);
  } finally {await service.close();await rm(dir,{recursive:true,force:true});}
});

import http from 'node:http';
import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuration } from './config.mjs';
import { Pairing } from './auth.mjs';
import { WebsiteClient } from './website.mjs';
import { MediaCache } from './media.mjs';
import { PlaybackManager } from './playback.mjs';
import { AppError, invalid, publicError } from './errors.mjs';
import { chooseEncoder, benchmark, measuredProfile } from './encoding.mjs';
import { AccountManager } from './account.mjs';
import { createAccountRoutes } from './account-http.mjs';
const NAME = '红果 TV 家庭服务';
const VERSION = '0.1.1';
function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}
async function body(request) {
  const chunks = []; let length = 0;
  for await (const chunk of request) { length += chunk.length; if (length > 65536) throw new AppError('BODY_TOO_LARGE', '请求过大', 413); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!value || Array.isArray(value) || typeof value !== 'object') throw invalid(); return value; }
  catch { throw invalid(); }
}
export function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !size) throw new AppError('RANGE_INVALID', '范围无效', 416);
  let start = Number(match[1] || 0), end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1]) { if (!match[2]) throw new AppError('RANGE_INVALID', '范围无效', 416); start = Math.max(0, size - end); end = size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new AppError('RANGE_INVALID', '范围无效', 416);
  return { start, end: Math.min(end, size - 1) };
}
async function sendFile(request, response, path) {
  const info = await stat(path).catch(() => { throw new AppError('NOT_FOUND', '播放文件还未准备好，请重试', 404); });
  const range = parseRange(request.headers.range, info.size);
  const headers = { 'Content-Type': path.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
    'Content-Length': range ? range.end - range.start + 1 : info.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === 'HEAD') return response.end();
  const stream = createReadStream(path, range || {});
  stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response);
}
export async function createService(config, { website, pairing, account, media, playback, initializeMedia = true } = {}) {
  pairing ||= await new Pairing(config.dataDir).init();
  account ||= await new AccountManager(config.dataDir).init();
  website ||= new WebsiteClient({ cookieProvider: url => account.cookieHeader(url), cacheScope: () => account.revision });
  media ||= new MediaCache(config, website);
  if (initializeMedia) await media.init();
  playback ||= await new PlaybackManager(config, website, media).init();
  const accountRoutes = createAccountRoutes(account, json);
  const server = http.createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD', 'POST', 'DELETE'].includes(request.method)) throw new AppError('METHOD_NOT_ALLOWED', '请求方法不支持', 405);
      const url = new URL(request.url, 'http://localhost');
      const route = url.pathname, method = request.method;
      if (await accountRoutes(request, response, route, method)) return;
      if ((method === 'GET' || method === 'HEAD') && route === '/health') return json(response, 200, { name: NAME, version: VERSION, pairingRequired: true });
      if (method === 'POST' && route === '/api/pair') { const value = await body(request); return json(response, 200, await pairing.pair(value.code, request.socket.remoteAddress, value.clientName)); }
      const owner = pairing.authenticate(request.headers.authorization);
      let match;
      if (method === 'GET' && route === '/api/account') return json(response, 200, account.status());
      if (method === 'GET' && route === '/api/home') return json(response, 200, await website.getHome());
      if (method === 'GET' && route === '/api/ranks') return json(response, 200, await website.getRanks());
      if (method === 'GET' && route === '/api/server') return json(response, 200, { profile: config.profile, encoder: config.encoder, maxStreams: 1 });
      if (method === 'GET' && (match = /^\/api\/(categories|ranks)\/([a-z-]+)$/.exec(route))) {
        const page = Number(url.searchParams.get('page') || 1);
        if (!Number.isInteger(page) || page < 1 || page > 1000) throw invalid();
        return json(response, 200, await (match[1] === 'categories' ? website.getCategory(match[2], page) : website.getRank(match[2], page)));
      }
      if (method === 'GET' && route === '/api/search') return json(response, 200, await website.search(url.searchParams.get('q') || ''));
      if (method === 'GET' && (match = /^\/api\/dramas\/(\d{10,24})$/.exec(route))) return json(response, 200, await website.getDrama(match[1]));
      if (method === 'POST' && route === '/api/playback') return json(response, 200, await playback.start(owner, await body(request)));
      if ((match = /^\/api\/playback\/([a-f0-9-]{36})(\/heartbeat)?$/.exec(route))) {
        if (method === 'GET' && !match[2]) return json(response, 200, playback.get(match[1], owner));
        if (method === 'DELETE' && !match[2]) return json(response, 200, playback.stop(match[1], owner));
        if (method === 'POST' && match[2]) return json(response, 200, playback.heartbeat(match[1], owner));
      }
      if ((method === 'GET' || method === 'HEAD') && (match = /^\/stream\/([a-f0-9-]{36})\/([^/]+)$/.exec(route))) return await sendFile(request, response, playback.streamFile(match[1], match[2], owner));
      throw new AppError('NOT_FOUND', '未找到此功能', 404);
    } catch (error) {
      if (response.headersSent) return response.destroy();
      const safe = publicError(error); json(response, safe.status, { error: safe.error });
    }
  });
  server.requestTimeout = 45000; server.headersTimeout = 15000; server.maxHeadersCount = 40;
  let udp;
  return { server, pairing, account, media, playback,
    async listen() {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.bind, resolve); });
      udp = dgram.createSocket('udp4');
      udp.on('error', () => { console.log('局域网自动发现不可用，可手动输入服务器地址。'); });
      udp.on('message', (message, remote) => { if (message.toString() === 'HONGGUO_TV_DISCOVER_V1') udp.send(JSON.stringify({ name: NAME, port: config.port }), remote.port, remote.address, () => {}); });
      udp.bind(8752, config.bind.includes(':') ? '0.0.0.0' : config.bind);
    },
    async close() { try { udp?.close(); } catch {} const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await account.close(); await playback.close(); await closed; }
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = configuration();
    if (process.argv[2] === '--benchmark') {
      if (!process.argv[3]) throw new Error('请指定本地测试视频路径');
      await benchmark(config, resolve(process.argv[3]));
    } else {
      config.encoder = await chooseEncoder(config.ffmpeg, config.encoder);
      config.profile = await measuredProfile(config);
      const service = await createService(config); await service.listen();
      console.log(`${NAME} ${VERSION} / ${config.profile} / ${config.encoder} / 最多一路播放`);
      for (const net of Object.values(networkInterfaces()).flat()) if (net?.family === 'IPv4' && !net.internal) console.log(`电视连接地址：http://${net.address}:${config.port}`);
      console.log(`本次配对码：${service.pairing.code} （仅在可信家庭局域网内使用）`);
      console.log(`服务端账号登录：http://127.0.0.1:${config.port}/account （在服务器本机打开）`);
      let stopping = false;
      const stop = async () => { if (stopping) return; stopping = true; const deadline = setTimeout(() => process.exit(1), 10000); deadline.unref(); await service.close(); clearTimeout(deadline); };
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
    }
  } catch (error) { console.error(error instanceof AppError ? error.message : '服务启动或性能测试失败，请检查运行库、数据目录和网络。'); process.exitCode = 1; }
}

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuration } from '../src/config.mjs';
export const BUNDLE_URL = 'https://lf-fe.fqnovelstatic.com/obj/novel-fanqie-fe/growth/incentive-h5-monorepo/apps/hongguo/static/js/async/m.ad3954075c.js';
export const BUNDLE_SHA256 = '4263d741e5354417981c6485cdbc68f7c10be70ce941b09e8e871029609f8728';
export const WORKER_SHA256 = '4eb5fb4c3e18b6d2bb30a84d71a8ebb8a73fca38957e00859df3532e86c140a0';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function preparePlayer(dataDir, fetchFn = fetch) {
  const vendorDir = join(dataDir, 'vendor'), path = join(vendorDir, 'official-player-worker.js');
  try { if (sha(await readFile(path)) === WORKER_SHA256) return path; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const response = await fetchFn(BUNDLE_URL, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('公开播放器下载失败');
  const chunks = []; let length = 0;
  for await (const chunk of response.body) { length += chunk.length; if (length > 8 * 1024 * 1024) throw new Error('播放器文件过大'); chunks.push(chunk); }
  const bundle = Buffer.concat(chunks);
  if (sha(bundle) !== BUNDLE_SHA256) throw new Error('播放器版本已变更，固定 SHA-256 校验未通过；需要更新软件');
  let worker;
  for (const match of bundle.toString('utf8').matchAll(/"([A-Za-z0-9+/=]{100000,})"/g)) {
    const bytes = Buffer.from(match[1], 'base64');
    if (sha(bytes) === WORKER_SHA256) { worker = bytes; break; }
  }
  if (!worker) throw new Error('公开播放器组件校验失败');
  await mkdir(vendorDir, { recursive: true, mode: 0o700 });
  await writeFile(path + '.tmp', worker, { mode: 0o600 });
  await rename(path + '.tmp', path);
  await writeFile(join(vendorDir, 'provenance.json'), JSON.stringify({ source: BUNDLE_URL, bundleSha256: BUNDLE_SHA256, workerSha256: WORKER_SHA256, preparedAt: new Date().toISOString() }, null, 2));
  return path;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await preparePlayer(configuration().dataDir); console.log('官网公开播放器组件已准备，SHA-256 校验通过。'); }
  catch { console.error('播放器组件准备失败：请检查网络；如果官网版本改变，需要更新此软件。'); process.exitCode = 1; }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { configuration } from '../src/config.mjs';
import { WebsiteClient } from '../src/website.mjs';
import { MediaCache } from '../src/media.mjs';
import { PlaybackManager } from '../src/playback.mjs';
const SER = '7690961604636052505', episodes = ['7690963410778868761', '7690963491330477081', '7690963495944211481', '7690963495944211482'].map(id => ({ id }));
const html = value => new Response(`<script>_ROUTER_DATA=${JSON.stringify({ loaderData: { test: value } })};</script>`);
const drama = title => ({ series_id: SER, series_title: title, episode_cnt: 4, tags: [] });
function metadata(url, title) {
  if (url.pathname === '/') return html({ homeSections: [{ tab_type: 'all', tab_name: title, video_list: [drama(title)] }] });
  if (url.pathname === '/detail') return html({ seriesDetail: { ...drama(title), vid_list: episodes.map(e => e.id) }, recommendations: { videoList: [] } });
  const pagination = { pageNum: Number(url.searchParams.get('page') || 1), totalPages: 2 };
  if (url.pathname.startsWith('/category/')) return html({ recommendList: [drama(title)], pagination });
  if (url.pathname.startsWith('/rank/')) return html({ content: { isSuccess: true, rankList: [drama(title)], pagination } });
  throw Error('Unexpected route: ' + url.pathname);
}
async function until(fn) { for (let i = 0; i < 400; i++) { if (await fn()) return; await delay(10); } throw Error('Timed out'); }
test('automation defaults and off switches are bounded', () => {
  assert.equal(configuration({}).prefetchEpisodes, 2); assert.equal(configuration({}).listRefreshMs, 600000);
  assert.equal(configuration({ HONGGUO_PREFETCH_EPISODES: '0', HONGGUO_LIST_REFRESH_MINUTES: '0' }).listRefreshMs, 0);
  for (const n of ['-1', '3', '1.5', 'NaN']) assert.throws(() => configuration({ HONGGUO_PREFETCH_EPISODES: n }));
  for (const n of ['-1', '1441', '0.5']) assert.throws(() => configuration({ HONGGUO_LIST_REFRESH_MINUTES: n }));
});
test('scheduled refresh replaces cached lists and recent episode catalogs, coalesces runs, retains good cache on failure', async () => {
  let title = 'old', failHome = false, active = 0, maximum = 0; const calls = [];
  const client = new WebsiteClient({ fetchFn: async url => {
    calls.push(url.pathname + url.search); maximum = Math.max(maximum, ++active); await delay(1); active--;
    return failHome && url.pathname === '/' ? new Response('unavailable', { status: 503 }) : metadata(url, title);
  } });
  try {
    await client.getHome(); await client.getDrama(SER); await client.getCategory('real-drama', 2);
    title = 'new'; calls.length = 0;
    const first = client.refreshLists(); assert.equal(client.refreshLists(), first); await first;
    assert.equal(maximum, 1); assert.equal(calls.length, 11); // home + 4 categories + 4 ranks + recent detail + page 2
    assert.equal((await client.getHome()).sections[0].title, 'new');
    assert.equal((await client.getDrama(SER)).title, 'new');
    assert.equal((await client.getCategory('real-drama', 2)).items[0].title, 'new');
    title = 'latest'; failHome = true; await client.refreshLists();
    assert.equal(client.refreshStatus.failed, 1); assert.equal((await client.getHome()).sections[0].title, 'new');
    assert.equal((await client.getDrama(SER)).title, 'latest');
    assert.ok(calls.every(path => !path.includes('play-info')));
  } finally { await client.close(); }
});
test('account revision change stops a refresh cycle; shutdown cancels an in-flight timer refresh', async () => {
  let revision = 0, calls = 0;
  const client = new WebsiteClient({ cacheScope: () => revision, fetchFn: async url => { calls++; revision++; return metadata(url, 'changed'); } });
  await client.refreshLists(); assert.equal(calls, 1); assert.equal(client.refreshStatus.succeeded, 0); await client.close();
  let aborted = false, requested = 0;
  const scheduled = new WebsiteClient({ fetchFn: (url, { signal }) => {
    requested++;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(Error('abort')); }, { once: true }));
  } });
  scheduled.startAutoRefresh(10); await until(() => requested === 1); await scheduled.close();
  await delay(30); assert.equal(requested, 1); assert.equal(aborted, true);
});
test('prefetch promotion reuses the pending episode and the window rolls forward', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hg-autocache-'));
  const website = { getDrama: async () => ({ episodes }) }, cache = new MediaCache({ dataDir: dir }, website);
  const calls = []; let releaseNext;
  cache.prepare = async (series, episode, key, signal) => {
    calls.push(episode);
    if (episode === episodes[1].id) await new Promise((resolve, reject) => {
      releaseNext = resolve; signal.addEventListener('abort', () => reject(Error('aborted')), { once: true });
    });
    const folder = join(dir, key); await mkdir(folder, { recursive: true });
    return { dir: folder, path: join(folder, 'episode.mp4'), duration: 100, bytes: 1, until: Date.now() + 60000, usedAt: Date.now() };
  };
  const spawnFn = (command, args) => {
    const child = new EventEmitter(); child.stderr = { resume() {} };
    child.kill = () => { child.emit('close', 255); return true; };
    writeFile(args.at(-1), '#EXTM3U\n#EXTINF:2,\nsegment000000.ts\n#EXT-X-ENDLIST\n').then(() => child.emit('close', 0)); return child;
  };
  const manager = await new PlaybackManager({ dataDir: dir, prefetchEpisodes: 2 }, website, cache, { spawnFn }).init();
  try {
    const first = await manager.start('tv', { seriesId: SER, episodeId: episodes[0].id });
    await until(() => releaseNext);
    assert.equal(manager.get(first.id, 'tv').prefetch.total, 2);
    const next = await manager.start('tv', { seriesId: SER, episodeId: episodes[1].id });
    releaseNext(); await until(() => manager.get(next.id, 'tv').prefetch?.completed === 2);
    assert.deepEqual(calls, episodes.map(e => e.id));
    assert.equal(calls.filter(id => id === episodes[1].id).length, 1);
    for (const episode of episodes.slice(1)) assert.ok(cache.entries.has(cache.key(SER, episode.id)), 'current and next two stay cached');
    manager.stop(next.id, 'tv');
  } finally { releaseNext?.(); await manager.close(); await rm(dir, { recursive: true, force: true }); }
});
test('failed future episode does not stop current playback or later prefetch; stopping prevents new work', async () => {
  const media = { get: async (series, episode) => { calls.push(episode); if (episode === episodes[1].id) throw Error('unavailable'); }, abortExcept() {}, close: async () => {} };
  const calls = [], manager = new PlaybackManager({ dataDir: tmpdir() }, { getDrama: async () => ({ episodes }) }, media);
  const session = { seriesId: SER, episodeId: episodes[0].id, status: 'ready', encoderClosed: Promise.resolve() }; manager.active = session;
  try {
    await manager.prefetch(session, {}); assert.deepEqual(calls, episodes.slice(1, 3).map(e => e.id));
    assert.equal(session.status, 'ready'); assert.deepEqual(session.prefetch, { total: 2, completed: 1, failed: 1 });
    session.cancelled = true; await manager.prefetch(session, {}); assert.equal(calls.length, 2);
  } finally { await manager.close(); }
});
test('background cache eviction cannot remove the pinned playing entry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hg-pin-')), cache = new MediaCache({ dataDir: dir }, {});
  try {
    for (let i = 0; i < 4; i++) { const folder = join(dir, String(i)); await mkdir(folder); cache.entries.set(String(i), { dir: folder, bytes: 1, until: Date.now() + 10000, usedAt: i }); }
    const release = cache.pin('0'); await cache.prune('3');
    assert.deepEqual([...cache.entries.keys()], ['0', '2', '3']); release(); release(); assert.equal(cache.pins.size, 0);
  } finally { await cache.close(); await rm(dir, { recursive: true, force: true }); }
});
test('stopping during an unfinished background download aborts it and does not enqueue another episode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hg-prefetch-stop-'));
  const website = { getDrama: async () => ({ episodes }) }, cache = new MediaCache({ dataDir: dir }, website);
  const calls = []; let aborted = false;
  cache.prepare = async (series, episode, key, signal) => {
    calls.push(episode);
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(Error('abort')); }, { once: true }));
  };
  const manager = new PlaybackManager({ dataDir: dir }, website, cache);
  const session = { id: 'test', owner: 'tv', seriesId: SER, episodeId: episodes[0].id, status: 'ready', dir: join(dir, 'stream'), encoderClosed: Promise.resolve() };
  manager.sessions.set(session.id, session); manager.active = session;
  try {
    const work = manager.prefetch(session, {}); await until(() => calls.length === 1);
    manager.stop(session.id, 'tv'); await work;
    assert.equal(aborted, true); assert.deepEqual(calls, [episodes[1].id]); assert.equal(cache.pending.size, 0);
  } finally { await manager.close(); await rm(dir, { recursive: true, force: true }); }
});

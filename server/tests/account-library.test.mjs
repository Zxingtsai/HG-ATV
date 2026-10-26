import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountLibrary, APP_ORIGIN, APP_PATHS, parseAccountJson, normalizeHistory } from '../src/account-library.mjs';
import { AccountManager } from '../src/account.mjs';
const series = '7441090899007786009', episode = '7441100915030903833';
const historyRow = (overrides = {}) => ({ book_id_str: series, book_name: '测试剧', book_type: 2, read_timestamp_ms: 1700000000000, thumb_url: 'https://example.test/a.jpg', episode_cnt: 45, vid: episode, vid_index: 2, current_play_position: 12340, ...overrides });
const favoriteRow = (id = series) => ({ video_data: { series_id: id, episode_cnt: 45 }, series_title: '测试剧', modify_time: 1700000000000 });
const response = data => new Response(JSON.stringify({ code: 0, data }));
function account() { return { revision: 0, authenticated: true, status() { return { authenticated: this.authenticated }; }, appSessionHeader: () => 'sessionid=test-only', async expire(revision) { if (this.revision === revision) { this.revision++; this.authenticated = false; } } }; }

test('int64 IDs are preserved exactly and only supported progress is exposed', () => {
  const parsed = parseAccountJson(`{"book_id":${series},"vid":${episode},"current_play_position":12340}`);
  assert.equal(parsed.book_id, series); assert.equal(parsed.vid, episode);
  const item = normalizeHistory(historyRow({ ...parsed, book_id_str: undefined }));
  assert.equal(item.id, series); assert.deepEqual(item.resume, { episodeId: episode, episodeIndex: 2, seconds: 12.34 });
  assert.equal(normalizeHistory(historyRow({ current_play_position: null })).resume, undefined);
  assert.equal(normalizeHistory(historyRow({ is_delete: true })), null);
  assert.equal(normalizeHistory(historyRow({ book_type: 0 })), null);
  assert.throws(() => normalizeHistory(historyRow({ book_id_str: undefined, book_id: Number(series) })), { code: 'ACCOUNT_DATA_INVALID' });
});

test('App session is restricted to verified account and exact fixed official paths', () => {
  const manager = new AccountManager('/unused'); manager.state = 'authenticated';
  manager.credentials = { cookies: [{ name: 'sessionid', value: 'test-only', domain: '.hongguoduanju.com', path: '/', secure: true, expires: -1 }, { name: 'other', value: 'never-forward', domain: '.hongguoduanju.com', path: '/', secure: true, expires: -1 }] };
  assert.equal(manager.appSessionHeader(APP_ORIGIN + APP_PATHS.history + '?aid=8662'), 'sessionid=test-only');
  for (const url of ['https://evil.test' + APP_PATHS.history + '?aid=8662', APP_ORIGIN + '/other?aid=8662', APP_ORIGIN + APP_PATHS.history + '?aid=1', 'http://reading.snssdk.com' + APP_PATHS.history + '?aid=8662', 'https://u:p@reading.snssdk.com' + APP_PATHS.history + '?aid=8662']) assert.equal(manager.appSessionHeader(url), '');
  manager.state = 'saved'; assert.equal(manager.appSessionHeader(APP_ORIGIN + APP_PATHS.history + '?aid=8662'), '');
});

test('history aggregates pages, deduplicates newest series, sorts, and caches for sixty seconds', async () => {
  let now = 0, calls = 0; const a = account();
  const library = new AccountLibrary(a, { clock: () => now, fetchFn: async (url, options) => {
    calls++; assert.equal(options.redirect, 'error'); assert.equal(options.headers.Cookie, 'sessionid=test-only');
    const offset = new URL(url).searchParams.get('offset');
    return response(offset === '0' ? { data_list: [historyRow(),historyRow({book_id_str:'7441090899007786010',read_timestamp_ms:1800000000000})], has_more: true, next_offset: 2 } : { data_list: [historyRow({read_timestamp_ms:1900000000000})], has_more: false, next_offset: 3 });
  } });
  const data = await library.list('history'); assert.equal(data.items.length,2); assert.equal(data.items[0].id,series); assert.equal(data.items[0].updated,1900000000000);
  await library.list('history'); assert.equal(calls,2); now=60001; await library.list('history'); assert.equal(calls,4);
  a.revision++; await library.list('history'); assert.equal(calls,6);
});

test('account change rejects delayed results and logout never returns cached data', async () => {
  const a = account(); let release;
  const library = new AccountLibrary(a,{fetchFn: () => new Promise(resolve => { release=resolve; })});
  const pending=library.list('history'); const rejected=assert.rejects(pending,{code:'ACCOUNT_CHANGED'});
  a.revision++; release(response({data_list:[historyRow()],has_more:false})); await rejected;
  assert.equal(library.cache.size,0); a.authenticated=false;
  await assert.rejects(library.list('history'),{code:'ACCOUNT_LOGIN_REQUIRED'});
});

test('malformed, looping pagination, and rejected responses never masquerade as empty lists', async () => {
  for (const data of [{}, {data_list:[],has_more:true,next_offset:0}, {data_list:[historyRow()],has_more:true,next_offset:0}]) {
    const library=new AccountLibrary(account(),{fetchFn:async()=>response(data)});
    await assert.rejects(library.list('history'),{code:'ACCOUNT_DATA_INVALID'});
  }
  const a=account(), library=new AccountLibrary(a,{fetchFn:async()=>new Response('{}',{status:401})});
  await assert.rejects(library.list('history'),{code:'ACCOUNT_LOGIN_REQUIRED'}); assert.equal(a.authenticated,false);
});

test('favorites use idempotent target state, serialized writes and read-back after an ambiguous POST', async () => {
  const a=account(); let present=false, posts=0, reads=0;
  const library=new AccountLibrary(a,{fetchFn:async(url,options)=>{
    if(options.method==='POST') { posts++; present=!JSON.parse(options.body).is_cancelled; if(posts===1) throw new DOMException('timed out','TimeoutError'); return response({}); }
    reads++; return response({video_shelf_info:present?[favoriteRow()]:[],has_more:false});
  }});
  assert.equal((await library.setFavorite(series,true)).favorite,true); assert.equal(posts,1);
  assert.equal((await library.setFavorite(series,true)).changed,false); assert.equal(posts,1);
  const [removed,added]=await Promise.all([library.setFavorite(series,false),library.setFavorite(series,true)]);
  assert.equal(removed.favorite,false); assert.equal(added.favorite,true); assert.equal(posts,3); assert.ok(reads>=7);
});

test('unconfirmed favorite mutation sends once and requires explicit state reconciliation', async () => {
  let posts=0;
  const library=new AccountLibrary(account(),{fetchFn:async(_url,options)=>{
    if(options.method==='POST'){posts++;throw new Error('connection lost');}
    return response({video_shelf_info:[],has_more:false});
  }});
  await assert.rejects(library.setFavorite(series,true),{code:'ACCOUNT_SOURCE_UNAVAILABLE'}); assert.equal(posts,1);
});

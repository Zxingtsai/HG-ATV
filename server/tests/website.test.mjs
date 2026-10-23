import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WebsiteClient, WebsiteError } from '../src/website.mjs';

const fixtures = new URL('../../research/web/', import.meta.url);
const fixture = name => readFile(new URL(name.replaceAll('%', '%25'), fixtures), 'utf8');
const SER = '7690961604636052505';
const EPI = '7690963410778868761';
const html = data => `<script>_ROUTER_DATA = ${JSON.stringify({ loaderData: data })}; globalThis.doNotExecute = true; {junk}</script>`;
const smallDrama = { series_id: SER, series_title: '军需处长的账本', episode_cnt: 46, category_list: [] };
const searchData = (overrides = {}) => ({ searchList: [{ video_data: smallDrama }], pageNum: 1, totalPages: 1, hasMore: false, ...overrides });
const searchJson = JSON.stringify(searchData());
const fromText = (text, options) => new Response(text, options);
const errorCode = code => error => error instanceof WebsiteError && error.code === code && typeof error.status === 'number';

test('real homepage maps four sections and exact string IDs', async () => {
  const client = new WebsiteClient({ fetchFn: async () => fromText(await fixture('home.html')) });
  const result = await client.getHome();
  assert.deepEqual(result.sections.map(section => [section.id, section.items.length]), [['all', 9], ['human', 9], ['comic', 9], ['ai', 9]]);
  assert.equal(result.sections[0].items[0].id, SER);
  assert.equal(result.sections[0].items[0].episodeCount, 46);
  assert.equal(result.sections[0].items[0].title, '军需处长的账本');
  assert.ok(result.sections[0].items[0].tags.includes('战争'));
  assert.deepEqual(result.categories.map(category => category.id), ['real-drama', 'comic-drama', 'ai-drama', 'comic']);
});

test('real category page and recorded second page retain pagination', async () => {
  const calls = [];
  const client = new WebsiteClient({ fetchFn: async url => {
    calls.push(url.pathname + url.search);
    return fromText(url.search ? html(JSON.parse(await fixture('page-bb05dc60819a.json')).loaderData) : await fixture('category_real-drama.html'));
  } });
  const first = await client.getCategory('real-drama');
  const second = await client.getCategory('real-drama', 2);
  assert.equal(first.items.length, 24);
  assert.equal(first.items[0].id, '7694653385668037657');
  assert.equal(first.page, 1);
  assert.equal(first.hasMore, true);
  assert.equal(second.items.length, 24);
  assert.equal(second.items[0].id, '7695246350543227928');
  assert.equal(second.page, 2);
  assert.deepEqual(calls, ['/category/real-drama', '/category/real-drama?page=2']);
});

test('real streamed rank content merges without executing scripts', async () => {
  const client = new WebsiteClient({ fetchFn: async () => fromText(await fixture('rank_hot-drama.html')) });
  const result = await client.getRank('hot-drama');
  assert.equal(result.items.length, 20);
  assert.equal(result.items[0].id, '7697852455970671678');
  assert.equal(result.items[0].episodeCount, 193);
  assert.equal(result.hasMore, true);
  assert.deepEqual((await client.getRanks()).items.map(rank => rank.id), ['hot-drama', 'hot-real-drama', 'hot-ai-drama', 'hot-comic-drama']);
});

test('search requests distinct pages and preserves upstream terminal pagination', async () => {
  const calls = [];
  const client = new WebsiteClient({ fetchFn: async url => {
    calls.push(url.pathname + url.search);
    const page = Number(url.searchParams.get('page') || 1);
    return fromText(JSON.stringify(searchData({ pageNum: page, totalPages: 2, hasMore: page === 1,
      searchList: [{ video_data: { ...smallDrama, series_id: page === 1 ? SER : '123' } }] })));
  } });
  const first = await client.search('军需处长');
  const second = await client.search('军需处长', { page: 2 });
  assert.equal(first.items[0].id, SER);
  assert.equal(first.hasMore, true);
  assert.equal(second.items[0].id, '123');
  assert.equal(second.page, 2);
  assert.equal(second.hasMore, false);
  await client.search('军需处长', { page: 2 });
  assert.deepEqual(calls, ['/api/search/result?query=%E5%86%9B%E9%9C%80%E5%A4%84%E9%95%BF',
    '/api/search/result?query=%E5%86%9B%E9%9C%80%E5%A4%84%E9%95%BF&page=2']);
});

test('search rejects wrong pages, inconsistent pagination, HTML shells and malformed rows', async () => {
  for (const data of [searchData({ pageNum: 2 }), searchData({ totalPages: -1 }),
    searchData({ hasMore: true }), searchData({ totalPages: 2, hasMore: true, searchList: [] }),
    searchData({ hasMore: 'false' }), searchData({ searchList: [{}] }), { code: 'error' }]) {
    const client = new WebsiteClient({ fetchFn: async () => fromText(JSON.stringify(data)) });
    await assert.rejects(client.search('test'), errorCode('SOURCE_INVALID_DATA'));
  }
  const client = new WebsiteClient({ fetchFn: async () => fromText('<div id="root"></div>') });
  await assert.rejects(client.search('test'), errorCode('SOURCE_INVALID_DATA'));
  const empty = new WebsiteClient({ fetchFn: async () => fromText(JSON.stringify(searchData({ searchList: [], totalPages: 0 }))) });
  assert.deepEqual((await empty.search('nothing')).items, []);
});

test('actor-only search pages retain pagination without treating actors as dramas', async () => {
  const client = new WebsiteClient({ fetchFn: async () => fromText(JSON.stringify(searchData({
    searchList: [{ doc_type: 46, user_info: { name: 'actor' } }], totalPages: 2, hasMore: true,
  }))) });
  const result = await client.search('actor');
  assert.deepEqual(result.items, []);
  assert.equal(result.hasMore, true);
});

test('recorded official JSON page normalizes exact IDs and public drama fields', async () => {
  const source = await readFile(new URL('../../research/search-pagination/page2.fixture.json', import.meta.url), 'utf8');
  const client = new WebsiteClient({ fetchFn: async () => fromText(source) });
  const result = await client.search('军需处长', { page: 2 });
  const original = JSON.parse(source);
  assert.deepEqual(result.items.map(item => item.id), original.searchList.map(item => item.video_data.series_id));
  assert.equal(result.items[0].title, original.searchList[0].video_data.series_title);
  assert.equal(result.page, 2);
  assert.equal(result.hasMore, true);
});

test('real detail includes every vid despite accessible_episode_cnt=3 and streamed recommendations', async () => {
  const client = new WebsiteClient({ fetchFn: async () => fromText(await fixture('detail.html')) });
  const result = await client.getDrama(SER);
  const expected = JSON.parse(await fixture('detail-merged.json')).loaderData.detail_page;
  assert.equal(result.id, SER);
  assert.equal(result.episodes.length, 46);
  assert.equal(result.episodes[0].id, EPI);
  assert.deepEqual(result.episodes.at(-1), { id: '7690963495944211481', index: 46, title: '第 46 集' });
  assert.equal(result.recommendations.length, expected.recommendations.videoList.length);
  assert.equal(result.recommendations[0].id, '7530119479875882009');
  assert.ok(result.actors.includes('岳训宇'));
  assert.ok(result.description.includes('长征'));
  assert.ok(!JSON.stringify(result).includes('webID'));
  assert.ok(!JSON.stringify(result).includes('avatar'));
});

test('JSON parser stops at the first value and supports quoted HTML entities in streamed args', async () => {
  const args = JSON.stringify(['category', 'recommendList', [{ ...smallDrama, series_title: 'A "quote" & <x> \'single\'' }]])
    .replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('<', '&#x3c;').replaceAll('>', '&gt;');
  const source = html({ category: { isSuccess: true, recommendList: [], pagination: { pageNum: 1, totalPages: 1 } } }) +
    `<script data-fn-name='r' data-fn-args="${args}">throw new Error('never execute')</script>`;
  const client = new WebsiteClient({ fetchFn: async () => fromText(source) });
  assert.equal((await client.getCategory('real-drama')).items[0].title, 'A "quote" & <x> \'single\'');
  assert.equal(globalThis.doNotExecute, undefined);
});

test('source errors and incomplete episodes are errors, never empty successful pages', async () => {
  for (const source of [
    'not a router page', JSON.stringify(searchData({ isSuccess: false })),
    JSON.stringify(searchData({ searchList: null })),
    JSON.stringify(searchData({ searchList: [{ video_data: null }] })),
  ]) {
    await assert.rejects(new WebsiteClient({ fetchFn: async () => fromText(source) }).search('test'), errorCode('SOURCE_INVALID_DATA'));
  }
  const incomplete = html({ detail: { isSuccess: true, seriesDetail: { ...smallDrama, vid_list: [EPI] } } });
  await assert.rejects(new WebsiteClient({ fetchFn: async () => fromText(incomplete) }).getDrama(SER), errorCode('SOURCE_INVALID_DATA'));
});

test('invalid user parameters never reach the upstream fetch function', async () => {
  const client = new WebsiteClient({ fetchFn: async () => assert.fail('must not fetch') });
  for (const request of [() => client.getCategory('https://evil.test'), () => client.getRank('__proto__'),
    () => client.getCategory('real-drama', -1), () => client.getCategory('real-drama', '2x'),
    () => client.getDrama(7690961604636052505), () => client.getDrama('https://evil.test'),
    () => client.search('x', { page: 0 }), () => client.search('x', { page: '2x' }), () => client.search('x', { page: 1.5 }), () => client.search(' '), () => client.search('a'.repeat(101)),
    () => client.getPlayInfo(SER, EPI, '1080p'), () => client.getPlayInfo(SER, '/url')]) {
    await assert.rejects(request(), errorCode('INVALID_ARGUMENT'));
  }
  assert.throws(() => new WebsiteClient({ baseUrl: 'not a URL' }), errorCode('INVALID_ARGUMENT'));
});

test('metadata coalesces concurrent requests and clones cached results', async () => {
  let count = 0;
  const client = new WebsiteClient({ fetchFn: async () => { count++; await new Promise(resolve => setTimeout(resolve, 10)); return fromText(searchJson); } });
  const [one, two] = await Promise.all([client.search('test'), client.search('test')]);
  assert.equal(count, 1);
  one.items[0].title = 'changed';
  assert.equal(two.items[0].title, '军需处长的账本');
  assert.equal((await client.search('test')).items[0].title, '军需处长的账本');
  assert.equal(count, 1);
});

test('metadata TTL expires and cache evicts past 256 entries', async () => {
  let count = 0;
  const fetchFn = async () => { count++; return fromText(searchJson); };
  const client = new WebsiteClient({ fetchFn, cacheTtlMs: 5 });
  await client.search('ttl');
  await new Promise(resolve => setTimeout(resolve, 10));
  await client.search('ttl');
  assert.equal(count, 2);
  const bounded = new WebsiteClient({ fetchFn });
  for (let i = 0; i < 257; i++) await bounded.search(`key${i}`);
  const before = count;
  await bounded.search('key256');
  assert.equal(count, before);
  await bounded.search('key0');
  assert.equal(count, before + 1);
});

test('one cancelled metadata subscriber does not cancel another', async () => {
  let count = 0;
  const client = new WebsiteClient({ fetchFn: async (_url, { signal }) => {
    count++;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 20);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
    return fromText(searchJson);
  } });
  const controller = new AbortController();
  const first = client.search('shared', { signal: controller.signal });
  const second = client.search('shared');
  controller.abort();
  await assert.rejects(first, errorCode('SOURCE_CANCELLED'));
  assert.equal((await second).items.length, 1);
  assert.equal(count, 1);
});

test('cancelling the final subscriber aborts the upstream request', async () => {
  let upstreamSignal;
  const client = new WebsiteClient({ fetchFn: async (_url, { signal }) => {
    upstreamSignal = signal;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const controller = new AbortController();
  const request = client.search('abort', { signal: controller.signal });
  controller.abort();
  await assert.rejects(request, errorCode('SOURCE_CANCELLED'));
  assert.equal(upstreamSignal.aborted, true);
});

test('an immediate metadata retry does not reuse an aborted in-flight request', async () => {
  let count = 0;
  const client = new WebsiteClient({ fetchFn: async (_url, { signal }) => {
    if (++count === 1) return new Promise((_, reject) => signal.addEventListener('abort', () => {
      // Model a fetch implementation that settles after its abort notification.
      setTimeout(() => reject(signal.reason), 10);
    }, { once: true }));
    return fromText(searchJson);
  } });
  const controller = new AbortController();
  const first = client.search('retry', { signal: controller.signal });
  controller.abort();
  await assert.rejects(first, errorCode('SOURCE_CANCELLED'));
  assert.equal((await client.search('retry')).items.length, 1);
  assert.equal(count, 2);
});

test('timeout and pre-cancelled signals have fixed localized errors', async t => {
  const controller = new AbortController();
  controller.abort();
  const noFetch = new WebsiteClient({ fetchFn: async () => assert.fail('must not fetch') });
  await assert.rejects(noFetch.getHome({ signal: controller.signal }), errorCode('SOURCE_CANCELLED'));
  t.mock.method(AbortSignal, 'timeout', () => AbortSignal.abort(new DOMException('private upstream URL', 'TimeoutError')));
  const timeout = new WebsiteClient({ fetchFn: async (_url, { signal }) => { throw signal.reason; } });
  await assert.rejects(timeout.getHome(), errorCode('SOURCE_TIMEOUT'));
});

test('upstream failures redact exception details and URLs', async () => {
  const client = new WebsiteClient({ fetchFn: async () => { throw new Error('https://private.test/?secret=123'); } });
  await assert.rejects(client.search('x'), error => {
    assert.ok(errorCode('SOURCE_UNAVAILABLE')(error));
    assert.ok(!error.message.includes('secret'));
    assert.equal(error.cause, undefined);
    return true;
  });
  for (const [status, code] of [[404, 'SOURCE_NOT_FOUND'], [403, 'SOURCE_UNAVAILABLE'], [500, 'SOURCE_UNAVAILABLE']]) {
    const client = new WebsiteClient({ fetchFn: async () => fromText('secret response', { status }) });
    await assert.rejects(client.getDrama(SER), errorCode(code));
  }
});

test('response byte cap applies to both content-length and streamed bodies', async () => {
  const declared = new WebsiteClient({ fetchFn: async () => fromText('x', { headers: { 'content-length': String(8 * 1024 * 1024 + 1) } }) });
  await assert.rejects(declared.search('x'), errorCode('SOURCE_TOO_LARGE'));
  const streamed = new WebsiteClient({ fetchFn: async () => new Response(new Uint8Array(8 * 1024 * 1024 + 1)) });
  await assert.rejects(streamed.search('x'), errorCode('SOURCE_TOO_LARGE'));
});

// Synthetic credentials are intentionally fake; no live signed URL/key is a fixture.
const track = () => ({ main_url: 'https://media.example.invalid/test.mp4', player_access_key: 'fake-test-only',
  kid: 'fake-kid', init_range: '0-100', index_range: '101-200', format: 'dash', duration: 123 });
const play = () => ({ base_resp: { StatusCode: 0 }, play_info: { ...track(), definition: '720p', audio: track() } });

test('protected play-info uses the official POST shape and is never cached', async () => {
  let count = 0;
  const client = new WebsiteClient({ fetchFn: async (url, options) => {
    count++;
    assert.equal(url.pathname, '/api/video/protected/play-info');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { series_id: SER, item_id: EPI, definition: '720p' });
    assert.equal(options.headers['Content-Type'], 'application/json');
    return Response.json(play());
  } });
  const [one, two] = await Promise.all([client.getPlayInfo(SER, EPI), client.getPlayInfo(SER, EPI)]);
  assert.deepEqual(one, play().play_info);
  assert.deepEqual(two, one);
  await client.getPlayInfo(SER, EPI);
  assert.equal(count, 3);
});

test('protected play-info validates independent audio and base_resp without leaking data', async () => {
  for (const data of [{ ...play(), base_resp: { StatusCode: 1 } },
    { ...play(), play_info: track() },
    { ...play(), play_info: { ...track(), audio: { ...track(), main_url: '' } } },
    { ...play(), play_info: { ...track(), audio: { ...track(), player_access_key: '' } } }]) {
    const client = new WebsiteClient({ fetchFn: async () => Response.json(data) });
    await assert.rejects(client.getPlayInfo(SER, EPI), error => errorCode('PLAYBACK_UNAVAILABLE')(error) && !error.message.includes('fake'));
  }
});

test('only protected_playback_unavailable gets bounded 1s/2s retries', async () => {
  let count = 0;
  const client = new WebsiteClient({ fetchFn: async () => {
    count++;
    return count < 3 ? Response.json({ error: 'protected_playback_unavailable' }, { status: 403 }) : Response.json(play());
  } });
  assert.deepEqual(await client.getPlayInfo(SER, EPI), play().play_info);
  assert.equal(count, 3);
  for (const status of [401, 403, 500]) {
    count = 0;
    const denied = new WebsiteClient({ fetchFn: async () => { count++; return Response.json({ error: 'denied' }, { status }); } });
    await assert.rejects(denied.getPlayInfo(SER, EPI), errorCode('PLAYBACK_UNAVAILABLE'));
    assert.equal(count, 1);
  }
});

test('play-info retry wait respects cancellation', async () => {
  let count = 0;
  const client = new WebsiteClient({ fetchFn: async () => { count++; return Response.json({ error: 'protected_playback_unavailable' }, { status: 403 }); } });
  const controller = new AbortController();
  const request = client.getPlayInfo(SER, EPI, '720p', { signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(request, errorCode('SOURCE_CANCELLED'));
  assert.equal(count, 1);
});

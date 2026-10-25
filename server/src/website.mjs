// Official website adapter. Never evaluate scripts or retain protected playback data.
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_ITEMS = 256;
const REQUEST_TIMEOUT_MS = 35_000;
const CATEGORIES = [
  { id: 'real-drama', title: '真人短剧' },
  { id: 'comic-drama', title: '漫剧' },
  { id: 'ai-drama', title: 'AI 短剧' },
  { id: 'comic', title: '漫画' },
];
const RANKS = [
  { id: 'hot-drama', title: '短剧热播榜' },
  { id: 'hot-real-drama', title: '真人短剧热播榜' },
  { id: 'hot-ai-drama', title: 'AI 短剧热播榜' },
  { id: 'hot-comic-drama', title: '漫剧热播榜' },
];
const ERRORS = {
  INVALID_ARGUMENT: [400, '请求参数不正确'],
  SOURCE_UNAVAILABLE: [502, '官网暂时无法访问，请稍后重试'],
  SOURCE_INVALID_DATA: [502, '官网数据暂时不可用，请稍后重试'],
  SOURCE_TOO_LARGE: [502, '官网返回的数据过大，请稍后重试'],
  SOURCE_TIMEOUT: [504, '官网响应超时，请重试'],
  SOURCE_CANCELLED: [499, '请求已取消'],
  SOURCE_NOT_FOUND: [404, '暂未找到这部短剧'],
  PLAYBACK_UNAVAILABLE: [502, '这集暂时无法播放，请稍后重试'],
};

export class WebsiteError extends Error {
  constructor(code = 'SOURCE_UNAVAILABLE') {
    const [status, message] = ERRORS[code] ?? ERRORS.SOURCE_UNAVAILABLE;
    super(message);
    this.name = 'WebsiteError';
    this.code = Object.hasOwn(ERRORS, code) ? code : 'SOURCE_UNAVAILABLE';
    this.status = status;
  }
}

const fail = (code = 'SOURCE_INVALID_DATA') => { throw new WebsiteError(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const asString = value => typeof value === 'string' ? value : '';
const validId = value => typeof value === 'string' && /^\d{1,30}$/.test(value);
function id(value) {
  if (!validId(value)) fail('INVALID_ARGUMENT');
  return value;
}
function pageNumber(value = 1) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 10000) fail('INVALID_ARGUMENT');
  return n;
}
function cancelled(signal) {
  if (signal?.aborted) fail('SOURCE_CANCELLED');
}
function decodeEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|quot|apos|amp|lt|gt);/gi, (entity, name) => {
    const named = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' };
    if (name[0] !== '#') return named[name.toLowerCase()] ?? entity;
    const n = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
  });
}

// Extract precisely one JSON value, even when subsequent scripts contain braces.
function firstJson(source, offset) {
  while (/\s/.test(source[offset] ?? '') && offset < source.length) offset++;
  const start = offset;
  if (source[offset] !== '{' && source[offset] !== '[') fail();
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (; offset < source.length; offset++) {
    const c = source[offset];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      if (--depth === 0) return JSON.parse(source.slice(start, offset + 1));
    }
  }
  fail();
}
function routerData(source) {
  try {
    const assignment = /\b_ROUTERS?_DATA\s*=\s*/.exec(source);
    if (!assignment) fail();
    const result = firstJson(source, assignment.index + assignment[0].length);
    if (!object(result.loaderData)) fail();
    const merge = (route, key, value) => {
      if (typeof route !== 'string' || typeof key !== 'string' ||
          ['__proto__', 'constructor', 'prototype'].includes(route) ||
          ['__proto__', 'constructor', 'prototype'].includes(key)) fail();
      if (!Object.hasOwn(result.loaderData, route) || !object(result.loaderData[route])) result.loaderData[route] = {};
      Object.defineProperty(result.loaderData[route], key, { value, enumerable: true, writable: true, configurable: true });
    };
    for (const tag of source.matchAll(/<script\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)) {
      const attrs = Object.create(null);
      for (const attribute of tag[1].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g)) {
        attrs[attribute[1].toLowerCase()] = decodeEntities(attribute[2] ?? attribute[3] ?? attribute[4]);
      }
      if (!['r', 'mergeLoaderData'].includes(attrs['data-fn-name']) || !attrs['data-fn-args']) continue;
      const args = JSON.parse(attrs['data-fn-args']);
      if (!Array.isArray(args)) fail();
      if (attrs['data-fn-name'] === 'r') {
        if (args.length < 3) fail();
        merge(args[0], args[1], args[2]);
      } else {
        const [route, items] = args;
        if (!Array.isArray(items)) fail();
        for (const item of items) {
          if (!Array.isArray(item.routerDataFnArgs)) fail();
          const values = item.routerDataFnArgs.map(value => JSON.parse(value));
          if (item.routerDataFnName === 'p' && values.length) merge(route, item.key, values[0]);
        }
      }
    }
    return Object.values(result.loaderData).filter(object);
  } catch (error) {
    if (error instanceof WebsiteError) throw error;
    fail();
  }
}
function routeWith(routes, key) {
  const route = routes.find(route => Object.hasOwn(route, key));
  if (!route || route.isSuccess === false) fail();
  return route;
}
function list(value) {
  if (!Array.isArray(value)) fail();
  return value;
}
function drama(source) {
  if (!object(source)) fail();
  const seriesId = source.series_id ?? source.seriesId ?? source.id;
  const title = source.series_title ?? source.series_name ?? source.title;
  if (!validId(seriesId) || typeof title !== 'string' || !title) fail();
  const rawCount = source.episode_cnt ?? source.series_episode_info?.episode_total_cnt ?? source.episodeVids?.length ?? 0;
  const episodeCount = Number(rawCount);
  if (!Number.isSafeInteger(episodeCount) || episodeCount < 0) fail();
  const tags = Array.isArray(source.tags) ? source.tags : (source.category_list ?? []).map(item => item.name);
  return {
    id: seriesId, title, cover: asString(source.series_cover ?? source.cover), episodeCount,
    tags: list(tags).filter(tag => typeof tag === 'string'),
    description: asString(source.series_intro ?? source.description),
  };
}
function makePage(title, items, pagination, requestedPage) {
  if (!object(pagination)) fail();
  const page = Number(pagination.pageNum);
  const totalPages = Number(pagination.totalPages);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(totalPages) || totalPages < 0 || page !== requestedPage) fail();
  return { title, items: list(items).map(drama), page, hasMore: page < totalPages };
}
function mediaTrack(track) {
  if (!object(track)) return false;
  try {
    const url = new URL(track.main_url);
    return url.protocol === 'https:' && !url.username && !url.password &&
      track.format === 'dash' && Number(track.duration) > 0 &&
      typeof track.player_access_key === 'string' && track.player_access_key.length > 0 &&
      typeof track.kid === 'string' && track.kid.length > 0 &&
      /^\d+-\d+$/.test(track.init_range) && /^\d+-\d+$/.test(track.index_range);
  } catch { return false; }
}

export class WebsiteClient {
  #fetch;
  #base;
  #ttl;
  #cache = new Map();
  #pending = new Map();
  #cookieProvider;
  #cacheScope;
  #recent = new Map();
  #refreshTimer;
  #refreshTask;
  #refreshController;
  #closed = false;
  refreshStatus = { running: false, lastCompletedAt: null, succeeded: 0, failed: 0 };

  startAutoRefresh(intervalMs = 600000) {
    clearTimeout(this.#refreshTimer);
    if (!Number.isFinite(intervalMs) || intervalMs < 0) fail('INVALID_ARGUMENT');
    if (!intervalMs || this.#closed) return;
    const schedule = () => {
      this.#refreshTimer = setTimeout(async () => {
        await this.refreshLists();
        if (!this.#closed) schedule();
      }, intervalMs);
      this.#refreshTimer.unref();
    };
    schedule();
  }
  refreshLists() {
    if (this.#refreshTask) return this.#refreshTask;
    if (this.#closed) return Promise.resolve();
    this.#refreshController = new AbortController();
    const options = { refresh: true, background: true, signal: this.#refreshController.signal };
    const scope = this.#cacheScope();
    const recent = [...this.#recent.values()].filter(entry => entry.scope === scope && Date.now() - entry.usedAt < 86400000);
    this.#recent = new Map(recent.map(entry => [entry.path, entry]));
    const fixed = new Set(['/', ...CATEGORIES.map(item => `/category/${item.id}`), ...RANKS.map(item => `/rank/${item.id}`)]);
    const jobs = [() => this.getHome(options), ...CATEGORIES.map(item => () => this.getCategory(item.id, 1, options)),
      ...RANKS.map(item => () => this.getRank(item.id, 1, options)),
      ...recent.filter(entry => !fixed.has(entry.path)).map(entry => () => this.#metadata(entry.path, entry.convert, options, entry.decode))];
    this.refreshStatus = { ...this.refreshStatus, running: true, succeeded: 0, failed: 0 };
    this.#refreshTask = (async () => {
      for (const work of jobs) {
        if (this.#closed || options.signal.aborted || scope !== this.#cacheScope()) break;
        try { await work(); this.refreshStatus.succeeded++; }
        catch { this.refreshStatus.failed++; }
      }
    })().finally(() => {
      this.refreshStatus.running = false; this.refreshStatus.lastCompletedAt = new Date().toISOString();
      this.#refreshTask = null;
    });
    return this.#refreshTask;
  }
  async close() {
    this.#closed = true; clearTimeout(this.#refreshTimer); this.#refreshController?.abort();
    for (const job of this.#pending.values()) job.controller.abort();
    await Promise.allSettled([...this.#pending.values()].map(job => job.promise));
    await this.#refreshTask;
    this.#recent.clear(); this.#cache.clear();
  }

  constructor({ fetchFn = globalThis.fetch, baseUrl = 'https://hongguoduanju.com', cacheTtlMs = 300000, cookieProvider = () => '', cacheScope = () => 0 } = {}) {
    this.#fetch = fetchFn;
    this.#cookieProvider = cookieProvider; this.#cacheScope = cacheScope;
    try { this.#base = new URL(baseUrl); } catch { fail('INVALID_ARGUMENT'); }
    if (!['https:', 'http:'].includes(this.#base.protocol) || this.#base.username || this.#base.password ||
        !Number.isFinite(cacheTtlMs) || cacheTtlMs < 0 || typeof fetchFn !== 'function') fail('INVALID_ARGUMENT');
    this.#ttl = cacheTtlMs;
  }

  async #request(path, { signal, body } = {}) {
    cancelled(signal);
    if (this.#closed) fail('SOURCE_CANCELLED');
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const target = new URL(path, this.#base);
      const cookie = target.origin === 'https://hongguoduanju.com' ? this.#cookieProvider(target) : '';
      const response = await this.#fetch(target, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
          Referer: new URL('/', this.#base).href, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: combined, redirect: 'error',
      });
      if (Number(response.headers.get('content-length')) > MAX_BYTES) {
        await response.body?.cancel();
        fail('SOURCE_TOO_LARGE');
      }
      const reader = response.body?.getReader();
      if (!reader) fail();
      const chunks = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > MAX_BYTES) { await reader.cancel(); fail('SOURCE_TOO_LARGE'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { status: response.status, text: new TextDecoder().decode(bytes) };
    } catch (error) {
      if (signal?.aborted) fail('SOURCE_CANCELLED');
      if (timeout.aborted) fail('SOURCE_TIMEOUT');
      if (error instanceof WebsiteError) throw error;
      fail('SOURCE_UNAVAILABLE');
    }
  }

  async #metadata(path, convert, { signal, refresh = false, background = false } = {}, decode = routerData) {
    cancelled(signal);
    if (this.#closed) fail('SOURCE_CANCELLED');
    const scope = this.#cacheScope(), cacheKey = `${scope}:${path}`;
    const remember = () => {
      if (background || path.startsWith('/api/search/')) return;
      this.#recent.delete(path); this.#recent.set(path, { path, convert, decode, scope, usedAt: Date.now() });
      while (this.#recent.size > 32) this.#recent.delete(this.#recent.keys().next().value);
    };
    const cached = this.#cache.get(cacheKey);
    if (!refresh && cached?.expires > Date.now()) {
      this.#cache.delete(cacheKey);
      this.#cache.set(cacheKey, cached);
      remember(); return structuredClone(cached.value);
    }
    if (!refresh) this.#cache.delete(cacheKey);
    let job = this.#pending.get(cacheKey);
    if (!job) {
      if (this.#pending.size >= MAX_CACHE_ITEMS) fail('SOURCE_UNAVAILABLE');
      job = { controller: new AbortController(), users: 0, done: false };
      job.promise = (async () => {
        const response = await this.#request(path, { signal: job.controller.signal });
        if (scope !== this.#cacheScope()) fail('SOURCE_CANCELLED');
        if (response.status === 404) fail('SOURCE_NOT_FOUND');
        if (response.status !== 200) fail('SOURCE_UNAVAILABLE');
        const value = convert(decode(response.text));
        // Only the public, normalized API fields reach this bounded cache.
        if (this.#ttl > 0) {
          for (const [key, entry] of this.#cache) if (entry.expires <= Date.now()) this.#cache.delete(key);
          this.#cache.set(cacheKey, { value, expires: Date.now() + this.#ttl });
          while (this.#cache.size > MAX_CACHE_ITEMS) this.#cache.delete(this.#cache.keys().next().value);
        }
        return value;
      })().catch(error => {
        if (error instanceof WebsiteError) throw error;
        fail();
      }).finally(() => {
        job.done = true;
        if (this.#pending.get(cacheKey) === job) this.#pending.delete(cacheKey);
      });
      this.#pending.set(cacheKey, job);
    }
    job.users++;
    let onAbort;
    try {
      const abort = new Promise((_, reject) => {
        if (signal) {
          onAbort = () => reject(new WebsiteError('SOURCE_CANCELLED'));
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
        }
      });
      const result = structuredClone(await Promise.race([job.promise, abort]));
      remember(); return result;
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
      if (--job.users === 0 && !job.done) {
        if (this.#pending.get(cacheKey) === job) this.#pending.delete(cacheKey);
        job.controller.abort();
      }
    }
  }

  async getHome(options) {
    return this.#metadata('/', routes => ({
      sections: list(routeWith(routes, 'homeSections').homeSections).map(section => {
        if (!asString(section.tab_type) || !asString(section.tab_name)) fail();
        return { id: section.tab_type, title: section.tab_name, items: list(section.video_list).map(drama) };
      }), categories: structuredClone(CATEGORIES),
    }), options);
  }

  async getCategory(categoryId, page = 1, options) {
    const category = CATEGORIES.find(item => item.id === categoryId);
    if (!category) fail('INVALID_ARGUMENT');
    page = pageNumber(page);
    return this.#metadata(`/category/${category.id}${page === 1 ? '' : `?page=${page}`}`, routes => {
      const route = routeWith(routes, 'recommendList');
      return makePage(category.title, route.recommendList, route.pagination, page);
    }, options);
  }

  async getRanks() { return { items: structuredClone(RANKS) }; }

  async getRank(rankId, page = 1, options) {
    const rank = RANKS.find(item => item.id === rankId);
    if (!rank) fail('INVALID_ARGUMENT');
    page = pageNumber(page);
    return this.#metadata(`/rank/${rank.id}${page === 1 ? '' : `?page=${page}`}`, routes => {
      const content = routeWith(routes, 'content').content;
      if (!object(content) || content.isSuccess !== true) fail();
      return makePage(rank.title, content.rankList, content.pagination, page);
    }, options);
  }

  async search(query, options = {}) {
    if (typeof query !== 'string' || !query.trim() || query.length > 100) fail('INVALID_ARGUMENT');
    query = query.trim();
    const page = pageNumber(options.page);
    return this.#metadata(`/api/search/result?query=${encodeURIComponent(query)}${page === 1 ? '' : `&page=${page}`}`, route => {
      if (!object(route) || route.isSuccess === false || route.pageNum !== page ||
          !Number.isSafeInteger(route.totalPages) || route.totalPages < 0 ||
          typeof route.hasMore !== 'boolean' || route.hasMore !== (page < route.totalPages)) fail();
      const rows = list(route.searchList);
      // Official search also returns actor cards (doc_type 46); Page contains dramas only.
      const items = rows.filter(item => item?.doc_type !== 46).map(item => drama(item?.video_data));
      if (route.hasMore && rows.length === 0) fail();
      return { title: `搜索：${query}`, items, page, hasMore: route.hasMore };
    }, options, JSON.parse);
  }

  async getDrama(seriesId, options) {
    id(seriesId);
    return this.#metadata(`/detail?series_id=${seriesId}`, routes => {
      const route = routeWith(routes, 'seriesDetail');
      const source = route.seriesDetail;
      const result = drama(source);
      if (result.id !== seriesId) fail();
      const episodes = list(source.vid_list).map((episodeId, index) => {
        if (!validId(episodeId)) fail();
        return { id: episodeId, index: index + 1, title: `第 ${index + 1} 集` };
      });
      if (!episodes.length || new Set(episodes.map(item => item.id)).size !== episodes.length ||
          episodes.length !== result.episodeCount) fail();
      const recommendations = route.recommendations?.videoList;
      return { ...result, actors: list(source.celebrities ?? []).map(actor => asString(actor.nickname)).filter(Boolean),
        episodes, recommendations: list(recommendations).map(drama) };
    }, options);
  }

  async getPlayInfo(seriesId, episodeId, definition = '720p', { signal } = {}) {
    id(seriesId); id(episodeId);
    if (!['360p', '480p', '720p'].includes(definition)) fail('INVALID_ARGUMENT');
    // Deliberately bypass metadata cache and in-flight coalescing for credentials.
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.#request('/api/video/protected/play-info', {
        signal, body: { series_id: seriesId, item_id: episodeId, definition },
      });
      let data;
      try { data = JSON.parse(response.text); } catch { fail('PLAYBACK_UNAVAILABLE'); }
      const retryable = [200, 403].includes(response.status) && data?.error === 'protected_playback_unavailable';
      if (retryable && attempt < 2) {
        await new Promise((resolve, reject) => {
          const onAbort = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(new WebsiteError('SOURCE_CANCELLED')); };
          const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, (attempt + 1) * 1000);
          signal?.addEventListener('abort', onAbort, { once: true });
          if (signal?.aborted) onAbort();
        });
        continue;
      }
      if (response.status !== 200 || data?.base_resp?.StatusCode !== 0 ||
          !mediaTrack(data.play_info) || !mediaTrack(data.play_info.audio)) fail('PLAYBACK_UNAVAILABLE');
      return data.play_info;
    }
    fail('PLAYBACK_UNAVAILABLE');
  }
}

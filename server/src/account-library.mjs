import { AppError } from './errors.mjs';

export const APP_ORIGIN = 'https://reading.snssdk.com';
export const APP_PATHS = Object.freeze({ history: '/reading/bookapi/read_history/list/v', favorites: '/reading/bookapi/bookshelf/video/info/v', update: '/reading/bookapi/bookshelf/video/update/v' });
const fail = (code = 'ACCOUNT_DATA_INVALID', message = '账号列表返回的数据不完整，请稍后重试', status = 502) => new AppError(code, message, status);
const id = value => typeof value === 'string' && /^[1-9]\d{9,23}$/.test(value) ? value : null;
const number = value => { if (!['string','number'].includes(typeof value) || value === '') return null; const n = Number(value); return Number.isSafeInteger(n) && n >= 0 ? n : null; };
const string = value => typeof value === 'string' ? value : '';
const cover = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
// Native JSON contains int64 series/episode IDs. Never round them through a JS Number.
export function parseAccountJson(text) {
  return JSON.parse(text, (_key, value, context) => typeof value === 'number' && !Number.isSafeInteger(value) && /^-?\d+$/.test(context?.source ?? '') ? context.source : value);
}
export function normalizeHistory(row) {
  if (row?.is_delete === true || Number(row?.book_type) !== 2) return null;
  const seriesId = id(row.book_id_str) || id(row.book_id), updated = number(row.read_timestamp_ms);
  if (!seriesId || !string(row.book_name) || updated === null) throw fail();
  const episodeId = id(row.vid), episodeIndex = number(row.vid_index), position = number(row.current_play_position);
  return { id: seriesId, title: row.book_name, cover: cover(row.thumb_url), episodeCount: number(row.episode_cnt) ?? 0, tags: [], description: '', updated,
    ...(episodeId && episodeIndex > 0 && position !== null && position <= 43200000 ? { resume: { episodeId, episodeIndex, seconds: position / 1000 } } : {}) };
}
export function normalizeFavorite(row) {
  const seriesId = id(row?.video_data?.series_id), title = string(row?.series_title);
  if (!seriesId || !title) throw fail();
  return { id: seriesId, title, cover: cover(row.series_cover_url || row.video_data.cover), episodeCount: number(row.video_data.episode_cnt) ?? 0,
    tags: [], description: string(row.series_intro), updated: number(row.modify_time) ?? (number(row.last_operate_time) ?? 0) * 1000 };
}
export class AccountLibrary {
  constructor(account, { fetchFn = fetch, clock = Date.now, ttlMs = 60000, timeoutMs = 25000 } = {}) {
    this.account = account; this.fetchFn = fetchFn; this.clock = clock; this.ttlMs = ttlMs; this.timeoutMs = timeoutMs;
    this.cache = new Map(); this.scope = null; this.writes = Promise.resolve(); this.epoch = 0;
  }
  revision() {
    const revision = this.account.revision;
    if (this.scope !== revision) { this.cache.clear(); this.scope = revision; this.epoch++; }
    if (!this.account.status().authenticated) { this.cache.clear(); throw fail('ACCOUNT_LOGIN_REQUIRED', '请先在“账号”中扫码登录或验证保存的会话', 401); }
    return revision;
  }
  check(revision) { if (this.revision() !== revision) throw fail('ACCOUNT_CHANGED', '账号已切换，请重新加载', 409); }
  async request(path, params, revision, body) {
    this.check(revision);
    const url = new URL(path, APP_ORIGIN); url.search = new URLSearchParams({ aid: '8662', ...params });
    const cookie = this.account.appSessionHeader(url.href);
    if (!cookie) throw fail('ACCOUNT_LOGIN_REQUIRED', '账号会话不可用，请重新扫码登录', 401);
    try {
      const response = await this.fetchFn(url.href, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
        headers: { Accept: 'application/json', Cookie: cookie, ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      this.check(revision);
      if ([401,403].includes(response.status)) { await this.account.expire?.(revision); throw fail('ACCOUNT_LOGIN_REQUIRED', '账号会话已过期，请重新扫码登录', 401); }
      if (!response.ok) throw fail('ACCOUNT_SOURCE_UNAVAILABLE', '红果账号服务暂时不可用，请稍后重试');
      const reader = response.body.getReader(); let length = 0; const chunks = [];
      try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 8 * 1024 * 1024) throw fail(); chunks.push(Buffer.from(value)); } }
      finally { await reader.cancel().catch(() => {}); }
      const data = parseAccountJson(Buffer.concat(chunks).toString('utf8')); this.check(revision);
      if (!data || data.code !== 0) throw fail('ACCOUNT_SOURCE_REJECTED', '红果账号接口未接受请求，请验证会话后重试');
      return data.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw fail(error?.name === 'TimeoutError' ? 'ACCOUNT_SOURCE_TIMEOUT' : 'ACCOUNT_SOURCE_UNAVAILABLE', '红果账号服务请求失败，请稍后重试');
    }
  }
  async list(kind, { fresh = false } = {}) {
    const revision = this.revision(), epoch = this.epoch;
    const cached = this.cache.get(kind);
    if (!fresh && cached && cached.until > this.clock()) return cached.data;
    const items = new Map(); let offset = 0, timestamp = 0;
    for (let page = 0; page < 100; page++) {
      const history = kind === 'history';
      const data = await this.request(APP_PATHS[kind], history ? { book_type: '2', limit: '50', offset: String(offset), full_field: 'true', last_min_read_timestamp_ms: String(timestamp) } : { offset: String(offset), count: '50' }, revision);
      const rows = data?.[history ? 'data_list' : 'video_shelf_info'];
      if (!Array.isArray(rows) || typeof data.has_more !== 'boolean') throw fail();
      for (const row of rows) {
        const item = history ? normalizeHistory(row) : normalizeFavorite(row);
        if (item && (!items.has(item.id) || items.get(item.id).updated < item.updated)) items.set(item.id, item);
      }
      if (items.size > 10000) throw fail();
      if (!data.has_more) {
        this.check(revision);
        const result = { source: 'official_app', revision, writable: false, items: [...items.values()].sort((a,b) => b.updated - a.updated), hasMore: false };
        // A read started before a favorite write must not repopulate that cache.
        if (this.epoch !== epoch) throw fail('ACCOUNT_DATA_CHANGED', '账号列表已更新，请刷新后查看', 409);
        this.cache.set(kind, { until: this.clock() + this.ttlMs, data: result });
        return result;
      }
      const next = number(data.next_offset);
      if (next === null || next <= offset || !rows.length) throw fail();
      offset = next;
      if (history) { const times = rows.map(r => number(r.read_timestamp_ms)).filter(n => n !== null); if (times.length) timestamp = Math.min(...times); }
    }
    throw fail('ACCOUNT_LIST_TOO_LARGE', '账号列表分页过多，请稍后重试');
  }
  setFavorite(seriesId, favorite) {
    if (!id(seriesId) || typeof favorite !== 'boolean') throw fail('INVALID_ARGUMENT', '剧集编号无效', 400);
    const revision = this.revision();
    const work = async () => {
      this.check(revision);
      const before = await this.list('favorites', { fresh: true });
      if (before.items.some(item => item.id === seriesId) === favorite) return { id: seriesId, favorite, changed: false, revision };
      this.cache.delete('favorites'); this.epoch++;
      let writeError;
      try { await this.request(APP_PATHS.update, {}, revision, { book_id_list: [seriesId], modify_time: [this.clock()], is_cancelled: !favorite }); }
      catch (error) { writeError = error; }
      this.check(revision);
      // Even a timed-out POST may have applied. Read back; never repeat the POST blindly.
      let after;
      try { after = await this.list('favorites', { fresh: true }); }
      catch { throw fail('ACCOUNT_WRITE_UNCONFIRMED', '收藏结果暂时无法确认，请刷新列表核对；不要连续重复操作', 409); }
      if (after.items.some(item => item.id === seriesId) !== favorite) throw writeError || fail('ACCOUNT_WRITE_UNCONFIRMED', '收藏状态尚未确认，请刷新列表核对', 409);
      return { id: seriesId, favorite, changed: true, revision };
    };
    const result = this.writes.catch(() => {}).then(work); this.writes = result; return result;
  }
}

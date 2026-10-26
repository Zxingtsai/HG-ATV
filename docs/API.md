# Hongguo TV LAN API v1

Base URL: user-selected LAN HTTP server, default port 8751. JSON UTF-8.
All /api routes except /api/pair require Authorization: Bearer <token>.
All /stream routes require the same header (Media3 data source sends it for manifests and segments).
Errors: {error:{code:string,message:string}}; messages are suitable for TV users.

GET /health -> {name:"红果 TV 家庭服务",version:"0.1.1",pairingRequired:true}
POST /api/pair {code:string,clientName?:string} -> {token:string,serverName:string}
GET /api/home -> {sections:[{id:string,title:string,items:Drama[]}],categories:[{id,title}]}
GET /api/categories/:id?page=1 -> Page
GET /api/ranks -> {items:[{id,title}]}
GET /api/ranks/:id?page=1 -> Page
GET /api/search?q=...&page=1 -> Page
GET /api/dramas/:id -> Detail
POST /api/playback {seriesId:string,episodeId:string,startSeconds?:number} -> Playback
GET /api/playback/:id -> Playback
POST /api/playback/:id/heartbeat {} -> {ok:true}
DELETE /api/playback/:id -> {ok:true}
GET /api/server -> {profile:string,encoder:string,maxStreams:1}
GET /api/account -> {source:"official_web",state:string,authenticated:boolean,message:string,
  nickname?:string,verifiedAt?:number,errorCode?:string}
This paired-device endpoint never returns QR images, cookie values or session tokens.

Drama = {id:string,title:string,cover:string,episodeCount:number,tags:string[],description?:string}
Page = {title:string,items:Drama[],page:number,hasMore:boolean}
Detail = Drama + {description:string,actors:string[],episodes:[{id:string,index:number,title:string}],recommendations:Drama[]}
Playback = {id:string,status:"preparing"|"ready"|"error",stage?:string,progress?:number,
  playlistUrl?:string,durationSeconds?:number,positionBaseSeconds:number,
  seriesId:string,episodeId:string,errorCode?:string,message?:string}
playlistUrl is a path relative to the base server URL. Local media timeline starts at zero;
actual episode position = positionBaseSeconds + player.currentPosition/1000.
Poll preparing sessions every 700ms; do not request HLS until status=ready.
A new playback by the same token replaces its previous session; another token gets HTTP409 BUSY.
Seek beyond buffered media: new POST playback with startSeconds target. Back: DELETE current session.
Playback heartbeat every 15 seconds while foreground (including paused); expires after 120 seconds inactive.
The server authenticates all segment reads and retains just one active transcoder.

Category IDs: real-drama, comic-drama, ai-drama, comic.
Rank IDs: hot-drama, hot-real-drama, hot-ai-drama, hot-comic-drama.
Do not treat provider unavailable as zero episodes. Display errors with retry and back navigation.
Local favorites/history/resume remain on the TV. Account lists use the server endpoints below; credentials never leave the server.

Optional official website account (server 0.1.1 preview): open /account on the server's
loopback address. Its /account/api/status and POST start/verify/cancel/logout controls
require a per-process page token, loopback peer/local Host, and same Origin if present.
The service uses a temporary local Edge/Chrome instance over CDP pipes to generate the
official QR code and verify its session. No phone/SMS fields are accepted by these routes.
Stored credentials remain inactive after restart until explicitly verified. Logout clears
this local session; it does not claim to revoke every upstream session. Authenticated
website cookies attach only to exact https://hongguoduanju.com requests; the 0.1.2 native
account adapter below has a separate fixed-path sessionid allowlist. Account changes isolate
metadata caches. See ACCOUNT.zh-CN.md for setup and unverified runtime boundaries.

Discovery: UDP broadcast port 8752, payload HONGGUO_TV_DISCOVER_V1.
Reply JSON {name:"红果 TV 家庭服务",port:8751}; client uses sender IP as host, never a URL supplied by broadcast.
Manual server URL and six-digit code entry remain available if discovery is blocked.

搜索 `page` 默认 1，范围 1–10000；使用官网 `/api/search/result` 的实际页码与结束标记。官网搜索中的演员卡片不映射为短剧。跨页可能重复，调用方按 Drama.id 去重；`hasMore=false` 只表示本次返回已到末页，不保证得到全部匹配内容的固定快照。上游错误或页码不符返回错误，不当作空结果。

Playback 可附带 `prefetch:{total:number,completed:number,failed:number}`，表示当前系列滚动窗口的预缓存工作计数。默认准备后两集，当前下载和编码完成后串行进行；前台选择同集复用在途任务。服务端每 10 分钟刷新首页、分类/榜单第一页和最近查看的目录/选集；既有客户端请求无需改变，当前显示页面不会被服务端强制推送重绘。环境变量与限制见 [自动化说明](../research/series-automation/README.zh-CN.md)。

## Paired account controls and cloud lists (0.1.2 preview)

All routes below require the existing pairing Bearer token and return `Cache-Control: no-store`.

- `POST /api/account/login` with optional `{verifyOnly:boolean}` starts a login operation and returns `operationId` plus status.
- `GET /api/account/login/:operationId` returns status and a validated PNG/JPEG data URL while scanning. Only the initiating paired device can query it. Poll every 1.5 seconds.
- `DELETE /api/account/login/:operationId` cancels an unfinished operation; a late cancellation preserves completed authentication. Replaced operations return 409.
- `POST /api/account/logout` clears the shared server session. It does not erase local TV favorites/history.
- `GET /api/account/history` and `GET /api/account/favorites` return `{source:"official_app",revision,writable:false,items,total,hasMore:false}`. The server aggregates upstream pages, rejects incomplete pagination, deduplicates series and sorts newest first. Optional `limit=1..10000` limits the final list (home uses 10); `refresh=1` bypasses the 60-second in-memory cache.
- Each item has normal Drama fields plus `updated` (Unix milliseconds). History may include `resume:{episodeId,episodeIndex,seconds}`. Match both episode ID and index to detail before offering resume. Int64 IDs are strings, never rounded numbers.
- `PUT` / `DELETE /api/account/favorites/:seriesId` currently return 501 `ACCOUNT_FAVORITES_READ_ONLY`. Live mutation was rejected by the upstream service; no production mutation is enabled.

Missing/unverified/expired sessions return `ACCOUNT_LOGIN_REQUIRED`; changed accounts return 409. Upstream failures are errors, never successful empty lists. Native credentials are limited to the fixed official reading host and account paths; other browsing/playback cookies retain the original website-origin restriction. No TV-local history is uploaded.

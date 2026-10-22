# Hongguo TV LAN API v1

Base URL: user-selected LAN HTTP server, default port 8751. JSON UTF-8.
All /api routes except /api/pair require Authorization: Bearer <token>.
All /stream routes require the same header (Media3 data source sends it for manifests and segments).
Errors: {error:{code:string,message:string}}; messages are suitable for TV users.

GET /health -> {name:"红果 TV 家庭服务",version:"0.1.0",pairingRequired:true}
POST /api/pair {code:string,clientName?:string} -> {token:string,serverName:string}
GET /api/home -> {sections:[{id:string,title:string,items:Drama[]}],categories:[{id,title}]}
GET /api/categories/:id?page=1 -> Page
GET /api/ranks -> {items:[{id,title}]}
GET /api/ranks/:id?page=1 -> Page
GET /api/search?q=... -> Page
GET /api/dramas/:id -> Detail
POST /api/playback {seriesId:string,episodeId:string,startSeconds?:number} -> Playback
GET /api/playback/:id -> Playback
POST /api/playback/:id/heartbeat {} -> {ok:true}
DELETE /api/playback/:id -> {ok:true}
GET /api/server -> {profile:string,encoder:string,maxStreams:1}

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
Favorites/history/resume are local to the TV client. No accounts or credentials are requested.

Discovery: UDP broadcast port 8752, payload HONGGUO_TV_DISCOVER_V1.
Reply JSON {name:"红果 TV 家庭服务",port:8751}; client uses sender IP as host, never a URL supplied by broadcast.
Manual server URL and six-digit code entry remain available if discovery is blocked.

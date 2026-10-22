# 原 APK 播放接口与数据载体候选

本支调查日期：2026-10-21 UTC。仅对本地 `research/` 证据、DEX 索引及 `hongguo.apk` 做静态读取；未操作手机，未连接 localhost:8777 REA 桥，未请求内容密钥，未修改共享报告。

**优先候选是旧版媒体信息接口、响应中独立 URL 字段，以及 feed/详情内可能已携带的播放数据。下文证明的是原 APK 中存在这些路由或字段名；不等于字段一定实际返回、对应完整正片、可匿名调用或可以解密。**

## 优先级与具体位置

### 1. 旧媒体信息接口：与主 GetVideoModel 不同的路由

- DEX：`classes9.dex`；接口类 `com.dragon.read.rpc.rpc.q7$a`。
- `videoInfoRxJava` 的 `RpcOperation` 注解为 **`$POST /reading/media/video/info/`**。该注解已存在于 `dex-routes.json`，本轮又从原 DEX 复核。
- `com.dragon.read.rpc.model.VideoInfoRequest`：`vids: java.util.List`、`isEncrypt: boolean`。
- `VideoInfoResponse`：`code: MediaApiERR`、`data: VideoInfoResponseData`、`message: String`。
- `VideoInfoResponseData`：`videoData: java.util.Map`。本轮只核对该字段的擦除类型，没有进一步验证 Map 的泛型元素类型。
- 同 DEX 的 `VideoInfoData`：`mainUrl: String`、`backupUrl: String`、`urlExpire: long`、`isEncrypt: boolean`、`encryptionKey: String`。

建议下一步先读取 `q7` 工厂与 `videoInfoRxJava` 的真实调用者，确认业务用途、输入 VID 类型以及响应 Map 的元素类型。`isEncrypt` 只被确认是原字段名，不能由此推断设为 false 就能取得未加密媒体；`encryptionKey` 仅记录字段存在，未读取或请求任何实际值。

同一接口还声明 `playStrategyRxJava -> $GET /reading/media/play/strategy/`，可作为策略/配置线索；目前没有证据它会返回播放地址。`r7$a.audioPlayInfoRxJava` 与 `audioPlayInfoPostRxJava` 是 `/reading/reader/audio/playinfo/`，属于音频候选，本轮不把它列为短剧视频的首选替代链路。

### 2. 主模型响应已有 URL 字段，缓存方法仅消费其中一部分

- DEX：`classes15.dex`；类 `seriessdk.com.dragon.read.saas.rpc.model.VideoModelData`。
- 字段：`mainUrl`、`backupUrl`、`expireTime`、`videoWidth`、`videoHeight`、`isTrialVideo`、`videoModel`、`playAuthToken`。
- 已有 REA 网络协程证据 `ev_50660e19157aafbd996ce20a198c85561fbce6dab793262eaf81a9ee9bd9145e`（`rea-video-network-body-alias.json`）只显示该缓存路径读取 `response.data.videoModel` 并交给 TTVideoEngine；不能据此断言原响应没有其他已填充字段。

值得在正常响应中确认 `mainUrl/backupUrl` 是否实际非空、是否与 `videoModel` 指向同一媒体，以及 `isTrialVideo` 的实际状态。本轮未验证这些字段的服务端填充策略，也未推断 `playAuthToken` 的授权含义或重用方式。

### 3. Feed/详情可能直接携带播放信息

- DEX：`classes9.dex`；`com.dragon.read.rpc.model.VideoData` 同时存在 `url`、`videoModel`、`useVideoModel`、`vid`、`videoPlatform`、`videoWidth`、`videoHeight`、`trialDuration`、`isPreviewMaterial`。
- 同 DEX 的 `VideoInfo` 同时存在 `videoUrl`、`videoModel`、`videoId`、`seriesId`、`videoPlatform`、`episodeNum`、`videoDuration`。
- 同 DEX 的 `VideoPlayInfo` 存在 `mainURL`、`bookID`、`videoID`、`videoCover`、`videoWidth`、`videoHeight`。

这说明原数据模型能表达预先携带的播放信息，值得检查 feed 解析器和 `useVideoModel` 分支，不必把全部调查限定在缓存方法的二次请求。尚未把 `VideoPlayInfo` 连接到某个具体接口；没有证明这些字段是正片而非预览、广告或其他视频业务。

### 4. 选集与详情接口：用于把剧 ID、集 ID、播放数据关联起来

- DEX：`classes15.dex`；接口 `kl8.a$a` 已声明：
  - `getVideoDetailRxJava -> POST /novel/player/video_detail/v1/`；
  - `getAlbumDetailRxJava -> POST /novel/player/album_detail/v1/`；
  - `mGetVideoDetailRxJava -> POST /novel/player/multi_video_detail/v1/`；
  - `mGetVideoDetailV2RxJava -> POST /novel/player/multi_video_detail/:dr_scene/v1/`；
  - 另有 `multi_video_detail/dynamic_data` 和批量 `multi_video_model` 路由。
- 同命名空间 `GetVideoDetailRequest`：`seriesId`、`bizParam`、`novelCommonParam`、`videoContentType`。
- `GetVideoAlbumDetailRequest`：`albumId`、`seriesIds`、`needVideoDetailInfo`、`bizParam`、`novelCommonParam`。
- `GetVideoDetailResponse.data` 为 `SaaSVideoDetailData`；后者的 `videoData` 为 `VideoDetailInfo`，另有 `lockData`、`previewMaterialList`、`style`。
- `VideoDetailInfo`：`videoList`、`videoDetailList`、`firstVid`、`seriesId/seriesIdStr`、`episodeCnt/episodeTotalCnt`、`videoPlatform`、`payInfo` 等。列表的元素类型及是否携带每集现成模型仍待确认。

`classes9.dex` 的 `com.dragon.read.rpc.model.SeriesItem` 本轮只发现 `id/title/cover/actorList/otherImage` 等信息，未见 URL 或 videoModel 字段，不应仅凭 SeriesItem 这个名字优先当作播放载体。

## 其他载体与 host 线索

- `classes16.dex` 的 `com.dragon.read.component.biz.impl.mall.model.VideoUrlModel` 有 `mDashVideoModelString`、`mDashVideoId`、`cdnUrlExpired`、`codecType`、`duration`，并存在 `getUri()` 方法。它可能承接已有模型，但本轮未定位独立请求，优先级低于上面的实际 RPC 候选。
- `classes25.dex` 的 `com.dragon.read.base.ssconfig.template.UrlHostListConfig` 有 `urlHostList: String`；仅凭名称无法判断是 RPC base host、外链允许列表还是其他用途，本轮没有确认默认 API host。
- `classes25.dex` 的 `RpcConfig` 仅发现 `isEnableVid`，不足以确定服务器地址。`NsBaseNetworkDepend` 的已见方法是反序列化/业务码处理，不是明确的 host 配置接口。

host 工厂的深层跟踪由主调查继续进行；本支没有把任意静态域名字符串等同于当前播放接口的实际主机。

## 核对方法、范围与证据限制

- 来源原件 SHA-256：`77f23369c02f8a2d7a66f1fbe960dcd7bc402e529f69a4b21bf047c59fea6d93`，与 `artifact-inventory.json` 及已有分片 provenance 记录一致。
- 先查询 `class-index.json` 和 `dex-routes.json`。注意现有 `dex_routes.py` 的输出原先按若干路径关键词筛选，不是全部接口清单；本轮在内存中重新遍历原 APK 的 25 个 DEX 注解，选择 RPC/Retrofit GET/POST 元数据，再筛查 series/player/media/playinfo 相关项。没有覆盖动态生成路由或原生网络代码。
- 使用 Python 标准库 `zipfile/struct` 读取原 ZIP 成员，按 DEX header 的 `string_ids/type_ids/field_ids/method_ids` 解析名称与类型；上述字段表来自所属类的原 `field_id` 记录。注解按 `class_def.annotations_off` 和 method annotation 元数据读取，没有执行 APK。
- 对目标字段的核对涉及 `classes9.dex/15.dex/16.dex/25.dex`，另排查了 `classes2.dex` 的网络依赖和 `classes17.dex` 的 item 模型。只确认擦除类型，未逐一还原 Kotlin 序列化名、泛型或 wire 编码；请求字段的 Java 名称不应直接当作最终 HTTP JSON 键。
- 本支新增的是原 DEX 元数据观察，不是新的 REA 方法证据；没有创建或虚构新的 `ev_*` ID。已有 REA 方法调用证据与这次字段存在性证据应分别引用。
- 所有候选均未在本支做真实请求、响应或解码验证。字段、路由、`isEncrypt/isTrialVideo` 等名称存在，不说明服务端一定返回对应值，更不说明完整播放、授权或解密已可行。

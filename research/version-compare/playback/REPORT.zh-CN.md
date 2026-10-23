# 播放模型通信对照：6.2.3.32 与 7.4.1.32

日期：2026-10-22 UTC。复用已有 REA 返回、原 DEX 元数据与 Android SDK dexdump 指令文本；本次汇总未运行 APK、操作手机或请求接口。用户报告旧版登录、收藏、播放正常，是用户设备上的观察；下文是选定代码路径的静态证据，二者分别记录。

## 结论

旧版已经存在完整的“业务 VID → 播放模型 RPC → video_model JSON → TTVideoEngine 模型”结构。新版增加了 SaaS 命名空间、嵌套 `biz_param` 的 POST 模型接口，但仍保留旧 `/reading/bookapi/video_tab/.../v:version/` GET 声明。因而可以从两版共同的 VID、平台、ID 类型、模型响应与播放器边界继续理解协议，不能把变化概括成“旧 GET 被新 POST 全部替换”。

本分支已确定旧版请求对象的七个字段和选定 v2 请求/响应分支。尚未由这些证据确定旧路由 `:version` 的最终替换、最终 HTTP query 字节、运行时公共参数/头、服务端实际响应内容与授权条件，不能据此宣称已有可独立重放的 App 播放 API。

后续 [RPC 补充调查](../transport/REPORT.zh-CN.md) 已追到普通 GET 的 DTO → query map、枚举/布尔编码及占位符替换算法；实际运行时 version 值、最终发包字节和服务端接受条件仍未验证。本报告原有“本分支未确定”限制须与该补充一起阅读。

## 样本身份与覆盖

| 样本 | 身份 | 本分支用途 |
| --- | --- | --- |
| 豌豆荚普通下载旧包 | `com.phoenix.read` 6.2.3.32 / 62332；SHA-256 `7724c9a2a7cd5a4cc53edf309dbd628a9e2418e459805b571eda9537881a8f27` | 13 个 DEX 中选定业务/RPC/播放器类 |
| 既有官网新包 | 7.4.1.32 / 74132；SHA-256 `77f23369c02f8a2d7a66f1fbe960dcd7bc402e529f69a4b21bf047c59fea6d93` | 复用既有 25 DEX 静态索引、SaaS 主 v2 调查 |

2026-10-22 官网普通渠道再次取得的新包与既有新包的 25/25 个 DEX、Manifest、签名证书一致，ZIP 整包摘要不同。代码基线可复用，文件身份不能混写，详见[官网渠道核对](../current-official/REPORT.zh-CN.md)。

REA 使用的 [old-playback-slice.apk](old-playback-slice-provenance.json) 是复制旧包 `classes2/11/13.dex`、原 Manifest 与 resources.arsc 的无签名分析载体，SHA-256 `d7f6fc77809b5538e745bf3fdabb3ee6d86e6f15de0bb6422f3d9956ad2023f6`。REA 的 13,011 类计数仅属于这个载体，不是原 APK 总覆盖率。SDK 补充读取的 classes4 及选定类也不代表整 DEX 已解释；逐成员摘要与 dump 来源保留在同目录 provenance 文件。

## 旧版请求路径

以下均为直接指令、字段赋值或选定反编译方法的静态关系；缓存命中可以跳过网络。

```text
core.j.a(VideoData, Consumer, boolean)
  -> api.model.d$a.a(VideoData, source, fromVideoId)
  -> impl.v2.data.f.a(...)
  -> impl.v2.data.f$d.subscribe
  -> shortvideo.depend.c.b.a(...)
  -> rpc.rpc.a.a(GetVideoModelRequest)
  -> RPC 代理接口 rpc.rpc.a$a.a
     GET /reading/bookapi/video_tab/video_model/v:version/
```

- `core.j` 的对应入口在 `0x006c` 调 `d$a.a`，`0x0074` 调 `data.f.a`。`d$a.a(VideoData,int,String)` 在 `0x0010` 读 `VideoData.getVid()`、`0x001a` 原样存入参数对象；`0x001c` 读平台，`0x0022` 读 `isRelatedMaterialId`，另复制 source/fromVideoId。没有在这里把业务 VID 转换为 `v02...`。
- `f$d.subscribe` 将参数对象各字段传给 `depend.c.b.a`，并连接 map/成功/失败消费者。REA Java 方法体完整保留于 old-model-request-consumer-rea.json（本地证据：`old-model-request-consumer-rea.json`）。
- `depend.c.b.a` 创建扁平 `GetVideoModelRequest`，平台为空取 `Outer`；第三个布尔参数为关联素材标志，为真取 `SeriesId`，否则取 `VideoId`。另写 needAllVideoDefinition/useOsPlayer/source/fromVideoId，再调 `rpc.rpc.a.a`；见 old-request-builder-rea.json（本地证据：`old-request-builder-rea.json`）。
- `rpc.rpc.a` 的包装方法通过 `com.bytedance.rpc.n.a(Class)` 获取代理并调用接口。接口方法注解是 `$GET /reading/bookapi/video_tab/video_model/v:version/`、`RpcParams(true)`、`RpcSerializer(JSON)`。接口、包装器与调用者分开保留为 dexdump 证据。

`GetVideoModelRequest` 的七个实例字段：

| Java 字段 | 字段注解名称 | 类型 |
| --- | --- | --- |
| videoId | video_id | String |
| videoPlatform | video_platform | VideoPlatformType |
| videoIdType | video_id_type | VideoSeriesIdType |
| fromVideoId | from_video_id | String |
| source | 无 SerializedName，Java 名为 source | int |
| needAllVideoDefinition | need_all_video_definition | boolean |
| useOsPlayer | use_os_player | boolean |

这些是 DTO 与注解事实，并非抓包。JSON 序列化器的选用也不能单独证明七字段如何成为最终 GET 查询参数、布尔/枚举如何编码、默认字段是否省略。请求 DTO 未声明 `version` 字段；路径中的 `:version` 不在本分支擅自替换为 `1`。

## 响应与播放器边界

选定 `f$d$a.a(GetVideoModelResponse)` 分支：

1. 检查响应，读取 `response.data.videoModel`（`0x0032`），在 `0x0039` 调 `f$a.a(String)`。
2. 读取 width、height、expireTime、isTrialVideo（`0x0041/0x0045/0x0049/0x004d`），构造 `api.model.t` 并进入缓存/下游。
3. `f$a.a(String)` 用 `JSONObject(String)` 解析（`0x0008`），构造 `VideoRef`，在 `0x0015` 调 `extractFields`，`0x0018` 调 `VideoModel.setVideoRef`。解析失败返回 null 的分支也保留在 dump 中。

REA 对响应消费者返回的是 **smali 回退**，标记 `java_body_unavailable`，不是完整 Java 反编译。JSON 解析器的一次 REA 调用因未选两个 `a` 重载之一而失败；该失败原样保留，解析器结论来自 SDK 指令文本（本地证据：`com-dragon-read-component-shortvideo-impl-v2-data-f$a.dexdump.txt`），不虚构成功 REA 证据。

`core.j$b.a(t)` 在 `0x007c` 将结果交给调用时传入的 `Consumer`。`core.j` 内另明确存在模型消费入口 `a(VideoModel,long)`：非空模型在 `0x0017` 交给 `TTVideoEngine.setVideoModel`，在 `0x0045` 调 `prepare`。两端类型与模型结构可衔接，但本次汇总未逐个恢复所有上层 Consumer、设置分支和运行时选择，不能声称每次播放都执行同一串无分支调用。

旧 `VideoModelData` 七字段为 `authorization`、`play_auth_token`、`video_model`、`expire_time`、`is_trial_video`、`video_width`、`video_height`。选定响应消费者直接取的是 `video_model` 与尺寸/过期/试看字段，没有直接取外层 authorization/play_auth_token。这只限定该方法，不能推论 SDK 内部、其他入口或服务端不使用授权信息。

SDK `VideoRef` / `VideoInfo` 对内部 JSON 定义 video_id、video_list、dynamic_video_list、main_url、backup_url 等读取路径，并有条件的 `TTHelper.base64Decode` 调用。字段与解析分支存在不证明响应一定填充、地址一定为明文 MP4、视频没有加密，或任意 URL 可直接交给第三方播放器。本分支未获取、保存或请求内容密钥，也未验证新的完整解码。

## 两版接口与模型差异

| 项目 | 6.2.3.32 | 7.4.1.32 |
| --- | --- | --- |
| legacy 单模型声明 | `rpc.rpc.a$a.a`：GET `/reading/bookapi/video_tab/video_model/v:version/` | `rpc.rpc.c$a.getVideoModelRxJava`：同一 GET 模板仍在 |
| legacy 多模型声明 | `rpc.rpc.a$a.b`：GET `/reading/bookapi/video_tab/multi_video_model/v:version/` | `rpc.rpc.c$a.mGetVideoModelRxJava`：同一 GET 模板仍在 |
| legacy 请求对象 | 上述七个实例字段 | 七字段之外加 `device_level`、`need_mp4_align`，共九字段 |
| 新版 SaaS 模型声明 | 本表不对旧包其他动态/原生入口作全局不存在断言 | `kl8.a$a`：POST `/novel/player/video_model/v1/`，多模型 POST `/novel/player/multi_video_model/v1/` 与 `.../:dr_scene/v1/` |
| SaaS 顶层请求 | — | `video_id`、`biz_param`、`content_type`、`NovelCommonParam`、`mixed_video_id_map` |
| 普通命名空间响应 DTO | 七字段，无独立 mainUrl/backupUrl | 九字段，增加 `main_url`/`backup_url` |
| SaaS 响应 DTO | — | 八字段：有 main/backup/playAuthToken，未声明普通命名空间的 authorization |

新版另声明 POST `/reading/distribution/video_model_lite/v1/`，不能仅凭名称把它视为主观看链。路由与 DTO 精确声明分别见 [new-model-routes.json](new-model-routes.json)、[new-legacy-request-metadata.json](new-legacy-request-metadata.json)、[new-model-metadata.json](new-model-metadata.json)。旧版路由见 [old-all-playback-routes.json](old-all-playback-routes.json)。表中字段数剔除 Companion、serialVersionUID 等静态成员。

新版主 v2 既有静态路径为 `EpisodeInfo.vid → ss4.e.a → SaasVideoData.vid → pr4.f$a.a → pr4.f.b → impl.v2.data.b.i → dt4.b.a → vs4.a.g → c95.s0.g → kl8`。相比旧版，业务输入仍是 vid/关联素材；请求构造已迁入 SaaS DTO 和嵌套业务参数。优化设置可能改走顶层 content_type，多分支与各方法的精确指令边界见[既有 VID 调查](../../protocol-pass2/vid-mapping/README.zh-CN.md)及[静态序列化调查](../../static-followup/README.zh-CN.md)，不能将这些静态节点当成用户当前播放的执行轨迹。

## VID 与枚举不能混用

旧 `VideoSeriesIdType` 原 `<clinit>` 仅创建 `VideoId(value=0)`、`SeriesId(value=1)`；新版选定普通/SaaS 枚举另有 `PostId(value=2)`。旧 `VideoPlatformType` 为 Unknown=0、PlatformDouyin=1、UgcVideo=2、Outer=3、PlatformXigua=4、Chameleon=5、Mixed=1024。数字取自构造器写入的 `value` 字段，Mixed 的 ordinal=6 不等于 value=1024；本分支没有单凭枚举常量推定最终 wire 编码。

旧 `VideoData.getVid()` 和新 `EpisodeInfo.vid` 都是业务输入，但没有跨版本同内容响应对照证明这两个字段、官网 item_id、TTVideoEngine `v02...` VID 恒等。既有公开网页的 11 组 item_id→TT VID 映射只能说明网页上下文存在映射，不能直接用来填 App 请求。Outer=3 是空平台时默认值，也不是所有剧集的强制平台值。

## REA 账本与剩余问题

| 留存文件 | 实际证据 ID / 结果 | 用途 |
| --- | --- | --- |
| old-slice-package.json | 摘要视图 `ev_08c10fb4681643a280d4d558a7728c793f187b28d67320f19e480f7fa97dc3e6`；原检查引用 `ev_31844361099f3cc124f530050e67bbd4cc5c9dabf6985a0da6bdd56064e87467` | 分片身份、覆盖 |
| old-request-builder-rea.json | `ev_23dba325a36e5ac9c446159ba343fc5ec0e6958ea11cdd2ffa6ae7d7dc6dbb5d`，Java 完整 | 旧 DTO 构造 |
| old-model-request-consumer-rea.json | `ev_a184c46c7f96f473efe916e0c1173b195fbd8d30174082120e6d8cfa48a394b1`，Java 完整 | Rx 请求消费者 |
| old-response-consumer-rea.json | `ev_e2ea1b2e846f68f4813aba9fdf916af7d625baeac69e8613daf7d2ce4a6b7387`，smali 完整回退 | 响应读取字段 |
| old-model-json-parser-rea.json | invalid_request / ambiguous overload，无成功证据 ID | 保留失败与 SDK 补充边界 |

模型对象/字段/路由元数据与 `.dexdump.txt` 是原字节的补充静态观察，不是新的 REA `ev_*`，也不等于抓包。`old-version-literals-sdk.json` 的有限字面量搜索未命中，不足以证明版本替换逻辑不存在。

后续通信整合仍需分开验证：`:version` 与 GET 参数的 RPC 序列化过程；TTNet 运行时补充的公共参数、头与 host 重写；同内容的业务 VID/详情响应；真实响应的非空与试看/过期语义；授权会话对哪些接口必需。旧版在用户手机可用，支持以它为较简单的协议调查入口，但不能证明其所有路由无账号可用。本报告不会据此修改客户端或将未验证的 App 登录/收藏/播放接入标为已完成。

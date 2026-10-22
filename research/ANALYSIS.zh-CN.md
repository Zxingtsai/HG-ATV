> 后续进展（2026-10-21）：本文保留当时观察，旧的“完整播放阻塞/尚未开发”不再代表当前状态。现已通过官网正常软件播放器完成一部剧首/中/末集整集解码，并实现 LAN 服务端和 TV 客户端。当前交付及限制见 [项目说明](../README.zh-CN.md)；新播放验证见 [本轮报告](protocol-pass2/README.zh-CN.md)。

# 红果第三方 TV 客户端：分析进展与证据

观察日期：2026-10-20 至 2026-10-21 UTC。**已完成 REA 安装配置、官网链路验证和原 APK 的定向静态分析；尚未建立完整真实播放链路，服务端和 Android TV 客户端尚未开发，不能称为软件交付完成。** 手机注入路线已因实机故障停用；最新工作改为离线追踪网络配置和请求协议，见 `static-followup/README.zh-CN.md`。

## 工具与目标身份

- `rea-doctor.json` 记录 `rea-agents@6.7.0`、Codex 注册与 skill 版本 42 均为 `aligned`；Node.js 为 24.19.0。该早期快照的 `environment_healthy=false` 包含尚未配置 JADX 等引擎的检查，不代表后续分析未使用 REA。
- 后续 `rea-*.json` 保存了 REA MCP 的真实返回。成功证据使用 JADX headless 0.7.1、JDK 21.0.12.1、4 GiB 引擎堆；JAR SHA-256 为 `6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75`。
- 官网 Android 跳转地址解析到 `lf9-apk.ugapk.cn` 的 APK，下载大小 149,926,819 字节，记录见 `download.txt`。原件为 `hongguo.apk`，SHA-256：`77f23369c02f8a2d7a66f1fbe960dcd7bc402e529f69a4b21bf047c59fea6d93`。
- 清单摘要显示包名 `com.phoenix.read`、版本 `7.4.1.32` / `74132`、minSdk 21、targetSdk 35。`artifact-inventory.json` 列出 25 个 DEX 和 arm64-v8a 原生库。
- 独立的 `apk-signature.txt` 记录 APK v1/v2/v3 签名验证通过，证书 SHA-256 为 `1fe01f1425c72dc1cd158e05cb696cb9fc17259a70f9d233fc48e8e42e6510ec`。这是已下载文件的签名一致性检查；REA 的 Android provider 本身不执行签名验证，也没有据此核验全部供应链身份。

## 原 APK 与 DEX 分片覆盖边界

直接对完整原件执行 `inspect_android_package` 在 240,000 ms 后返回 `provider_timeout`，见 `rea-package.json`。因此**没有完成完整原 APK 的 REA 包级分析**。

后续把原始 Manifest、资源表和指定 DEX 原字节复制到无签名分析载体，再进行定向类/方法读取。三个 `*-provenance.json` 保存来源、成员 SHA-256 和大小：

| 分析载体 | 包含的原 DEX | 载体 SHA-256 |
| --- | --- | --- |
| `analysis-slice.apk` | classes7.dex、classes18.dex | `2dde0d4ef9c4fcdedd7b4b49e8d3aa1bd7bfaeb2bc0b30dd341294ad23fdb84d` |
| `analysis-api-slice.apk` | classes3.dex、classes15.dex | `057acc45b858b0ef91201b38ec1f4e6a3e0e14d3cc01046909e0b295884affa7` |
| `analysis-request-slice.apk` | classes5.dex、classes15.dex | `4653856a1f2897ff9e44dc01f871444ee1bacc785842070d9fd3cd1942eb6be7` |

这些载体不是可安装 App，也不是第三方客户端；所选 DEX 与来源成员逐字节一致，不等于整个 APK 被完整分析。上表三个早期载体合计涉及原件的 6/25 个不同 DEX，实际结论进一步限于已读取的目标类与方法；其他 DEX、原生库、动态加载、反射路径和 Android 运行行为未由这些返回覆盖。REA 的 `source.status=complete` 表示该次返回的方法文本完整，不能解释为全程序语义完整或已观察实际执行。

2026-10-21 后续网络配置分析新增 `static-followup/analysis-host-slice.apk`，包含原 classes15/20/25.dex，SHA-256 为 `eacc701a27dca016cdf4aa4cb307369663dccfd554ff30d6a89ee8b12e85b32f`；逐成员身份见同目录 provenance 文件。加上早期载体，REA 涉及 8/25 个不同 DEX 中的选定类/方法。仅扫描元数据的其他 DEX 不计为已完成 REA 方法分析。

## 已取得的播放模型静态证据

以下都是反编译观察；完整 `ev_*` 标识可在对应 JSON 的 `result.content[].text` 内核对。

| 观察 | REA 证据与文件 |
| --- | --- |
| `ShortSeriesVideoModelCache.b()` 先查缓存，再合并正在请求的监听，最后调用加载方法 | `ev_cc2039f60d3e6a3efc920762af082b72cda52e2f830aabb443ae77ec2aeb4bbe` · `rea-video-cache-method-b.json` |
| 同类 `a()` 设置请求监听，以 `withTimeout(5000L, …)` 执行加载，并把结果或异常通知监听 | `ev_d2f6f5e6039075545f5ab1f7feedee217a0599f86b824f46a4d4cb86f0108cd8` · `rea-video-cache-method-a.json` |
| 网络协程构造 SaaS `GetVideoModelRequest`，设置 `videoId`、平台、清晰度/MP4 对齐、设备等级等；调用 `getRequestManager().g(request)`，读取 `response.data.videoModel`，交给 `VideoRef/VideoModel` 与 `TTVideoEngine` 预加载 | `ev_50660e19157aafbd996ce20a198c85561fbce6dab793262eaf81a9ee9bd9145e` · `rea-video-network-body-alias.json` |
| 请求实现 `c95.s0.g()` 在存在注入实现时转交该实现，否则调用 `kl8.a.a().getVideoModelRxJava(request)`；还会按冷启动条件设置服务端 DNS 参数并处理响应 | `ev_ccacacbbc079efec9b96a5730f5311ef73fbfdde47c023dae20933e53c5877eb` · `rea-request-impl-method.json` |
| SaaS 请求模型包含 `videoId/bizParam/videoContentType/novelCommonParam/mixedVideoIdMap`，与另一命名空间中的同名请求模型不同 | `ev_df7ac277c51b3744eeb97abda2dd761451665456220cf079d2354d2f9b090304` · `rea-saas-request-class.json`；对照 `rea-video-request-class.json` |

`rea-video-network-body.json` 中按 `$1$1` 查找类名失败；后续通过 JADX 显示别名 `AnonymousClass1` 取得上表的成功证据。不能把失败查询视为不存在该逻辑。

补充的原 DEX 注解记录 `dex-routes.json` 显示，`classes15.dex` 的 `Lkl8/a$a;->getVideoModelRxJava` 声明 `$POST /novel/player/video_model/v1/`，另有批量模型路由。这是静态 RPC 声明，**尚未验证实际请求的主机、序列化字节、公共参数、授权状态、响应实例或可供独立客户端重放的完整协议**。URL 字符串、请求模型和调用链共同提供调查入口，但没有证明服务器已接受第三方请求或媒体已经成功解码。

## 官网与媒体实测

详见 [官网报告](web/README.zh-CN.md)、`web/observations.json` 和两个 `probe_*.py` 可复现脚本。

- 首页四组真实内容、分类第 1/2 页、榜单和关键词搜索可从 SSR 数据读取；详情能取得三部样本完整的 46/86/193 个剧集 ID。分类 JS 中的 `/api/category/page` 实测 404；可用路径是分类 SSR 页面。搜索返回 10 项，`?page=2` 与首页相同，尚未找到有效搜索分页。
- 三部剧各抽测前 3 集、中间集和末集，共 15 个位置。前 3 集的公开 360p 媒体均返回 HTTP 206；《王妈…》第 44/86 集和《觉醒伪神7》第 97/193 集公开媒体均 404；《军需处长》第 24 集 404，第 46 集公开媒体存在。只能陈述这些抽样结果，不能外推全片覆盖。
- `/api/video/protected/play-info` 的 HTTP 200 可能包含 `error=protected_playback_unavailable`；另一部分响应包含分离音视频的 `play_info`。首集初始化段实测发现视频 `encv/sinf/cenc/tenc`、音频 `enca/sinf/cenc/tenc`，证明收到的是 CENC 加密媒体结构。`kid`、`player_access_key` 的出现没有建立可用内容密钥或成功解码链路；报告已脱敏临时凭据。
- `public-transcode-test.json` 另记录一个公开样本可被 FFmpeg 识别为 H.264、640×360，10 秒片段转码退出码为 0。它只验证云环境 CPU 上这一个公开样本的处理，不证明用户 Windows 服务器性能，也不证明完整剧集源已接通。

## 后续验证与已撤回路线

手机注入在一加 13T / Android 15 / KernelSU 上导致原版卡死；强行停止后已恢复。日志显示 Java bridge 初始化错误，业务播放观察点未安装、没有采集到播放响应。采集发布包已停用，不再要求用户复现故障。详见 `phone-incident/ANALYSIS.zh-CN.md`。本节旧版提出的手机注入采集不再是有效操作说明。

用户随后提供的公开分享链接返回 31 集目录，但实际片段只有约 30 秒；中、末集查询也返回第 1 集。详见 `share/README.zh-CN.md`，不能计为完整播放通过。

接下来通过原 APK 的离线证据核对网络配置、JSON 序列化名称、公共参数和替代播放字段，再以实际响应与解码验证是否可供独立客户端使用。仍需补齐多个真实剧目的完整播放、地址过期刷新、连续下一集、重试与目标电视解码证据；这些是待验证事项，不是已完成的功能。

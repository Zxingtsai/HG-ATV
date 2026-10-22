> 后续进展（2026-10-21）：本文保留当时观察，旧的“完整播放阻塞/尚未开发”不再代表当前状态。现已通过官网正常软件播放器完成一部剧首/中/末集整集解码，并实现 LAN 服务端和 TV 客户端。当前交付及限制见 [项目说明](../../README.zh-CN.md)；新播放验证见 [本轮报告](../protocol-pass2/README.zh-CN.md)。

# 离线网络协议追踪：后续调查

日期：2026-10-21 UTC。继续用户授权的原 APK 分析，不执行 APK，不操作用户手机，不恢复 Frida 注入。本轮取得了新的网络配置和序列化证据，但尚未取得完整播放响应，服务端与 TV 客户端仍未开发。

## 已回答的问题

| 问题 | 静态观察 | REA 证据 |
| --- | --- | --- |
| 主播放 API 如何创建 | `kl8.a.a()` 调用 RPC 代理工厂；原 DEX 调用明确指向 `kf1.j.e(Class)` | `ev_fec65407732633d199cf3f9b3a5a1e5dfb3bc0f7bc6faee52f1fbd9cb8fd9bcd`，以及 `kl8-a-dexdump.txt` 的 invoke-static |
| 代理工厂下一步 | `kf1.j.e()` 转到 `d()`；后者确保网络初始化，再创建 Java Proxy | `ev_74b11ddc6b866a3527cffa89ec6db0d995bc65b8d42f603ae50688484453fa0c`、`ev_2b94b1b9782f2a28d8122f6bde51f45f83da1e69c42f05e4157177e975c173ca` |
| RPC 配置的 base URL 来自哪里 | `g4.b(Application)` 取 `AppProperty.getBaseUrl()`，设置默认头 `X-Xs-From-Web: 0`，注册 TTNet 传输和 JSON/Wire 序列化工厂 | `ev_d5fbb4863b0ac7773207affff4d6c288194ba6861d22da12b0fb9c0e045f08e6` |
| base URL 的静态值 | `AppProperty.getBaseUrl()` 返回 `https://reading.snssdk.com/` | `ev_1ce9763d0ce882e4cf428c28a4baf4464e2b5371121944f8377ff08f1af511a4` |
| App ID | `AppProperty.getAppId()` 返回 8662 | `ev_0dc976da73eff137a561137d40fe887e92185add3e71eab29dc3be4eb6168253` |
| 响应是否只能表达 TTVideoEngine 模型 | `VideoModelData` 另定义 mainUrl、backupUrl、expireTime、isTrialVideo 等字段；字段存在不证明服务器填充 | `ev_20d63dd2648bbe54d040179953f658955e4be7849c36d19af426b5f0437bb843` |
| 传输层如何发送 | `com.bytedance.rpc.transport.ttnet.b.e()` 从 RPC 上下文取 URL、查询、头和字节体，调用 `RetrofitUtils.createSsRetrofit`，再选择 form/multipart/普通 POST 或 GET | `ev_c72f4641a51de2265fcefc1d7847d9553a71c9b62a393c776a941f0f6adf4a22` |

### JSON 与实际字段名

原 `classes15.dex` 的方法注解明确选择 `SerializeType.JSON`，不是仅由工厂注册 JSON 推断。`model-annotations.json` 另按 DEX field annotations 核对 `@SerializedName`：

| Java 字段 | JSON 名称 |
| --- | --- |
| videoId | video_id |
| bizParam | biz_param |
| videoContentType | content_type |
| novelCommonParam | NovelCommonParam |
| mixedVideoIdMap | mixed_video_id_map |

原 `dex-routes.json` 将 enum encoded value 保留为数值 897。该数是 DEX field_id 索引，**不是序列化协议编号**；本轮解析 field_id 后确认其所属 `com.bytedance.rpc.serialize.SerializeType.JSON`。详细 bizParam 映射也保存在 `model-annotations.json`。只核对这些选定模型，不代表整个 RPC 协议已还原。

## 正常 HTTP 最小探测

将静态配置的 host 与已知 POST 路由组合，发送 JSON `{"video_id":"7693807842205125657"}`。该 ID 来自用户提供分享页的首集；尚未确认它是否就是 App 此调用点要求的 VID 类型。

两次请求均未提供账号、设备标识、Cookie 或签名：一次不加查询参数，另一次仅加静态 App ID `aid=8662`。两次均 HTTP 200，但响应体为 0 字节；第二次头部明确 `content-length: 0`。记录为 `minimal-api-probe.json` 和 `minimal-api-aid-probe.json`。

**没有 JSON、播放地址或可解码正片，不能将 HTTP 200 视为接入成功。** 这些最小请求不重现原版完整请求，不能判断空响应具体是字段、VID 类型、平台选择、公共参数、鉴权、网络来源还是其他原因，更不能仅凭空响应断言服务端必须登录或必须绕过限制。

## 还需回答

- TTNet/RetrofitUtils 全局网络配置补充哪些公共参数和头，以及 RPC 上下文的构成；已知传输层发送分支，不等于还原最终 HTTP 字节。默认 host 不等于已观察原版运行时实际请求 host，运行时仍可能重写。
- 原版播放点使用的 VID 类型与 content_type、video_platform 的正确值，以及与官网 item ID 的映射。
- `NovelCommonParam` 等公共参数的来源和实际必填条件；当前没有证明任何可独立重放的账号或设备授权流程。
- 主模型直链字段是否真实非空、是否为试看，以及地址更新策略。
- 替代 `/reading/media/video/info/`、feed 内嵌播放信息与选集详情的实际用途，见 `alternate-candidates.zh-CN.md`；它们仍是候选。
- 多部剧首、中、末集的完整实际解码、连续播放与过期刷新。这仍是开发完整客户端前的门槛。

## 证据范围

`analysis-host-slice.apk` 是无签名、只供分析的载体，复制原 Manifest、资源表及 classes15/20/25.dex 原字节；SHA-256 为 `eacc701a27dca016cdf4aa4cb307369663dccfd554ff30d6a89ee8b12e85b32f`。逐成员身份见 `analysis-host-slice-provenance.json`。本轮 REA 新涉及原 classes20、25，连同早期分片为 8/25 个不同 DEX 中的选定类/方法，不代表 8 个 DEX 的全部业务都已解释。

本目录 `rea-evidence-bundle.json` 是本轮独立会话导出；早期 15 条证据仍保留在父目录，不能以本轮导出覆盖早期记录。`kl8-a-clinit.json` 是一次未成功的方法反编译，原 DEX dump 仅显示其记录 Covode 类索引，未发现 host 初始化；未对同一失败请求重复调用。证据 bundle 的 unknowns 数量仅是导出对象的计数，不代表上述语义未知项已经解决。

`query.py` 只访问本项目已启动的本地 REA 桥并保存完整 JSON；它不是客户端组件。原 DEX dump 用 Android SDK dexdump 对原字节只读生成；显示文本中不可解码字节采用替换显示，DEX 文件本身不改写。所列方法证据是静态反编译，不能声称观察了 Android 实际执行。

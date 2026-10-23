# REA 分析未解决事项清单

更新时间：2026-10-23 UTC。基于提交 `2893902` 及此前留存的 REA、DEX、网站观察和实测报告整理；原清单没有重新运行 APK、REA 或手机采集。2026-10-23 追加官网搜索分页实测及适配，见 [R02 后续报告](search-pagination/README.zh-CN.md)；此次仍未运行 APK、REA 或手机采集。

本清单记录**目前尚未回答的问题**，不把一次工具错误等同于 REA 永远无法分析，也不把已经通过其他方法补齐的事实继续列为未知。主清单针对原版 App 协议；工具失败/覆盖边界、官网与实机待验收项分别记录。

## 当前进展与阅读范围

- 样本：旧版 `com.phoenix.read` **6.2.3.32 / 62332**（豌豆荚普通下载），新版 **7.4.1.32 / 74132**。2026-10-22 官网普通渠道与既有新版样本的 25/25 个 DEX、Manifest 和签名证书相同；整包渠道摘要不同。身份与渠道说明见[版本对照](version-compare/REPORT.zh-CN.md)。
- REA 已取得选定类/方法的真实结果，但两版整包分析均曾超时。原 DEX 分片、类名别名、同名重载、Java/Smali 表示和普通反汇编的范围必须分别看待。
- **官网软件播放链已实际通过多个完整剧集样本**，产品服务端和电视客户端已经实现；早期报告中“尚未开发/完整播放仍阻塞”是历史状态，不能直接搬到当前待办。
- **服务端 0.1.1 已有官网扫码登录预览**，实测到匿名会话验证、真实二维码生成/显示及取消清理；未完成真实账号扫码成功验收。它没有补齐 App 原生账号协议，详见[账号说明](../docs/ACCOUNT.zh-CN.md)。
- 下文“未知”表示现有证据不足。“未实测”表示已有代码或静态链，但缺少对应运行结果。P0 阻塞独立 App 协议接入，P1 影响正确性/稳定性，P2 是替代路线或覆盖扩展；优先级不表示已承诺实现。

## 原版 App 协议仍未查明的项目

### 请求、设备与业务分支

| 编号 / 优先级 | 尚未解决 | 已知到哪里 | 补齐的判据 |
| --- | --- | --- | --- |
| U01 · P0 | **原版实际发出的完整请求**：最终 host、path、query、body、headers/cookie，以及 SaaS biz_param/NovelCommonParam 的实际值和缺省条件 | 已定位配置 base URL、RPC 声明、选定字段名、DTO、传输适配器；最小匿名 POST 曾 HTTP 200 但正文 0 字节 | 将明确业务调用的实际输入与非空业务响应对应起来，区分原版观察和独立客户端成功请求；不能只以 HTTP 200 判成功 |
| U02 · P0 | **旧路由 `:version` 的实际取值与来源** | 替换算法已找到：先取 map，再反射 public 字段，缺失用空串并去掉尾斜杠；相关旧 DTO 无 version 字段 | 确认调用当时 map/上下文。缺失时推导的 `.../v` 是条件结论；`v1` 和“所有请求都用 v”都不能先写成实测事实 |
| U03 · P0 | **设备注册、公共参数、隐私等级与接口必填条件** | 已定位 DeviceRegisterManager/AppLog/NetUtil 和设备初始化等待；新版也找到公共参数入口 | 确认实际参数的产生/更新顺序及各路由要求。客户端等待设备 ID 不等于所有服务端接口都强制同一参数 |
| U04 · P0 | **native 网络安全处理的完整语义**：输入规范化、环境依赖、运行时附加头与生命周期 | 已到 NetworkParams 安全回调和混淆分派；原包包含 metasec/cronet/Encryptor 等库 | 补足目标 native 调用及实际网络结果之间的证据。尚未复原算法；不能因为某个 URL 校验 hook 原样返回，就断言请求未经过安全处理 |
| U05 · P0 | **业务 vid、网页 item_id、剧 seriesId、TT VID 的同内容映射** | 已追新 EpisodeInfo.vid → SaaS 请求、旧 VideoData.getVid → legacy 请求；网页另有 11 条 item_id → TT VID 观察 | 同内容逐一对照请求/详情/响应和 ID 类型，尤其是关联素材回退；不能把网页单集 ID 或 `v02…` 直接当作所有 App 请求输入 |
| U06 · P1 | **运行时开关、注入实现与场景分支实际选哪条链** | 已看到 MultiVideoModelOpt、请求管理器替代实现、缓存命中、新收藏同步开关等分支 | 确认具体版本、配置、内容和账号下的开关值与调用轨迹；静态存在某条路线不等于当前设备一定执行 |

依据：[版本对照](version-compare/REPORT.zh-CN.md)、[网络与序列化调查](static-followup/README.zh-CN.md)、[VID 主路径](protocol-pass2/vid-mapping/README.zh-CN.md)、[网络安全回调 REA 记录](protocol-pass2/network-security-factor.json)。

### 账号、会话与收藏

| 编号 / 优先级 | 尚未解决 | 已知到哪里 | 补齐的判据 |
| --- | --- | --- | --- |
| U07 · P0 | **可独立使用的 App 登录流程**：验证码前置步骤、完整参数、验证码/风险校验分支和成功处理 | 已见两版 SDK 构造 `/passport/mobile/sms_login/`、mix_mode 和 XOR 调用；旧版追到业务 → SDK 网关，新版当前 UI 到 SDK 的完整选择未追完 | 恢复具体场景的业务调用和请求构造，在账号持有者参与下验证成功与错误分支。端点字符串或构造代码不等于已经能登录 |
| U08 · P0 | **session_key、sessionid、TT token/签名及 CSRF 的实际关系和续期/失效行为** | 已确认 SDK 优先读取、cookie fallback、持久化键和部分响应头处理；本地退出清理路径也已找到 | 验证实际会话流转、失效与清理效果；不能假定不同名字的值恒等，也不能把本地清理当成已证明服务端撤销 |
| U09 · P0 | **官网会话能否用于哪些 App 接口，以及是否存在合法的跨端交换** | 新增预览只建立/验证官网会话；尚无 App 接口接受该会话的成功结果 | 分接口验证会话适用范围；不能把官网扫码成功或保存 Cookie 当成 App 原生认证已打通 |
| U10 · P1 | **远端收藏的运行时同步规则和冲突处理**：新旧分支、时间单位、跨账号、重试/删除、分页/容量 | 已查明旧 info/update、新版 list/类型化 update 与部分账号隔离；旧短剧 book_id_list 的来源是 seriesId | 对应真实账号的读取、受控变更、重读和重启/账号切换结果；不能把新版 info 分页字段套到不含分页字段的新 list 模型。当前产品云收藏尚未接入 |

依据：[版本对照的登录/收藏部分](version-compare/REPORT.zh-CN.md)、[REA 元数据索引](version-compare/evidence-index.json)、[官网账号预览的实际范围](../docs/ACCOUNT.zh-CN.md)。本地完整子调查还保留新 SDK UI caller、成功解析器部分未展开的边界；没有因找到会话字段而宣称完整认证协议已复原。

### 模型响应、播放器与兼容性

| 编号 / 优先级 | 尚未解决 | 已知到哪里 | 补齐的判据 |
| --- | --- | --- | --- |
| U11 · P0 | **App 实际模型响应的填充和授权语义**：main/backup URL、video_model、authorization/play_auth_token、试看与过期 | DTO 字段和选定消费者已核对；普通新版响应九字段、SaaS 八字段与旧版七字段不能混为一个模型 | 确认非空响应及其消费场景、正片/预览含义和有效期。字段存在不证明服务端填充，也不证明任意 URL 都是可直接播放的明文 MP4 |
| U12 · P1 | **完整动态调用图与消费分支**：上层 Consumer、商城自动播放、主观看、下载/预取、反射调用 | 已有多段静态链和 TTVideoEngine.setVideoModel/prepare 入口；部分 Consumer 仅转发结果 | 补齐场景边界和动态选择，不能拼成无条件运行轨迹；一个缓存构造点属于商城，不证明所有缓存方法都只服务商城 |
| U13 · P1 | **App 内地址/模型过期刷新、主备切换、缓存一致性和连续播放错误策略** | 已见 expireTime、过期策略、缓存/预取代码与备份字段 | 明确失效/刷新条件和实际恢复结果；官网样本的完整解码不代替 App 这些运行行为 |
| U14 · P2 | **替代接口和预带播放数据的业务用途** | 发现 `/reading/media/video/info/`、`/reading/media/play/strategy/`，以及 feed/详情中的 URL/model 字段 | 追真实调用者、ID 类型、响应 Map 泛型和播放场景；不能把 audio、广告、下载或预览接口当成短剧主播放替代方案 |
| U15 · P1 | **2024 旧版仍正常使用的服务端兼容原因和适用范围** | 用户实机确认旧版登录/收藏/播放正常；同一签名、接口保留和模型变化已核对 | 结合真实旧/新请求判断兼容机制及版本/场景范围。“旧版能用”不证明无鉴权，也不证明所有旧路由都长期有效 |
| U16 · P2 | **跨 DEX、反射、动态加载和 native 的全程序覆盖** | 已对选定原始 DEX 和方法做定向调查，另有类/字段索引和候选扫描 | 以具体问题扩展覆盖并明确局部结论；列出旧版 13 个/新版 25 个 DEX 或返回完整方法文本，不等于全 APK 语义覆盖 |

依据：[版本对照](version-compare/REPORT.zh-CN.md)、[主路径及缓存范围纠正](protocol-pass2/vid-mapping/README.zh-CN.md)、[替代接口候选](static-followup/alternate-candidates.zh-CN.md)。候选报告的部分字段/枚举/host 问题已被后续补齐；这里保留的是目前仍未解决的调用用途与真实响应问题。

## REA 工具失败、回退和证据覆盖边界

原始返回的**脱敏摘要和逐文件 SHA-256**见 [rea-unresolved-evidence.json](rea-unresolved-evidence.json)。其中本地留存文件名用于复查，不表示原始 APK、厂商代码或完整原始返回都已公开到仓库。

| 编号 | 具体情况 | 当前状态与影响 |
| --- | --- | --- |
| T01 | 新/旧完整 APK 的 `inspect_android_package` 均出现 `provider_timeout`，240,000 ms；摘要 E01/E02 | **整包覆盖未完成**。缩小载体后的选定方法成功，不能消除整包缺口；旧版 13 DEX、新版 25 DEX 的原件与无签名分析载体不能混写身份 |
| T02 | 旧响应消费者 `f$d$a` 的 Java 方法体不可用；返回 `java_body_unavailable`，改用完整 Smali；E03 | **Java 表示缺失，所列静态事实已有 Smali 补证**。不是完全没有结果，更不能把 `source.status=complete` 解释为 Java 或全业务语义完整 |
| T03 | 旧 JSON 模型解析器未选同名重载；旧收藏 `e$q` 查询未匹配 provider 类名；E04/E05 | **调用输入/名称匹配问题**，不是证明方法/类不存在。解析及收藏的部分事实由原 DEX 反汇编补齐；这些失败调用本身没有成功 Evidence ID，未冒充 REA 成功结果 |
| T04 | `kl8.a.<clinit>` 返回 `execution_failure`，不能建立唯一选定反汇编方法；E06 | **REA 此次方法读取未成功**。普通 DEX 补证只见索引记录，不能继续把它当作已确认的 host 初始化来源；host 已从别处查明 |
| T05 | 部分早期 REA 会话中断，完整会话总账未恢复 | **归档完整性边界**。独立完整结果仍留存；版本对照公开索引为 22 条，恢复会话单独导出 7 条，两者有重叠、不能相加，也不是整个项目证据总数。bundle 的 unknowns 计数不是业务未知项计数 |

T02 对应 Evidence：`ev_e2ea1b2e846f68f4813aba9fdf916af7d625baeac69e8613daf7d2ce4a6b7387`。旧/新会话读取、GET 展开和 URL 算法等成功记录可在[版本对照索引](version-compare/evidence-index.json)核对。

## 已修正或已回答，不再计为未解

| 项目 | 当前结论 | 依据 |
| --- | --- | --- |
| 静态 base URL / aid | 两版所查配置均为 `https://reading.snssdk.com/`、8662；仍须区分运行时 host 重写 | [版本对照](version-compare/REPORT.zh-CN.md) |
| 旧 GET DTO 如何展开、枚举/布尔如何处理 | 已追到反射展开到 query map，采用 SerializedName，枚举注解值及 true/false 字符串；未知的是实际上下文和最终发包 | [版本对照](version-compare/REPORT.zh-CN.md)、索引中的 `ev_69822dfbc225d96934d8f0cb62036eb8e3ee6d0bbd0ec31c83c4b37dd3d20180` |
| `:version` 替换算法 | 已找到算法，U02 仅保留实际值/来源未知 | 索引中的 `ev_c0617a18975bcc58ebf621b03e3c44e56d3b9ac5abe5083457bfb81a34a12e14` |
| 新版网络协程 `$1$1` 类名查询失败 | 后续用 provider 显示别名 AnonymousClass1 取得成功；初次错误 E07 已保留 | [早期分析](ANALYSIS.zh-CN.md)，成功 `ev_50660e19157aafbd996ce20a198c85561fbce6dab793262eaf81a9ee9bd9145e` |
| 调用了未注册工具 `decompile_android_method` | E08 是调用名称错误；改用实际工具 `inspect_android_method` 后成功，不计为能力缺口 | [版本对照索引](version-compare/evidence-index.json)的 GET 展开记录 |
| APK 签名 | Android provider 不负责验签，但另用 apksigner 已完成文件验签；不能照搬 provider 的通用限制写成“项目尚未验签” | [版本对照](version-compare/REPORT.zh-CN.md)、[早期分析](ANALYSIS.zh-CN.md) |
| 官网完整播放 | 多个官网样本已完整解码，产品服务已验证整集 HLS；不能继续概括成“加密所以完全不能播放” | [完整播放报告](protocol-pass2/README.zh-CN.md) |

## 另列：仍待实测，但不属于 REA 静态分析失败

| 编号 | 待解决/待验收 | 已知边界与依据 |
| --- | --- | --- |
| R01 | 官网部分剧集 403/`protected_playback_unavailable` 的原因与覆盖范围 | 有时正常重试恢复，另有样本持续失败；未确定是内容、时效、会话、来源环境或其他条件，也未证明登录可解决。[完整播放报告](protocol-pass2/README.zh-CN.md) |
| R02 · 部分解决 | 官网搜索的有效分页已实测；全部结果覆盖仍未证实 | 2026-10-23 官网已切换客户端搜索，实际调用 `/api/search/result?query=…&page=…`。一关键词 20 页全部成功返回，累计 194 条、172 个唯一 series_id，期间 totalCount 在 194–197 变化；有效分页已解决，不能把遍历页码等同于完整快照。已更新服务端与 TV 分页代码。[新证据与复现](search-pagination/README.zh-CN.md)；[旧观察](web/README.zh-CN.md)保留为历史。 |
| R03 | 官网扫码后的真实账号成功、会话重启再验、退出后效果及对播放的实际影响 | 已实现状态机、保存/清理和 47 项服务端测试，匿名二维码与管理 UI 实测通过；成功认证分支目前是模拟测试。[账号预览范围](../docs/ACCOUNT.zh-CN.md) |
| R04 | Windows Server / E3 核显 / Chromecast Android TV 14 实机联调 | Windows 浏览器管道、QSV/转码性能、发现、遥控器、连续播放/后台行为尚待目标设备验收；TV 模拟器未完成启动，不能据此归因客户端失败。[验证记录](../docs/VALIDATION.zh-CN.md) |
| R05 | 一加 13T / Android 15 / KSU 注入卡死的精确根因与 SELinux 策略前后差异 | 已观察 Java bridge 初始化异常，业务 hook 未安装、无播放响应；不能确定具体 ROM/ART/KSU/App 因素。此路线已停用，不将重新注入列为待办。[故障记录](phone-incident/ANALYSIS.zh-CN.md) |

R05 使用的是 Frida 等运行采集工具，不是 REA Android 静态 provider。手机已恢复。官网分享页仅返回首集约 30 秒片段也是已观察到的入口边界，不把“取得完整目录”算作取得完整媒体，详见[分享页实测](share/README.zh-CN.md)。

## 清单如何更新

完成一项时应关联对应原件/方法或正常运行结果，写明适用版本、场景与剩余边界。仅发现字段、声明路由、得到 HTTP 200 或修改了实现，不单独作为关闭 U 类问题的依据。工具错误修正后更新 T 类状态；真实设备/账号验证写入 R 类，避免将两者混在一起。

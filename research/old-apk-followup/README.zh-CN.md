# 旧版原包 REA 续查（6.2.3.32）

日期：2026-10-23 UTC。按用户要求优先旧版，使用用户提供的 [REA](https://github.com/morluto/rea) 和 Release 对应原包。本轮解决 **T03 两个失败调用**，解决 **T01 的旧版 package inspection 超时子项**；补充 U02/U10/U12/U13/U14 的静态边界，未把运行时问题标记为完成。

## 原件、工具与证据范围

- 原件：`hongguo-6.2.3.32-original.apk`，71,781,163 字节，SHA-256 `7724c9a2a7cd5a4cc53edf309dbd628a9e2418e459805b571eda9537881a8f27`。[Release](https://github.com/Zxingtsai/HG-ATV/releases/tag/original-apk-samples-2026-10-22) 对应的文件由 Git LFS 提供；下载的是 APK 实体，不是指针。
- `apksigner verify --verbose --print-certs`：v1/v2/v3 验证通过；证书 SHA-256 `1fe01f1425c72dc1cd158e05cb696cb9fc17259a70f9d233fc48e8e42e6510ec`。这是独立验签，不是 REA Android provider 的能力。
- `rea-agents@6.7.0`，JDK 17.0.21，JADX headless 0.7.1，4 GiB heap，2 个可用处理器、1 个分析 worker。JAR SHA、源码版本及逐次记录见 [evidence-index.json](evidence-index.json)。未修改原包、未运行 App、未采集账号或发起原生业务请求。
- 原始 13 个 DEX 的声明类合计 123,287；provider 加载报告的 class_count 为 57,091，resource_count 为 12,527。口径不同，不能互换或当作全程序语义覆盖。DEX 身份见索引。
- 本轮初始会话中断，但逐次返回仍留存；恢复会话另行导出 bundle。公开的是查询、Evidence ID 和原始记录文件 SHA，不公开整份厂商反编译源码。历史会话总账没有因此恢复，T05 仍保留。

## T01 / T02 / T03 的实际变化

旧完整原包的 `inspect_android_package` 首次成功用时 52,930 ms（`old-package.json`）。初次返回是 summary，指向 parent Evidence；恢复后又使用 `detail=complete` 留存完整 package 返回（`old-package-recovered.json`）。这消除了旧版这一项调用的超时问题，不表示全部类、native、反射或业务路径均已解释；新版完整包本轮未分析。

旧解析器使用 provider 类名 `com.dragon.read.component.shortvideo.impl.v2.data.f.a`，选择 `a` 的 overload_index **1**，DEX 描述符 `(Ljava/lang/String;)Lcom/ss/ttvideoengine/model/VideoModel;`，得到完整 Java 方法体。流程为 JSON → `VideoRef.extractFields` → `VideoModel.setVideoRef`，异常返回 null。Evidence：`ev_1ac63a38d72385d8c4ec4ce2dfa2cf0d9a8c8b91313191c12c9ed1970e81aaf2`。

旧收藏 raw 名称 `e$q` 对应 provider `com.dragon.read.pages.video.e.q`，类元数据和 `run():void` 均成功。run Evidence：`ev_dea76d336b403e36056c5f65c0aafc5d7c9adf3cd146d46d1e8e078fdb7fd1f5`。T03 两种输入问题已修正；同名重载索引依赖锁定的引擎与样本，其他版本应先查类元数据。

旧响应消费者 `f.d.a.a(GetVideoModelResponse)` 再次得到完整 **Smali**，仍有 `java_body_unavailable`。T02 不关闭 Java 表示缺失；返回包含宽高、expireTime、isTrial 和 JSON 解析/缓存分支的静态信息，不应写成“无证据”。

## U13：缓存过期条件已具体到分支

目标为旧 `impl.v2.data.f`，查询见 `old-cache-expiry/lookup/request`、`old-expiry-setting/default`：

1. `a(long expireTime)` 先查 settings.x.c()；若为 true，直接返回“不在此处判过期”，日志写 player inner invoke expire。这只是将判断交给另一层的静态分支，未验证播放器最终如何刷新。
2. 否则以 SaaS docker 接口 `l()` 返回的远端时间与 `1000 * expireTime` 比较，**大于或等于**即过期；`System.currentTimeMillis()` 在此方法只用于日志。这里支持“消费者按秒解释 expireTime”，不证明服务端每次都填充合法秒值。
3. `a(String, boolean ignoreExpire)` 在 ignoreExpire=true 时直接返回缓存；否则过期返回 null，该方法没有删除缓存项。模型加载方法在有缓存且未过期时复用，否则创建请求订阅者。
4. 开关来自 `own_player_retry_v605` 的 `video_model_external_expire_enable` 字段。Kotlin 默认参数掩码 7 对应 `(dash_enable=false, retry_count=3, video_model_external_expire_enable=false)`，不是把构造调用表面的 0 当成默认重试次数。字段注解与默认分支均已核对原始 DEX。

REA 对模型加载方法返回两个 incoming using nodes：`impl.v2.core.j.a(VideoData, Consumer, boolean)` 的直接调用（classes11.dex，code-unit offset 0x74），以及默认参数桥接方法。这是静态节点范围的结果；不能证明仅两条动态路线，也不能把缓存限定成商城专用。U12/U13 的主备切换、播放器错误恢复及实际开关值仍未完成。

## U10：收藏同步的静态风险与数据库补证

`e.q.run` 从 DAO 取得记录，选 `h=false` 的整批待同步项，再按 `g` 拆分新增和删除。请求分别设置 `isCancelled=false/true`，ID 和 modifyTime 分别取实体字段。这里只确认字段传递，不推定时间单位或服务器冲突规则。

新增成功回调会将**整批待同步项**（包括原本待删除的项）设为 `h=true` 后调用 DAO.d(List)；删除成功回调另行调用 DAO.c(删除 ID)。错误回调在所查方法中只记录日志。run 尾部的 Callback 不构成两个异步请求全部成功的屏障。

原始 classes12.dex 补证：

| 方法 | 关键指令位置（code-unit offset） | 含义 |
| --- | --- | --- |
| `e$q.run()V` | 0x23、0x55、0x99 | 读取 h、按 g 分组；新增成功 Consumer 构造接收整批 list |
| `e$q$1.a(UpdateBookShelfVideoInfoResponse)V` | 0x2f、0x38 | h=true；调用 dv.d(List) |
| `dw.d(List)V` | 0x27 | 按块向代理 DAO 转发，无新增/删除重新筛选 |
| `dx.d(List)V` | 0x0c | 在 Room 事务内调用插入适配器 |
| `dx$2.a(SupportSQLiteStatement,ba)V` | 0x45、0x4c | g/h 分别绑定 is_delete/is_sync |
| `dx$2.createQuery()` | 0x00 | `INSERT OR REPLACE` 收藏表，包括 is_sync |
| `dx.c()List` | 0x02、0xcd | 读取全部收藏记录，并将 is_sync 读回 h |

因此，在同批存在新增/删除、实际使用这条同步链、DAO 写入成功、删除失败且没有其他路径重置状态的条件下，下一次按 `h=false` 选取可能跳过删除重试。这是**有数据库代码支持的条件性风险**，未在原版运行中复现。并发回调还需核对是否可能重建已删除记录；不能根据当前静态片段宣称所有场景必现或修改第三方 App。原始反汇编文件 SHA 见 [dex-evidence.json](dex-evidence.json)。

## U02 / U14：收窄了哪里，哪里仍未知

`rpc.i.c(l)` 显示 query 不仅来自业务 DTO：还有 common/biz 参数注册表、调用初始化/pre-handler、参数注解及上下文 map 合并，最后才交给 transport builder 展开 URL。`rpc.n.a(Object)` 可注册带 `RpcBizParam` 注解的对象；query setter 可经 `rpc.h.b(String,String)` 或 `rpc.b.b(String,String)` 进入上下文。本轮对应注册器与两个 setter 的 using-node 查询均未得到上游业务引用。这不证明反射/动态注册不存在，仍未取得 `:version` 在实际调用时的值。U02 不关闭，也不把条件推导的 `/v` 或猜测的 `/v1` 当实测。

旧 `rpc.rpc.e.a(VideoInfoRequest)` 的 incoming 查询返回 0；接口 `rpc.rpc.e.a` 的同签名方法只返回这个包装方法的调用（classes13.dex，offset 0x04）。因而当前证据止于声明和包装，不支持把 `/reading/media/video/info/` 认定为短剧主播放替代路线。0 条 using nodes 不是动态不可达证明。新版候选的用途不能直接套到旧版，U14 保留。

## 复现与后续验收

已有 Node、JDK 和锁定 JADX JAR 后，在独立目录安装 `rea-agents@6.7.0`（例如 `npm install --prefix /path/to/rea-cli --omit=optional rea-agents@6.7.0`），运行：

```sh
REA_INSTALL=/path/to/rea-cli \
JAVA_HOME=/path/to/jdk17 \
REA_JADX_MCP_JAR=/path/to/jadx-headless-mcp-0.7.1-all.jar \
node research/old-apk-followup/replay.mjs /absolute/original.apk /absolute/new-output \
  old-package-recovered old-parser-body old-shelf-q-run
```

脚本先核对原包 SHA 与 REA 包版本，逐次保存成功/失败，最后导出本次 bundle；不带最后三个标签会重放索引中的全部查询。输出目录必须不存在。脚本不执行 APK、不注册宿主客户端配置。MCP SDK 2.x `callTool` 的 timeout 必须放第二参数；本轮初始桥接脚本误放第三参数时触发 60 秒客户端取消，修正后调用成功。不要把这种客户端取消混记为旧清单中的 240 秒 provider_timeout。

本轮以独立新 MCP 进程实际跑通上方三项查询，并成功导出 bundle；返回 Java 方法体完整，逐文件摘要与耗时见 [validation.json](validation.json)。索引中 42 份原始结果的 SHA 已逐项核对，复现脚本通过 Node 语法检查。仓库改动仅研究文档、索引和复现脚本，本轮未修改产品代码。

剩余工作需要与问题对应的运行证据：旧版原生请求完整输入/非空响应、实际配置、同内容 ID 映射、账号会话、收藏受控变更与重读、过期及错误恢复。当前没有连接目标 Android 设备或账号会话，不能靠静态方法文本关闭这些事项。已停用的手机注入路线未重启。

# RPC、查询参数与网络层对照

2026-10-22。分析对象是 6.2.3.32 普通下载原包，以及与今日官网普通渠道 DEX 相同的 7.4.1.32 既有样本。这里补充业务接口与真正发出 HTTP 请求之间的静态边界；没有运行 APK、注入手机或请求账号接口。

## 主机与初始化

旧 `AppProperty.getBaseUrl()` 返回 `https://reading.snssdk.com/`，`getAppId()` 返回 8662。REA 完整记录分别是 `old-app-base-url-rea.json` / `ev_eb50c53393cc84cdba3bd28f8fe73c44c4c33a6dd0a6690fb587457b9467b300` 和 `old-app-id-rea.json` / `ev_73a36330601464a877c5abb45cb8d82e2c02713e834785dd808844aa90b1fbc2`。这与新版已查值相同；配置主机不等于运行时所有请求最终使用同一 host。

旧 `com.dragon.read.app.launch.task.ac.a(Application)`（classes9.dex，code item `0x610e18`）设置上述 base URL、公共参数开关和 `X-Xs-From-Web: 0`，初始化 RPC，注册 TTNet 传输、JSON/Wire 序列化器及类型预注册器。`QualityOpt.fixTransportManagerEnable` 控制拦截器注册方式。新版对应 `g4.b(Application)` 保留同类结构，见既有 `research/static-followup/task-g4-b.json`。本次没有观察该开关的运行时值。

## 旧 GET 请求确实会把 DTO 展开到 query map

不能仅凭 DTO 的 `SerializedName` 推断 HTTP。本次额外追到原 SDK 指令：

1. `com.bytedance.rpc.j.a(Method)`（classes8.dex，`0x459938`）解析 `$GET ...` / `$POST ...`、`RpcParams`、serializer 等注解；`JsonSerializeFactory.isReflectSupported()` 返回 true。
2. `com.bytedance.rpc.i.c(l)`（code item `0x457c50`）创建请求、处理参数。对普通对象、没有 multipart 等特殊覆盖且非 POST 的路径，在相对指令 `0x016e–0x0170` 将剩余参数传给 `serialize.g.b(Object,Map)`，目标是 `rpc.f.b` 查询 map。`RpcParams=true` 不能直接解释为“整个对象作为 JSON GET body”。
3. `serialize.g.b(Object,Map)`（`0x45d5c8`）遍历对象声明字段，跳过 static、`RpcField`、`RpcFieldTo` 以及 null 值。普通字段取 `SerializedName.value()`，没有注解则取 Java 字段名；普通值经 `String.valueOf(g.a(value))` 放入 map。Map、List、JsonObject 等有独立分支。本次七字段播放 DTO 没有这两种 RPC 字段注解，且字段是字符串、布尔、整数、枚举。
4. `serialize.g.a(Object)`（`0x45cf64`）对枚举先读常量的 `SerializedName`，再尝试 WireEnum 的 `getValue()`，最后才保留对象。旧普通命名空间 `VideoPlatformType.Outer` 注解为 `"3"`、Mixed 为 `"1024"`；VideoSeriesIdType 的 VideoId/SeriesId 注解为 `"0"`/`"1"`。因此在该静态展开路径，它们成为这些字符串，不能误用 ordinal 或常量英文名。布尔字段经装箱再 String.valueOf，得到 `"true"` / `"false"`；零值 int 与 false 不因值为零而省略，null 字符串才跳过。
5. `com.bytedance.rpc.transport.ttnet.a.b(g)`（`0x45f148`）复制 query map、解析 URL，并在 GET 分支调用 `RetrofitApi.get(...,path,query,headers,context)`。这是旧 TTNet 适配器 a；旧 b 是响应流包装类，不能与新版适配器 b 混同。

这确认了**选定路径在 TTNet 入口前的 query map 语义**。未由此确认最终 URL 百分号编码顺序、后续公共参数、安全头和服务端接受条件。

聚焦 REA：

| 操作 | 完整留存文件 | Evidence ID |
| --- | --- | --- |
| serialize.g 类与重载清单 | old-rpc-serialize-g-rea-class.json | ev_c8f98a070a32681a7e15c1efa85ed25c092f39ebfe4a85b2c66ab0b60f8e3266 |
| DTO 展开 b(Object,Map)，同名重载 0 | old-query-flatten-rea-method.json | ev_69822dfbc225d96934d8f0cb62036eb8e3ee6d0bbd0ec31c83c4b37dd3d20180 |
| 枚举转换 a(Object)，同名重载 1 | old-enum-query-rea-method.json | ev_1992a39c54a1f65e63dcbbb7cf3373d0c7e9477536aa55b81b3eba14e5cd6d92 |

方法结果均为完整 Java 表示，没有 smali 回退。曾误用未注册工具名 `decompile_android_method`，失败记录单独保留在 `old-query-flatten-rea.json`，无 Evidence ID；成功调用是实际存在的 `inspect_android_method`，没有将错误结果当作证据。

## `:version` 的处理机制已找到，最终值仍需分开确认

原 `transport.g$a.a(Object[])`（`0x45e518`）将路径、query map、剩余对象及 `remove=true` 交给 `internal.c.a(String,Map,Object[],boolean)`。该方法支持 `{name}` 和 `:name`：先从 map 移除并取出名字对应的值；为空时反射参数对象的 public 字段，以 SerializedName 或字段名匹配；仍未找到则填空串，最后删除末尾 `/`。反射 fallback 不会凭空补 `1`。

完整 REA：`old-url-expansion-rea-method.json`，`ev_c0617a18975bcc58ebf621b03e3c44e56d3b9ac5abe5083457bfb81a34a12e14`，同名重载 3、完整 Java；类清单 `old-rpc-url-rea-class.json` 为 `ev_472576eda11dcb7f875718336aa73c2de7df964ec42fcfb0ae7c3080eaebd624`。普通指令见 `old/com-bytedance-rpc-internal-c.dexdump.code.txt`，fallback 字段查找方法 code item `0x4591bc`。

旧播放、收藏 info/update DTO 的 superclass 为 Object，接口仅 Serializable；完整静态字段也没有 `version`，不应在模型里虚构它。**如果调用当时的 query map 和 public 字段都没有 version，该算法会把 `.../v:version/` 展开为 `.../v`，并非 `.../v1/`。** 这是明确条件下的静态推导；请求 map 可能经过其他注册参数或上下文修改，本次没有捕获实际 map，因而既不把 `v1` 写成已证实，也不把条件推导写成实机全部请求的最终 URL。最终值留为未知，不进行基于猜测的认证接口重放。

## 会话、设备初始化和安全处理是不同层

旧 `com.dragon.read.base.http.b.a` 实现 NetworkParams.ApiProcessHook。其 `addCommonParams` 先检查/等待设备初始化，再交给 `NetUtil.addCommonParamsWithLevel`；`onTryInit()` 调 `AppLog.tryWaitDeviceInit()`；`putCommonParams` 交给 `NetUtil.putCommonParamsWithLevel(..., Level.L1)`。代码对缺少 device ID 有下游请求异常提示，但这只是客户端逻辑，不能当作每个服务端路由必需 device ID 的测试结果。

该实现的 `addRequestVertifyParams` 返回原 URL，**不能据此断言未签名**。另有 `NetworkParams.tryAddSecurityFactor` 回调，旧实现 `ms.bd.c.b3$a` 进入 `ms.bd.c.l.a` 分派。旧包已经包含 `libmetasec_ml.so`、`libsscronet.so`、`libEncryptor.so`；新版也有对应库，但逐库摘要变化。只证明库及调用边界存在，不声称复原了安全算法，也不把动态安全头名称/值猜出来。

账号 SDK 的 session_key/sessionid、csrf、TTTokenManager 则属于会话层，详见 [账号与收藏](../account-library/README.md)。公共设备参数不等于登录，登录 cookie 不等于能替代全部网络安全处理。

## 覆盖与留存

`old-rpc-slice.apk` 只含原 classes8.dex 加原 Manifest/resources，`old-http-slice.apk` 只含 classes9.dex；原 DEX 内容未改，只有载体成员名重命名为 classes.dex。它们无签名、不是原版可安装包，也不代表全程序关系已经恢复。各自 provenance 保存原包/原成员/载体 SHA-256。普通 dexdump 与 REA Evidence 分别记录。

`old-request-and-enum-complete-metadata.json` 保留字段、注解、父类和接口；`native-library-identities.json` 保留原库身份；`old-network-hook-implementors.json` 与候选扫描只用于定位，核心结论另有原指令核对。REA 全 APK 调用曾超时；分片成功并不能消除跨 DEX、native、运行时选择及真实发包未知。

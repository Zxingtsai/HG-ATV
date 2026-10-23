# 旧／新登录会话与短剧收藏通信对照

范围：6.2.3.32（62332，2024 旧版）和 7.4.1.32（74132，现有新版基线）。这里只分析普通下载得到的 APK，没有发送短信、登录账号、读取用户私有会话或写入收藏。用户提供的“旧版实机登录、收藏、播放正常”是用户侧运行事实；下面的 APK 静态证据不用于否定它，也不冒充本次网络成功验收。

`old/new-*-provenance.json` 保留原 APK SHA-256、原 DEX 成员名及逐字节 SHA-256。REA 载体仅放入原 Manifest 和一个原 DEX（重命名为 `classes.dex`，内容未改）；它们是**未签名、覆盖不完整的分析载体**，不是原 APK，也从未被启动。`*.dexdump.txt`、`*-model-schemas.json`、`*-endpoint-annotations.json` 是普通静态证据；`rea-*.json` 保存完整 REA 结果，两者必须分开引用。REA Evidence ID 索引见 `evidence-index.json`。

## 收藏：旧版已经有真实账号同步，不是只有本地收藏

旧包 `com.dragon.read.pages.video.e` 的日志名就是 `VideoCollDataServer`。其构造函数通过 `NsCommonDepend.acctManager().getUserId()` 选择用户数据库。`d()` 又分别打开 `DBManager.obtainVideoSeriesDao("0")` 与当前用户 DAO；因此匿名数据、登录用户数据和远端同步是实际业务代码的一部分，而不是仅从通用 SDK 字符串猜测的功能。

旧版的直接链路是：

1. `pages.video.e.a(Callback)`，原 `classes12.dex`、code offset `0x4c7304`，创建 `GetBookShelfVideoInfoRequest`，调用 `rpc.rpc.a.a(request)`。
2. 该 RPC 接口的 `RpcOperation` 明确声明 **`$GET /reading/bookapi/bookshelf/video/info/v:version/`**、`RpcParams=true` 和 JSON serializer。旧请求类没有声明实例参数字段；具体 `:version` 替换值以及公共请求参数另由 RPC／网络层提供，本报告不把占位符擅自写成 `v1`。
3. 响应声明为 `{code: BookApiERR, message: string, data: {video_shelf_info: BookShelfVideoData[]}}`。`pages.video.e.a(GetBookShelfVideoInfoData)`，offset `0x4c71b4`，确实读取 `BookShelfVideoData.videoData.seriesId`，创建本地 `local.db.entity.ba`，同时保留标题、封面、状态与时间信息。该路径将服务端 `last_operate_time` 乘 1000 后存本地。
4. `pages.video.e$q.run()`，offset `0x4c6d24`，从本地 DAO 取待同步项，按取消标记拆成两批。每批创建 `UpdateBookShelfVideoInfoRequest`，填 `book_id_list: string[]`、`modify_time: long[]`，分别设 `is_cancelled=false/true`，调用 **`$POST /reading/bookapi/bookshelf/video/update/v:version/`**。声明响应为 `{code: BookApiERR, message: string}`。这里只证明静态构造与调用，未执行任何修改请求。

**ID 语义有业务代码证据：这个短剧收藏路径的 `book_id_list` 来源是剧的 `seriesId`，不是播放单集 `item_id`。** 证据链是响应 `VideoData.seriesId` → 本地实体首字段 `ba.a` → `book_id_list`。不能因字段叫“book”就当小说 ID，也不能把播放接口的单集 ID 填入它。其他书架、PUGC、音频等接口仍需各自区分。

主要证据：`old-com_dragon_read_pages_video_e.dexdump.txt`、`old-com_dragon_read_pages_video_e_q.dexdump.txt`、`old-endpoint-annotations.json`、`old-model-schemas.json`。`old-shelf-reference-candidates.json` 是宽松 code-unit 候选扫描，只用于定位；以上结论已用实际 `dexdump` 指令核对，不直接把候选当作已验证调用。

## 新版不是简单删除旧接口：有保留分支，也有新的轻量列表

相同 `video/info` 与 `video/update` 路径仍存在，RPC 声明现在位于原 `classes9.dex` 的 `rpc.rpc.c$a`。有实质模型变化：

| 模型 | 旧版声明 | 新版声明增加的字段 |
| --- | --- | --- |
| `GetBookShelfVideoInfoRequest` | 无实例字段 | `target_user_id`, `offset`, `count` |
| `GetBookShelfVideoInfoData` | `video_shelf_info` | `has_more`, `next_offset`, `total`, `max_bookshelf_cnt` |
| `UpdateBookShelfVideoInfoRequest` | `book_id_list`, `modify_time`, `is_cancelled` | `update_bookshelf_video_list`, `shark_extra` |
| `UpdateBookShelfVideoInfoResponse` | `code`, `message` | `log_id` |

新版实际业务类 `VideoCollDataServer.k(Callback)`（原 `classes7.dex`，offset `0x7718dc`）首先检查 `videoCollectionSyncManager.c()`。该值为 true 时直接返回，静态日志明确说“短剧万本书新逻辑不走video/info请求逻辑”；false 时才创建新版 info 请求，调用 `getBookShelfVideoInfoRxJava`。**因此不能用接口仍存在推断当前所有设备都走旧分支，也不能把新增 info 分页字段套到下面的新 list 路径。** 本次未读取运行时开关值。

新版另有 **`$GET /reading/bookapi/bookshelf/video/list/v:version/`**。直接调用者 `com.dragon.read.component.biz.impl.series.coll.video.a.n(String,boolean)`（原 `classes17.dex`，offset `0x566658`）创建 `GetBookShelfVideoListRequest`，显式填写 `targetUserId`，调用 `getBookShelfVideoListRxJava`。此请求对象只有 `target_user_id`；响应声明为：

```text
{code, message, data: {
  max_bookshelf_cnt,
  video_shelf_info: LightBookShelfVideoData[]
}}
LightBookShelfVideoData = {
  series_id, book_type, content_type, collect_time, last_operate_time,
  modify_time, series_creation_status, video_category_type
}
```

这个新 list 请求／响应**没有声明网络分页字段**。轻量项也没有旧 `BookShelfVideoData` 那样的完整 `VideoData`。后续信息加载和本地协调不能仅凭名称当作已复原的全部网络协议。

新版写入调用不只沿用旧三字段：`pd6.d1.call()` 等实际业务 closure 创建 `UpdateBookShelfVideo`，填 `book_id`、`modify_time`、`group_name`、`video_shelf_operate_type`、`book_type`；操作枚举包括 `AddShelf`、`DelShelf`、`AddGroup`、`DelGroup`。`pd6.u1.invoke()` 等将这些项放入 `update_bookshelf_video_list`，再调用相同 `updateBookShelfVideoInfoRxJava`。发送前还调用 `VideoCollDataServer.j(uid)` 比较当前用户；账号变化时保留原账号操作并跳过该批发送。短剧模型仍有明确 `BSVideoCollModel.seriesId` → `bookId` 的映射，但新版类型化结构也服务其他内容类型，不能把所有 `book_id` 一概解释为短剧 series ID。

主要证据：`new-com_dragon_read_pages_video_VideoCollDataServer.dexdump.txt`、`new-com_dragon_read_component_biz_impl_series_coll_video_a.dexdump.txt`、`new-pd6_d1.dexdump.txt`、`new-pd6_u1.dexdump.txt`、`new-model-schemas.json`、`new-endpoint-annotations.json`。

## 登录／会话边界

独立静态子调查见 [`session-static/REPORT.md`](session-static/REPORT.md) 和该目录的结构化证据。其重点是实际 AccountService／AcctManager、SDK 会话保存、cookie fallback、退出清理与短信登录构造。REA 对旧／新 `AccountServiceImpl.getSessionKey()` 的聚焦验证结果也保存于本目录。

需要保持的区别：SDK 的 `session_key` 是会话对象／持久化字段名，`sessionid` 是 cookie 名；仅凭这些静态名字不能声称本次动态证明了二者值相同。SDK 提供登录 endpoint 不等于已经确认某个 UI 分支当前执行该 endpoint；业务 caller、SDK 构造、序列化模型分别标明。未进行短信、账号登录、会话导出、收藏写入或有效认证网络重放。

## 结论边界

- **已回答（static）：** 两版短剧收藏的确切 RPC path／方法声明、主要请求与响应模型、旧版实际同步调用者、剧 ID 与单集 ID 的区别，以及新版分支／模型变化。
- **已回答／部分回答（static + focused REA）：** 会话读取、SDK 保存键、cookie fallback 与 logout 清理，详子报告及 Evidence 索引。
- **未验证：** 用户登录后的真实响应包、服务端当前鉴权要求、运行时 feature flag、完整跨 DEX 关系、TLS／native 网络层实际发出的每个头，以及任何第三方客户端成功登录或同步收藏。

本报告并不把“2024 旧版还能用”推演成“旧版无需会话或公共请求处理”，也不把新模型变化推演成“旧接口已经失效”。

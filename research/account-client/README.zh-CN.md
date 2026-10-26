# 客户端扫码、云历史与云收藏

日期：2026-10-25 UTC。

## 已验证

持号者通过红果 App 扫描官网二维码并确认，服务端用官网 SDK 验证后进入 authenticated。环境重启后重新验证保存的会话成功。未以磁盘 Cookie 或扫码确认事件代替官网验证。

在持号者授权下，限定向原包中的官方 `https://reading.snssdk.com` 账号路径发送 `sessionid` 做兼容性测试（aid=8662）：

- GET `/reading/bookapi/read_history/list/v` 返回 code=0、40 条历史，最近两部名称和顺序与持号者提供的手机记录吻合。响应为 data_list、next_offset、has_more、total。单集 ID 与官网详情交叉核对成功；原生 int64 由 JSON reviver 的原始数字文本转换为字符串，避免精度丢失。
- GET `/reading/bookapi/bookshelf/video/info/v` 返回 code=0、2 部收藏，字段包括 video_shelf_info、has_more、next_offset。不能仅凭旧 DTO 无分页字段就忽略本次实际响应分页。
- 读取 offset=1 的历史返回 39 条，next_offset=40、has_more=false；limit=1 未将返回数量限制为 1，因此以真实 has_more/next_offset 驱动分页，不根据请求条数猜测末页。当前账号不足以验证多个非末页，分页边界由自动测试补充，不能冒充大账号实测。

生产适配严格限制 App 会话的目标 origin、三个固定路径和 aid，仅传 sessionid，不放开完整官网 Cookie。完整 Cookie 仍仅用于原官网。全部云列表走配对认证，内存缓存 60 秒并绑定账号 revision；退出、切换、失效和迟到请求均不能复用旧账号数据。

## 收藏写入仍未完成

持号者授权受控添加后取消，随后扩大为允许使用自己的账号测试。旧版 JSON 三字段请求（book_id_list、modify_time、is_cancelled）在固定 update 路径得到 HTTP 200，但业务 code=101144、追剧失败。补充旧版版本字段、原包中已有的新版类型化操作、会话现有 CSRF token/header、v1 路由假设及原始 charset 后仍拒绝；另一个已存在观看记录的系列也同样失败。没有把这些尝试当作已验证的通用写入协议。

每次写入后均重读，收藏目标未加入；最终集合仍与初始集合完全一致。没有盲目自动重试 POST。尚不能区分缺失 App 写入上下文、服务端校验或其他业务条件，不能宣称完整原生认证与写入链已打通。

因此客户端明确标注云收藏只读；生产 PUT/DELETE 返回 501，而不是保留一个误导性的可用添加按钮。研究适配器保留目标状态、串行写入和写后重读逻辑用于后续验证，HTTP 路由不启用它。完整计划的添加/取消收藏与最终合并仍未完成。

## 证据边界

官网脚本 async_t.d1c39a18e1.js 声明的 `/api/pc/watch-history`，在 q.730f5fd582.js 中是 POST 进度上报，而非历史列表；GET 实测404。没有向该路径伪造播放进度。

原版6.2.3.32经REA补查 GetReadHistoryRequest/Response/Data 及调用引用，普通DEX元数据核对 book_type=2(Watch)、last_min_read_timestamp_ms、full_field、limit、offset 和响应字段。原始数值/会话/个人历史响应保留在本机私有临时目录，不进入仓库、APK或更新包。公开验证记录只保留匿名结果和代码/证据摘要。

客户端 APK 编译和 lint 通过；目标电视遥控器、Windows 浏览器进程仍未实测。仅匹配到同一单集 ID 和集数时显示“接着手机看”，不把整剧时长当单集时长；本机历史不会上传。

2026-10-26 打包核对：当前构建签名与仓库0.1.0签名不同，原签名密钥不在本工作区。增加 accountPreview 变体，以 cn.hongguotv.preview 并存安装，避免要求卸载旧 APK 并丢失本机数据。尚未在实体电视安装。

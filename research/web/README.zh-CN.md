> 后续进展（2026-10-23）：官网搜索已切换客户端页面和 JSON 接口，有效分页已实测并接入，跨页去重后的全部覆盖仍未证实，见 [R02 后续报告](../search-pagination/README.zh-CN.md)。本文关于搜索 SSR 与 `?page=2` 的结论保留为历史观察。
>
> 后续进展（2026-10-21）：本文保留当时观察，旧的“完整播放阻塞/尚未开发”不再代表当前状态。现已通过官网正常软件播放器完成一部剧首/中/末集整集解码，并实现 LAN 服务端和 TV 客户端。当前交付及限制见 [项目说明](../../README.zh-CN.md)；新播放验证见 [本轮报告](../protocol-pass2/README.zh-CN.md)。

# 红果官网链路实测记录

观察日期：2026-10-20 UTC。目标：`https://hongguoduanju.com`。请求没有登录，没有提供官方账号令牌。这里记录网页和静态 JavaScript 所能证明的事实，不代表 APK 接口分析结果。

**结论：目录、分类分页、榜单、搜索、详情和完整剧集 ID 可取得；官网匿名链路尚不能支持完整全剧播放。** 前三集的公开 360p 文件可以取得，抽测多部剧中后段多数不可公开取得。受保护接口 HTTP 200 既可能返回错误，也可能返回 CENC 加密音视频信息；没有完成解密或播放器解码验证，不能把它计为播放成功。

## 可复现文件

- `probe_website.py`：仅使用 Python 标准库；读取官网页面与接口，验证三部剧各第 1、2、3、中、末集；保存 `observations.json` 与各页提取 JSON。`python research/web/probe_website.py` 可重跑。
- `probe_protected_init.py`：重新请求第一部剧首集受保护播放信息，只读取视频/音频各 4096 字节初始化数据并检查 MP4 标记；不尝试解密。运行后保存 `protected-media-observation.json`。
- `observations.json`：15 个剧集案例的原始状态、Content-Range、MP4 头部与响应结构。临时签名媒体 URL、`kid`、`player_access_key` 已脱敏。
- `home.html`、`detail.html`、`category_real-drama.html`、`rank_hot-drama.html`、`search_*.html` 与相应 `*-merged.json`：页面和合并后的路由数据；静态 JS 文件保留了当次抓取版本。

## 已验证的数据来源

| 能力 | 来源 | 已观察的数据 |
| --- | --- | --- |
| 首页内容 | `GET /` | `_ROUTER_DATA.loaderData.page.homeSections`，all/human/comic/ai 共四组，各 9 部；这是官网首页内容，不声称是个性化推荐 |
| 分类与筛选项 | `GET /category/real-drama` | `category_$.selectorList`、`recommendList`、`pagination`；第 1 页 24 部，total=800 |
| 分类分页 | `GET /category/real-drama?page=2` | 第 2 页 24 部，pageNum=2、pageSize=24、totalPages=34 |
| 榜单 | `GET /rank/hot-drama` | `rank_hot-drama/page.content.rankList`，第 1 页 20 部；pagination 提供第 2 页 URL，totalPages=5 |
| 搜索 | `GET /search/{URL编码关键词}` | `search_(keyword)/page.searchList`，含视频数据与 series_id；“军需处长”当次返回 10 项，totalCount 为字符串 `197`。没有据此声称取得全部 197 项 |
| 详情与完整集数 | `GET /detail?series_id={series_id}` | `detail_page.seriesDetail` 包括名称、简介、封面、标签、演员、`series_episode_info` 和完整 `vid_list`；三个样本分别有 46/86/193 个 ID |
| 播放页 | `GET /player/{series_id}` 或 `GET /player/{series_id}/{item_id}` | 前三集包含 `publicVideoSeo.available=true`、当前 vid 等；中后段抽样页面返回 404 |
| 公开媒体 | `GET /video/public/{item_id}/360p.mp4`，请求 `Range: bytes=0-127` | 成功响应为 HTTP 206、`video/mp4`，包含正确的 Content-Range 与 MP4 `ftyp` 头。这里只验证字节可取得，未把 Range 读取当作完整播放验收 |
| 受保护媒体信息 | `POST /api/video/protected/play-info`，JSON `{ "series_id": "…", "item_id": "…", "definition": "720p" }` | 成功结构为 `play_info` 与 `base_resp`；失败可仍为 HTTP 200 且含 `error: protected_playback_unavailable` |

分类其他内容入口由首页明确链接为 `/category/comic-drama`、`/category/ai-drama`、`/category/comic`；其他榜单入口为 `/rank/hot-real-drama`、`/rank/hot-ai-drama`、`/rank/hot-comic-drama`。这几条在本轮未逐条做内容与分页验收。

### SSR 数据解析注意事项

先定位 `_ROUTER_DATA = ` 后的 JSON，用 JSON decoder 读取单个值；不要贪婪匹配整个 script。不同页面的路由键不同，不应全部固定成 `page`。

榜单的 `content` 起初是 `{}`，实际数据位于 HTML 流尾的 `<script data-fn-name="r" data-fn-args='…'>` 属性。属性先做 HTML 实体解码，再解析 JSON，按 `[route,key,value]` 合并。详情推荐内容则可能由 `data-fn-name="mergeLoaderData"` 搭配 `routerDataFnName="p"` 提供。可直接复用 `probe_website.py` 中不执行网页 JavaScript 的 `router_data()`。

`homeSections.video_list` 里的标题字段为 `series_title`，详情/分类字段为 `series_name`；搜索结果包装在每项 `video_data` 中；榜单使用 `seriesId/title/cover`。所有 ID 均应按字符串保存。

## 首、中、末集实际结果

下表“公开媒体”指 360p URL 的 Range 请求；“保护接口”只表示返回结构，不代表可播放。

| 剧名 / series_id | 位置 / item_id | 播放页 | 公开媒体 | 保护接口 JSON |
| --- | --- | --- | --- | --- |
| 军需处长的账本 / 7690961604636052505 | 第 1 集 / 7690963410778868761 | 200 | 206，6,971,183 字节 | play_info，含加密字段 |
| 同上 | 第 2 集 / 7690963562042248217 | 200 | 206，12,088,797 字节 | play_info，含加密字段 |
| 同上 | 第 3 集 / 7690963468219845657 | 200 | 206，8,503,706 字节 | play_info，含加密字段 |
| 同上 | 第 24 集 / 7690963491330477081 | 404 | 404 | play_info，含加密字段 |
| 同上 | 第 46 集 / 7690963495944211481 | 404 | 206，12,505,770 字节 | play_info，含加密字段 |
| 王妈在顾家当保姆后全家只会搞笑了 / 7694653385668037657 | 第 1、2、3 集 | 均 200 | 均 206 | 均 play_info，含加密字段 |
| 同上 | 第 44 集 / 7694655347952208921 | 404 | 404 | error: protected_playback_unavailable |
| 同上 | 第 86 集 / 7694655429351066649 | 404 | 404 | error: protected_playback_unavailable |
| 觉醒伪神：神明弃我我自为神7 / 7697852455970671678 | 第 1、2、3 集 | 均 200 | 均 206 | 均 play_info，含加密字段 |
| 同上 | 第 97 集 / 7697855273368554521 | 404 | 404 | error: protected_playback_unavailable |
| 同上 | 第 193 集 / 7697855384366631961 | 404 | 404 | error: protected_playback_unavailable |

三部详情都返回 `accessible_episode_cnt=3`，官网 UI 会对超过此范围的选集引导打开 App。但《军需处长》第 46 集公开 URL 的例外说明，不能仅凭这个字段断言每集 HTTP 可用性；也不能反过来因为这一例外就宣称全剧开放。只抽测 15 个位置，未枚举三部剧所有媒体 URL。

## 保护播放和未解决事项

`play_info.format=dash`，视频和音频各有独立 `main_url/backup_url`、初始化范围、索引范围；视频还包含 `kid`、`player_access_key`、时效及宽高/码率等。请求 definition=720p 后，真人剧样本报告视频 720×1280，动漫样本报告 1254×720。

对《军需处长》首集受保护媒体各读取 4096 字节，视频发现 `encv`(477)、`sinf`(675)、`cenc`(703)、`tenc`(723)，音频发现 `enca`(473)、`sinf`(548)、`cenc`(576)、`tenc`(596)。这些是加密 MP4 初始化数据的证据。`kid` 是密钥标识；返回的 `player_access_key` 是否或如何参与授权/内容密钥获取没有验证，不能把字段名称等同于可用内容解密密钥。本轮没有确认任何可用解密/许可证流程，没有尝试处理明文密钥，也没有完成受保护视频解码。

因此官网研究尚未通过“完整剧集稳定播放”的门槛。需由 APK 接口与实际播放证据补足，且最终需跨多部剧验证首、中、末集真实解码和连续播放。当前证据只支撑可用目录浏览和部分公开 360p 媒体，不支撑完整第三方观剧客户端已经接通的结论。

## 静态 JavaScript 定位

- `detail_page.0c621388aa.js`：详情选集、`accessible_episode_cnt`、超出范围的 App 引导。
- `t.78fb905b21.js`：受保护播放信息 POST、播放控制与连续下一集判定。
- `gp.61af8c11da.js`：分类请求及 `/incent_resource/suggestion`、`/incent_resource/selector` 等公共网页请求定义。
- `q.78e32a6456.js`：敏感播放字段和受保护 URL 的处理逻辑。

静态 JS 还显示 `GET /api/category/page` 可带 `content_type/page_num/gender/sort_type/min_first_visible_time/tab/category_json_ids/categories_v2`；搜索联想为 `GET /incent_resource/suggestion?app_id=8662&query={keyword}&count=10`。接口独立请求的附加观察保存在 `supplemental-observations.json`；是否可用应以其中的实际返回为准，不仅凭 JS 中出现路径。

附加实测：上述 `/api/category/page` 查询在当前站点返回 404，应使用已验证的分类 SSR 页面分页；搜索联想入口返回 HTTP 200 和 10 项 `suggest_list`。`/search/军需处长?page=2` 返回的 10 个 series_id 与不带 page 查询时完全相同，因此本轮未发现可用的搜索分页参数。

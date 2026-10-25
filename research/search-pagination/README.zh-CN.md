# R02：官网搜索分页后续验证

日期：2026-10-23 UTC。匿名、未提供 Cookie，仅请求官网公开搜索页面、静态资源和正常搜索 JSON 接口。没有运行原版 APK、REA、手机注入或账号登录。

**有效分页已实测并接入；全部匹配结果覆盖仍未证实。** 旧报告中“第二页与首屏相同”是旧版网站的观察，不再代表本轮入口。原清单 R02 更新为部分解决，不关闭 U01–U16、T01–T05 或其他 R 项。

## 本轮发现

`GET /search/军需处长` 返回 HTTP 200，但正文是客户端页面骨架，不含 `_ROUTER_DATA`。原服务端按 SSR 数据解析搜索会失败。新页面通过以下正常接口加载内容：

- `GET /api/search/context`：上下文。此次独立匿名结果请求不需要先保存其上下文或 Cookie。
- `GET /api/search/result?query={关键词}&page={页码}`：结果；首页可省略 page。
- 返回 `searchList / totalCount / pageNum / totalPages / hasMore`。

静态资源 `async/t.d1c39a18e1.js` 的模块 `dH` 构造上述请求，`async/k.024362f390.js` 使用页码、展示分页组件，并将 `doc_type=46` 的演员卡片和 `doc_type=23` 的短剧区分显示。资源 URL、字节数、SHA-256 见 [source-manifest.json](source-manifest.json)。原始网页及 JavaScript 保留在本轮工作区，不将厂商完整代码作为项目代码提交。

这只证明本轮普通匿名请求可以成功。网页还存在验证分支；本次未触发或绕过该分支，不能推断所有环境或登录状态都免验证。

## 实际结果与覆盖边界

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| “军需处长”第 1–20 页 | 20 页最终全部返回有效 JSON；前 19 页各 10 项，末页 4 项且 hasMore=false | [observations.json](observations.json) |
| 总数及去重 | 共 194 条短剧记录，172 个唯一 series_id；各页 totalCount 在 194、195、196、197 之间变化 | 同上 |
| 错误与重试 | 此次遍历共 27 次请求，其中 7 次 HTTP 502；仅对 502/503/504 做最多三次尝试 | 同上及 [probe.py](probe.py) |
| 第二关键词“夜晚的答案” | 抽测 1–3 页，不代表全部遍历 | [second-query.json](second-query.json) |
| 修改后的实际产品适配器 | 独立调用第 1、2、20 页，均成功；末页结束标记保留 | [adapter-live.json](adapter-live.json) |
| 其他目录冒烟检查 | 首页 4 组、真人分类 24 部、样本详情 46 集均成功；不是全站覆盖 | [catalog-smoke.json](catalog-smoke.json) |

`all_reported_pages_returned=true` 仅指拿到了首个响应报告的全部页码，**不表示全部匹配内容已取得**。本轮跨页重复和 totalCount 波动直接说明不能把多个请求拼成一致快照。没有证明缺失/重复究竟来自索引更新、排序波动、请求环境或其他原因；也没有把本次 172 个 ID 当作该关键词的完整集合。

响应 SHA-256 对应原始字节，公开 JSON 只保存请求路径、状态、摘要、计数、公开剧名/ID；未保存上下文、Cookie、验证参数或账号字段。[page2.fixture.json](page2.fixture.json) 是独立成功请求第二页的公开字段投影，用于离线回归，不能视为本轮每次请求都返回相同列表。

## 实现

- 服务端搜索改用官网 JSON 接口，`GET /api/search?q=…&page=…` 支持分页，默认第一页。
- 校验响应页码、totalPages、hasMore、列表和短剧字段；错误/HTML 骨架不会被转换为空的成功结果。
- 缓存与并发请求仍按路径（含页码）和账号范围隔离，保留取消及容量限制。官网非 200 响应仍返回上游错误，由用户重试；研究脚本的重试策略没有悄悄成为产品全局策略。
- 当前 `Page` 契约只包含短剧，跳过已知演员卡片；演员页仍保留官网分页标记，以便继续加载。
- TV 搜索支持加载下一页、按 ID 去重、失败时重试当前页；末页文案为“已到末页”，不承诺取得全部匹配内容。重新搜索继续使用已有 screenVersion 机制忽略旧请求结果。

## 复现

在仓库根目录运行（Python 标准库）：

```sh
python research/search-pagination/probe.py --out /tmp/search-observations.json
python research/search-pagination/probe.py --query 夜晚的答案 --max-pages 3 --out /tmp/search-second.json
npm test --prefix server
```

最多 50 页、同时两个请求、每页最多三次尝试；使用独立输出路径可保留本次证据。页面结果随官网变化，复跑不要求相同剧目/总数。

本轮服务端 51/51 项测试通过；Android assembleDebug/lintDebug 成功（0 errors、25 warnings），APK v2 签名验证通过。最终状态和受测源码摘要记录于 [validation.json](validation.json)。模拟响应测试不等于真实账号、Windows/QSV 或 Chromecast 运行验收；这些仍属于原清单未完成事项。

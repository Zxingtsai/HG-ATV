# 公开分享入口实测

观察时间：2026-10-20 23:58 至 2026-10-21 00:00 UTC。输入为用户从原版 App 复制的 `https://novelquickapp.com/s/BWLSToH09j0/`。仅访问网页、网页明确引用的脚本和网页返回的视频地址，没有再次操作用户手机。

## 结果

链接有效，HTTP 302 后进入 `novelquickapp.com/hongguo/ug/pages/video-animation-share`，最终 HTTP 200。以流式脚本合并后的 `pageData` 为准，返回《夜晚的答案》，series ID 为 `7693806079737613336`，共 31 集。官网同一 series 的详情也返回该名称、31 集及 `accessible_episode_cnt=3`。

页面包含全部 31 个 `chapter_ids`，但目录完整不代表媒体完整。实际返回 `used_chapter_id=7693807842205125657`、`chapter_order=1`、`landingFirstChapterEnabled=true`。

| 请求位置 | 请求的 chapter ID | 实际返回 | 媒体范围 |
| --- | --- | --- | --- |
| 第 1 集 | 7693807842205125657 | 第 1 集 | start=0，end=30 |
| 第 16 集 | 7693807829781580825 | 第 1 集 | start=0，end=30 |
| 第 31 集 | 7693807856054717465 | 第 1 集 | start=0，end=30 |

中、末集做了两组查询：一组只保留页面所需的主要分享参数；另一组保留原短链跳转的全部参数，仅替换 `vid` 和 `share_toast_vid`。两组均回到第 1 集。第二组排除了本次现象仅由省略原分享参数造成的解释；不能据此断言所有分享类型或所有剧均如此。

直接使用页面返回的视频地址，下载到 2,715,891 字节的 MP4；没有删除或改写地址的 start/end、签名或其他授权参数。ffprobe 结果：视频 HEVC、1280×720、30.000 秒；音频 AAC、29.976961 秒；容器时长 30.100 秒。FFmpeg 完整解码到 null，退出码 0，无解码错误。**这是实际解码成功的 30 秒片段，不能计为完整一集或完整全剧播放成功。**

## 证据与限制

- `episode-observations.json`：主要参数查询的首、中、末集结果。
- `original-query-observations.json`：保留原分享参数的中、末集结果；不包含原设备标识或签名视频 URL。
- `media-probe.json`、`decode-observation.json`：下载片段的媒体结构和解码结果。
- `video-animation-share_page.e36a5d18.js`、`9377.006172cd.js`：网页静态脚本。模块 49044 使用 `used_chapter_id` 同步页面中的 vid；启用首集落地时删除 share_toast_vid 等参数。这与实测返回第 1 集的行为一致。
- 文件名包含 `.private.` 的网页、跳转信息、路由数据和样片仅供本地分析；它们可能含分享来源设备标识、临时媒体 URL，不纳入交付包。页面初始 head 和流式加载后的内容可能不同，结论使用合并后的路由数据，不能只依赖 og 标签。

本链接没有提供已验证的完整剧集播放来源，原定首、中、末集完整实际播放门槛仍未通过。Windows 转码服务和 TV 客户端仍未实现。继续反复要求用户分享同类链接，或恢复已故障的注入工具，都没有本轮证据支持。

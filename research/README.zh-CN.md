# 研究资料导航

先阅读报告，再按 Evidence ID、源 APK/DEX 摘要和方法描述查证。静态调用声明、用户实机反馈和本项目运行验证分别记录；静态结果不能替代服务器接受请求或电视实机验收。

| 主题 | 入口 |
| --- | --- |
| 初始 APK 分析与功能边界 | [ANALYSIS.zh-CN.md](ANALYSIS.zh-CN.md) |
| 网页播放协议、完整播放与 ID 调查 | [protocol-pass2/README.zh-CN.md](protocol-pass2/README.zh-CN.md) |
| 2024 旧版与当前官网版总对照 | [version-compare/REPORT.zh-CN.md](version-compare/REPORT.zh-CN.md) |
| 两份完整原版 APK 与下载校验 | [original-apks/README.zh-CN.md](original-apks/README.zh-CN.md) |
| 官网普通下载样本身份与渠道比较 | [current-official/REPORT.zh-CN.md](version-compare/current-official/REPORT.zh-CN.md) |
| 收藏调用、ID 与新旧 DTO | [account-library/README.md](version-compare/account-library/README.md) |
| 账号 SDK 会话读取、保存与退出 | [session-static/REPORT.md](version-compare/account-library/session-static/REPORT.md) |
| legacy 与 SaaS 播放模型 | [playback/REPORT.zh-CN.md](version-compare/playback/REPORT.zh-CN.md) |
| GET 参数、占位符与网络安全边界 | [transport/REPORT.zh-CN.md](version-compare/transport/REPORT.zh-CN.md) |
| 官网匿名登录观察与历史 smoke 脚本 | [account-login/README.zh-CN.md](account-login/README.zh-CN.md) |
| 手机注入故障与停止复现的原因 | [phone-incident/ANALYSIS.zh-CN.md](phone-incident/ANALYSIS.zh-CN.md) |
| REA 未解决事项与验收条件 | [REA-UNRESOLVED.zh-CN.md](REA-UNRESOLVED.zh-CN.md) |

工作区整理的导入范围见[工作区说明](../docs/WORKSPACE.zh-CN.md)，文件摘要见[归档清单](workspace-archive-manifest.json)。子报告保留写作当时的原文，其中“仅本地”“未上传”等陈述描述当时状态。随后按用户要求，将两份完整原版 APK 另行通过 Git LFS 归档，见上表；分析载体、原站脚本、完整新旧对照反编译输出和私有运行数据仍不随仓库提供。报告中引用未公开文件的名称是本地证据定位信息。

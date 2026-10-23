# 红果原版安装包

按用户要求归档两份用于新旧版对照的完整原包，未修改内容、未重签。它们是第三方红果 App，与 HG-ATV 客户端不同；原应用权利归其权利人。两包包名均为 `com.phoenix.read`，原签名验证通过，签名证书 SHA-256 均为 `1fe01f1425c72dc1cd158e05cb696cb9fc17259a70f9d233fc48e8e42e6510ec`。

| 样本 | 来源与长度 | 下载 |
| --- | --- | --- |
| 6.2.3.32 / 62332 | [豌豆荚历史页](https://m.wandoujia.com/apps/8396801/history_v62332)的“普通下载”；71,781,163 字节 | [旧版 APK](https://media.githubusercontent.com/media/Zxingtsai/HG-ATV/refs/tags/original-apk-samples-2026-10-22/research/original-apks/hongguo-6.2.3.32-original.apk) |
| 7.4.1.32 / 74132 | 2026-10-22 [官网](https://hongguoduanju.com/)普通 Android 入口，69310258a 渠道；149,926,819 字节 | [新版 APK](https://media.githubusercontent.com/media/Zxingtsai/HG-ATV/refs/tags/original-apk-samples-2026-10-22/research/original-apks/hongguo-7.4.1.32-official-normal-original.apk) |

[SHA256SUMS.txt](SHA256SUMS.txt) 记录两包完整文件的 SHA-256；原文件只做了便于区分的重命名。新版原包与早期 REA 使用的 71853858a 渠道基线整包 SHA-256 不同，但 25 个 DEX、Manifest 和签名证书一致，详见[身份对照](../version-compare/current-official/REPORT.zh-CN.md)。这里的“新版”指上述观察日期的研究样本，不代表未来官网版本。

文件通过 **Git LFS** 保存，避免超过普通 Git 单文件 100 MiB 限制。仓库网页显示的三行 LFS pointer 不是安装包；请使用上面的完整文件下载链接，下载后核对长度与摘要。普通 Git 克隆需安装 Git LFS 并运行 `git lfs pull`；如只需源码，可使用 `GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/Zxingtsai/HG-ATV.git` 跳过约 222 MB 原包下载。GitHub 自动生成的源码 ZIP 是否包含 LFS 对象取决于仓库设置。

本次只归档这两份完整原包。未签名的 REA 分析载体、原始 DEX、账号数据、手机日志和媒体缓存仍不随本目录提供。

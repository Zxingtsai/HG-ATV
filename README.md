# HG-ATV · 红果 TV

面向 Android TV 14 / Chromecast with Google TV 4K 的非官方原生客户端，配合家庭局域网 Windows 服务端单路转码。客户端约 6 MB，使用 Kotlin、RecyclerView 和 Media3。

## 下载与安装

**[v0.1.0 测试版下载](https://github.com/Zxingtsai/HG-ATV/releases/tag/v0.1.0)**

新增 [服务端 0.1.1 账号登录预览说明](docs/ACCOUNT.zh-CN.md)：在服务器本机生成官网二维码，用红果 App 扫码确认。使用已保存的会话前会向官网验证；App 原生接口和云收藏仍待接入。现有电视 APK 可继续使用。

[下载账号预览更新包](https://github.com/Zxingtsai/HG-ATV/raw/refs/tags/v0.1.1-account-preview/releases/account-preview/hongguo-tv-account-preview-0.1.1.zip) · [SHA-256](https://github.com/Zxingtsai/HG-ATV/raw/refs/tags/v0.1.1-account-preview/releases/account-preview/hongguo-tv-account-preview-0.1.1.zip.sha256)

- [Android TV APK](https://github.com/Zxingtsai/HG-ATV/raw/refs/tags/v0.1.0/releases/v0.1.0/hongguo-tv-0.1.0.apk)
- [Windows 服务包](https://github.com/Zxingtsai/HG-ATV/raw/refs/tags/v0.1.0/releases/v0.1.0/hongguo-tv-windows-0.1.0.zip)
- [文件 SHA-256](https://github.com/Zxingtsai/HG-ATV/raw/refs/tags/v0.1.0/releases/v0.1.0/SHA256SUMS.txt)

Windows 解压后依次运行 `windows/setup.cmd`、`windows/start.cmd`。首次安装需要联网下载并校验 Node.js、FFmpeg 和官网播放器组件。将 APK 安装到电视，选择发现的服务器或输入其局域网地址，再填写服务器窗口显示的六位配对码。

默认 **720p、auto 编码器、单路 H264/AAC 转码**；QSV 探测失败时回退 CPU。需要 1080p 时先运行 `windows/benchmark.cmd`，达到本机 1.3 倍实时测速门槛后才会生效。竖屏内容完整显示，左右保留黑边。

## 功能

首页、分类与分页、榜单、搜索、完整选集、自动下一集、暂停和快进快退、本机收藏、历史记录与逐集续播。支持遥控器操作、局域网发现、手动连接和配对；退出播放或切到后台会释放服务端会话。

## 当前验证范围

- 服务端 33 项自动检查通过；真实官网来源经过完整处理、55 个 HLS 分片的整集严格解码及缓存跳转验证。
- 0.1.1 服务端账号预览：47 项服务端检查通过；已实测官网二维码生成、页面显示与取消清理，真实账号确认和 Windows 浏览器联调尚待验收。
- 客户端构建成功，lint 为 0 错误、22 警告，APK v2 签名验证通过。
- **Windows Server 与 Chromecast 实机尚未验收。** Android TV 14 软件模拟器未完成系统启动，尚未取得客户端设备运行或遥控器联调结果。
- 官网部分剧集会返回不可播放；本版不能保证全片库随时可用。首次播放需等待整集准备，尚未实现边下载边播放。

当前版本仅用于可信家庭局域网。运行无需原版 App、账号、root 或手机注入；不提供账号奖励、评论或离线下载功能。

## 文档与开发

- [项目详细说明](README.zh-CN.md)
- [Windows 安装、停止、测速与可选配置](windows/README.zh-CN.md)
- [客户端构建与电视操作](client/README.md)
- [验证记录](docs/VALIDATION.zh-CN.md) · [LAN API](docs/API.md)
- [服务端扫码登录与更新](docs/ACCOUNT.zh-CN.md)
- [原 APK 的 REA 分析](research/ANALYSIS.zh-CN.md) · [完整播放协议验证](research/protocol-pass2/README.zh-CN.md)
- [2024 旧版与当前官网版通信机制对照](research/version-compare/REPORT.zh-CN.md)：登录会话、收藏同步、播放模型及 RPC 参数；原生 App 协议接入仍待运行时验证。
- [REA 分析未解决事项清单](research/REA-UNRESOLVED.zh-CN.md)：协议未知项、工具失败/回退、待实测项目及关闭判据。
- [外部组件与许可](docs/DEPENDENCIES.md)

服务端需要 Node.js 24 和 FFmpeg，无 npm 第三方运行依赖：

```sh
npm test --prefix server
node --use-env-proxy server/scripts/prepare-player.mjs
node --use-env-proxy server/src/main.mjs
```

Android 构建需要完整 JDK 17+、Android SDK 35；在 `client` 目录运行 `./gradlew :app:assembleDebug :app:lintDebug`，Windows 使用 `gradlew.bat`。

原创代码采用 [MIT](LICENSE)；外部运行库、AndroidX 及另行下载的官网播放器保留各自权利和许可。仓库中的分析文档与测试夹具用于记录分析与验证范围，原版 APK、媒体缓存及访问凭据不随项目提供。

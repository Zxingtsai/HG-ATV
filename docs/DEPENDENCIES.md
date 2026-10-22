# 外部组件

本项目是非官方家庭局域网客户端，不隶属于红果。项目原创代码见根目录 LICENSE。

| 组件 | 用途与来源 | 分发方式 |
| --- | --- | --- |
| AndroidX RecyclerView 1.4.0、Media3 1.5.1 | 原生界面、HLS 解码，Google Maven，Apache-2.0 | APK 编译依赖 |
| Kotlin 2.1.10 | 客户端语言运行库，Apache-2.0 | APK 编译依赖 |
| Node.js 24.19.0 | Windows 服务运行库，nodejs.org，MIT 及附属依赖许可 | setup 下载，保留原包许可与哈希清单 |
| FFmpeg essentials | H264/AAC 转码，Gyan 官方 Windows 构建，GPLv3 | setup 下载，保留原包许可、版本及哈希清单；源码入口 https://www.gyan.dev/ffmpeg/builds/ |
| 官网公开播放器 worker | 按官网正常软件播放协议处理官网返回的媒体 | 不在交付包中分发；setup 从官网 CDN 下载固定版本，验证 bundle 和 worker 的 SHA-256；权利归原作者 |

公开播放器来源及哈希常量见 server/scripts/prepare-player.mjs。版本发生变化时校验会拒绝继续，需更新适配；不能关闭校验。播放器的访问参数只在内存及匿名进程管道中传递，不写入日志。安装包不包含原版 App、视频文件、用户令牌或播放器密钥。

Android 构建及 Windows 运行库的原始许可证需随构建保留。本项目没有为外部播放器另行授予许可。

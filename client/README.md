# 红果 TV Android 客户端

原生 Kotlin + Android View / RecyclerView，Android TV 8.0+（minSdk 26，compile/target 35），适配 Chromecast with Google TV 4K / Android TV 14。采用 Media3 ExoPlayer HLS；没有 WebView、Compose、登录、下载或奖励模块。

## 构建

需要 JDK 17+、Android SDK 35、Gradle 8.11.1。工作区已有工具时运行：

```sh
./build-local.sh :app:assembleDebug :app:lintDebug
```

产物为 `app/build/outputs/apk/debug/app-debug.apk`。`build-local.sh` 继承环境代理与 CA 配置，不关闭 HTTPS 验证。常规开发机可用随源码提供的 `./gradlew`（Windows 为 `gradlew.bat`）执行同名任务，并通过 `ANDROID_SDK_ROOT` 或 `local.properties` 配置 SDK。

## 电视操作

启动后选择自动发现的电脑，或手动填写 `http://电脑IP:8751`，输入电脑服务显示的六位配对码。UDP 8752 被路由器阻止时，手动地址仍可配对。地址及访问令牌只保存在本机私有 SharedPreferences；配对码不保存。

- 方向键移动，橙色边框表示焦点，确认打开卡片或按钮。
- 首页、四分类、榜单、搜索、收藏与历史均可通过顶部导航访问。
- 详情支持完整选集、简介、收藏及按本机进度续播。
- 播放时按确认暂停/继续；方向键唤出底部控制。进度条左右键每次移动 10 秒，长按加速到 30 秒；松开后提交跳转。支持上下集、选集和自动下一集。
- 返回从播放回到详情，再按页面层级返回。退出或切到后台会保存进度并释放电脑播放会话；回来后主动选择继续观看。
- 竖屏短剧以原始比例完整显示，使用黑边保留全部画面。

## 服务契约

直接实现 `../docs/API.md`：页面内容来自真实家庭服务，不包含固定剧名或样片。播放准备阶段每 700 ms 查询，只有 `ready` 才交给 Media3。统一 `DefaultHttpDataSource.Factory` 为 HLS 清单及所有分片附带同一 Bearer。首次 `STATE_READY` 只执行一次 `seekTo(0)`，避免 EVENT HLS 默认从增长中的尾端起播。长距离跳转通过新 POST playback，界面使用服务端 `positionBaseSeconds + currentPosition` 显示完整剧集时间。前台每 15 秒心跳，后台和退出 DELETE 会话。

收藏、逐集进度和最近观看保存在电视本机；不会传送账号信息。连接失败、内容服务错误、准备超时和播放中断均提供重试与返回。

## 验证边界

2026-10-21 已实际通过：

- `:app:assembleDebug`：完整 Kotlin/资源/DEX 编译及 APK 打包成功。
- `:app:lintDebug`：0 errors，22 warnings；警告涉及中文单语言文案、固定 TV 横屏、矢量 banner 尺寸、可升级依赖、一次列表整体刷新与旧版备份兼容提示（已设置 `allowBackup=false`）。没有关闭 lint 错误检查。
- `apksigner verify --verbose`：APK Signature Scheme v2 校验通过，满足 minSdk 26。
- `aapt dump badging`：确认 minSdk 26、target/compile 35、Leanback 启动入口、横屏、触屏/WiFi 均非必需。
- 实际从 APK 解包确认 `assets/THIRD_PARTY_NOTICES.txt` 已包含 AndroidX、Kotlin、Coroutines 等项目归属、上游 Apache-2.0 许可及 NOTICE。

最终 debug APK 为 `app/build/outputs/apk/debug/app-debug.apk`，约 6.0 MB；SHA-256：

```text
3215f10465a0b712c10ccf8aae80a9687c9870b784390a0a9602a19698365cb4
```

Android TV 14 官方 x86 软件模拟器已尝试启动，但环境没有 `/dev/kvm`，模拟器在系统 ART 初始化期间一直处于 ADB offline，尚未安装或运行本 App，因此没有取得 Android TV 14 运行、DPAD 联调或客户端播放验证结果。Chromecast with Google TV 4K 实机同样尚未验证；遥控器焦点与返回层级、硬件解码、真实局域网发现、续播及后台会话释放仍须在真实设备上完成最终验收。服务端独立测试不等同于客户端设备验证。

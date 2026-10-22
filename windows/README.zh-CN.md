# Windows Server 2025 家庭服务安装

面向 x64 Windows Server 2025、Xeon E3-1275 v3／16GB、Chromecast with Google TV 4K（Android TV 14）。后端只需本地 Node.js 和 FFmpeg，不需额外安装 .NET、浏览器或 Python。安装不需要管理员，不修改系统 PATH、系统执行策略或路由器设置。仅支持家庭局域网使用。

## 首次安装和播放

已有 0.1.0 安装可选用 [服务端 0.1.1 账号预览更新](../docs/ACCOUNT.zh-CN.md)。更新后双击 `account-login.cmd` 在服务器本机打开扫码登录页；不需要更换电视 APK。

1. 将整个安装包解压到一个固定目录，例如 `D:\家庭应用\红果TV`。不要只复制 `windows` 文件夹。
2. 双击 `windows\setup.cmd`。脚本首次从官方来源下载运行库，核验 SHA-256，再准备官网公开播放器组件。需要 HTTPS 联网。失败可重跑；已安装且校验一致的运行库会复用。
3. 双击 `windows\start.cmd`，保持窗口打开。窗口会显示服务地址、配对码和日志。服务默认监听 TCP 8751，局域网发现使用 UDP 8752。
4. 将 `client\dist\hongguo-tv.apk` 安装到电视，在电视 App 中查找服务并输入窗口显示的六位配对码。发现失败时，手动填写 Windows 主机的局域网 IPv4 地址及 `8751` 端口。
5. 停止时双击 `windows\stop.cmd`。不要用结束全部 `node.exe`／`ffmpeg.exe` 的方式停止。

首次看到 Windows 防火墙提示时，只允许家庭的 **专用网络（Private）**。主安装程序不会自动修改防火墙。若电视无法连接，可使用下文的可选脚本。请勿把本服务做端口映射、开放到公网，或与不受信任的网络共享配对码。

默认单路播放、720p、H.264/AAC HLS；新电视开始播放时会按服务的单路占用规则处理。`auto` 编码模式由后端实际探测 Intel QSV，可用时使用，否则回退 CPU。E3-1275 v3 的核显是否可用取决于主板、BIOS、Windows 驱动及会话环境，不能仅凭 CPU 型号确认。当前交付环境没有 Windows 主机，**未在目标 Windows/核显上实测性能**；1080p 或 QSV 的结论以本机探测、真实视频基准和播放为准。

## PowerShell 参数

在安装包根目录打开 PowerShell。以下命令只为当前脚本进程使用执行策略，不改系统设置：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows\setup.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows\start.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows\stop.ps1"
```

可指定运行库、数据目录及服务端口，路径可包含空格与中文，绝对路径或相对安装包根目录的路径均可：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows\setup.ps1" -RuntimeDirectory "D:\家庭应用\红果运行库" -DataDirectory "D:\家庭应用\红果数据" -Port 8751 -Encoder auto -Profile 720p
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows\start.ps1" -Encoder libx264 -Profile 720p
```

配置保存到 `windows\local.settings.json`，默认运行库在安装包的 `runtime`，数据在 `data`。重跑 setup 时需再次指定需要保留的自选参数。已有服务运行时请先停止。移动安装包或改变目录后，重新运行 setup；如启用过登录任务／防火墙规则，也需重建它们。不要在同一个数据目录启动多个副本。更换端口时同步更新电视手动地址和可选防火墙规则。

可选编码器：`auto`、`libx264`、`h264_qsv`；可选画质：`720p`、`1080p`。默认 `auto`／`720p`，切勿把选择 `1080p` 理解为已经通过实时性能验证。先停止服务，再双击 `windows\benchmark.cmd` 并输入本机真实视频路径，或使用：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows\benchmark.ps1" -VideoPath "D:\视频\本机真实视频.mp4"
```

测速从配置读取运行库和数据目录，实际执行后端 `--benchmark`，用真实短段测试本机转码能力；只有结果支持后再考虑 1080p。测速期间不会同时启动本服务，结果以该视频、该驱动和当时机器负载为限。后端会记录本机硬件和编码器的测速结果；选择1080p时，仅接受30天内达到≥1.3倍实时的匹配记录，否则自动使用720p。请用不少于20秒、复杂度接近实际观看内容的本地视频。

启动脚本向后端传递：`HONGGUO_DATA_DIR`、`HONGGUO_FFMPEG`、`HONGGUO_PORT`、`HONGGUO_BIND=0.0.0.0`、`HONGGUO_ENCODER`、`HONGGUO_PROFILE`。通过绝对可执行路径调用运行库，不依赖系统 PATH。Node 固定使用 `--use-env-proxy`，保留用户已有代理环境变量；不关闭 TLS 证书校验。

## 可选：仅当前用户登录后自动启动

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows\install-logon-task.ps1"
```

这是当前用户的普通权限登录任务，需要用户登录后运行，不是开机前系统服务，不保存密码。安装任务不会立即另开一个服务；下次登录生效。任务隐藏窗口，配对码在数据目录最新的 `server-*.log`。如需临时在控制台查看，先停止已有任务／服务，再运行 `start.cmd`。移除任务：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows\install-logon-task.ps1" -Remove
```

在 Server 的账户安全策略禁止普通用户注册计划任务时，该可选步骤会报错；仍可直接运行 `start.cmd`。

## 可选：专用家庭网络防火墙

仅此步骤需要用户手动打开**管理员 PowerShell**，进入安装包根目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows\allow-private-firewall.ps1"
```

仅为本目录实际 Node 可执行文件放行：TCP 配置端口与 UDP 8752；限定 `Private` 网络、远端 `LocalSubnet`。不会把 Public／Domain 网络或任意远端放行，不改变网络分类。确认 Windows 网卡当前确实属于可信家庭 Private 网络；不修改公司或未知网络配置。可加 `-Remove` 移除这两条规则。脚本不会自动申请提权。

## 来源、校验及许可证

安装包本身不捆绑 Node／FFmpeg 二进制。首次 setup 下载到选定运行库目录，所有下载先核验后解压／执行。成功后 `runtime\downloads.manifest.json`（自选目录同理）记录实际来源、版本、ZIP SHA-256、可执行文件 SHA-256；保留上游随包附带的许可证与说明。对本地已安装程序的重跑检查使用该 manifest；希望重新获取官方校验信息时，在停止服务后选一个新的空运行库目录运行 setup。

| 组件 | 下载来源 | 校验来源 | 许可证 |
| --- | --- | --- | --- |
| Node.js 24.19.0 x64 | `https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip` | 同目录 `SHASUMS256.txt` 中精确匹配 ZIP 文件名 | Node.js MIT 及其内含第三方许可证，见 `node-v24.19.0-win-x64\LICENSE` |
| FFmpeg release essentials x64 | `https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip` | 同 URL 后缀 `.sha256`；版本后缀 `.ver` | Gyan 标明 GPLv3；保留 `ffmpeg\LICENSE`、`README.txt` 和随包说明 |
| 官网公开播放 worker | `server/scripts/prepare-player.mjs` 中指定的官网公开来源 | 后端固定 SHA-256 | 按上游适用条款，安装时直接取得，不随本包分发 |

2026-10-21 在开发环境实际只读核对：Gyan `.ver` 返回 `9.0.2`，`.sha256` 返回 `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`。Gyan release URL 是滚动发行地址，安装时读取当前官方版本和校验值并记录；不会凭这段文档硬编码未来版本。若发布切换造成校验不一致，安装会停止，稍后重跑。SHA-256 通过 HTTPS 从同一发行方取得，用于完整性验证，未额外执行发行签名校验。

本项目使用 Gyan 提供的 Windows 构建；FFmpeg 项目官网是 `https://ffmpeg.org/`，Windows 构建说明及对应源码链接见 `https://www.gyan.dev/ffmpeg/builds/` 和安装后的 README。当前打包脚本不再分发下载的二进制；若另行捆绑分发，请自行履行 Node／FFmpeg 及其他组件适用的许可证和源码提供义务。

## 日志、安全停止和卸载

`data\server-*.log` 是标准输出，`server-*.error.log` 是错误输出。配对码、客户端令牌与播放缓存属于本地数据，请勿对外发送整个数据目录。setup 不要求输入账号、内容密钥或凭证，不集成测试样片作为线上内容。

stop 只读取本项目 PID 文件，并核对 Node 完整路径、主程序路径、命令行和创建时间；只处理经过路径及创建时间核验的本服务 FFmpeg 子进程。PID 记录不符时会拒绝操作，不误杀其他 Node／FFmpeg。若机器断电后仅留下失效记录，重新启动会清除不存在的旧 PID。关闭启动窗口可能留下后台进程，使用 stop 处理；不要仅删 PID 文件。

卸载顺序：停止服务，移除可选登录任务与防火墙规则，再删除安装目录和自选的运行库／数据目录。数据删除会丢失本机配对信息及缓存。

## 制作交付 ZIP（开发者）

先构建真实 Android TV APK，再执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows\package.ps1" -ApkPath ".\client\dist\hongguo-tv.apk" -Version 0.1.0
```

输出 `dist\hongguo-tv-0.1.0.zip`、外部 `.sha256`，内部 `SHA256.json`。收集后端源码、Windows 脚本、文档和指定 APK；不收集用户数据、运行库、`local.settings.json` 或账号文件。相同目标文件已存在时拒绝覆盖。`-OutputDirectory` 可调整输出目录。

PowerShell 脚本使用 UTF-8 BOM，兼容 Windows PowerShell 5.1 的中文读取；CMD 启动器设置当前窗口 UTF-8。已在开发 Linux 环境用 PowerShell 解析器做语法检查；Windows 网络下载、计划任务、防火墙、QSV 和实际电视播放均需在目标机器验证，未冒充通过。

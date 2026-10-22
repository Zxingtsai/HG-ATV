# 一加 13T 实机注入故障记录

输入：用户提供的 `output.zip`，日志编号 `20261021-073811`。用户随后确认，强行停止红果并重新打开后已恢复正常。此报告不要求在手机上重现故障。

## 结论与处置

v4 在该设备上已证实不可用：原生代理载入，但 Java bridge 初始化时出现空指针访问错误，播放观察点没有安装，用户观察到红果卡死。本次没有取得播放请求或响应，不能作为完整播放接入证据。

已禁用 Shell 与 Python 注入入口，撤回既有采集下载链接的可执行内容；原始发布包以 SHA-256 标识封存于 `research/retired/`。当前下载链接仅提供停用说明和立即退出的脚本。下一步研究原版公开分享入口，不继续让用户复现 Frida 故障。

## 已观察到的事实

| 证据 | 结果 |
| --- | --- |
| 设备 | OnePlus PKX110 / Android 15 / KernelSU，内核 6.6.30 |
| root 辅助进程 | UID 0、`u:r:ksu:s0`，有效能力位包含 CAP_SYS_PTRACE；NoNewPrivs=0、Seccomp=0。后两项只描述辅助进程，不能代表目标 App |
| SELinux | 采集前读取为 Enforcing，没有策略前后快照 |
| 原生代理 | 有 `agent_loaded`，`javaBridgePresent=true` |
| Java bridge | `Error: access violation accessing 0x0` |
| 播放观察点 | `playback_hook_ready=false` |
| 播放响应 | `video_responses_observed=0` |
| 采集窗口 | `capture_started=false` |
| 注入工具退出码 | 0；这不表示 Java 脚本成功，运行时错误通过单独消息报告 |
| 导出的 jsonl | 只有一条 agent_loaded 控制记录，没有观剧数据 |

错误栈落在编译后代理的 Java bridge 初始化路径，涉及首次解析 `android.app.ActivityThread` 及 JVMTI 初始化附近的原生调用。错误发生在业务 Hook 安装前，不能据此归因为本项目的播放响应观察回调，也不能证明具体是哪一项 ROM、ART、KernelSU 或 App 运行时差异造成故障。

## SELinux 相关说明更正

原始日志包含：

```text
Unable to save SELinux policy to the kernel: Out of memory
```

这表明工具执行过程中发生了内核 SELinux 策略保存尝试并失败。此前“不修改安全配置”的保证只检查了项目脚本，未覆盖 Frida 自身行为，因此撤回该保证。错误不能证明策略保存成功，也不能证明整个过程完全没有改变策略；本次没有足够数据判断前后差异。

`Out of memory` 对应的是该策略保存操作，不能仅凭这一行判断手机物理内存不足。没有要求用户关闭 SELinux、调整内核或继续修改 root 配置。

## 项目内修正

- 禁用全部已发布的手机注入入口；保留原始构建供离线审计。
- 控制器离线逻辑改为遇到原生脚本错误或 SELinux 策略保存错误即失败，不再等满就绪超时。
- 元数据记录与播放响应分开计数：只有 agent_loaded 的导出返回“未捕获播放响应”，不再被当作成功的播放采集。
- 补回归检查：该空指针错误、策略保存错误、停用入口不调用 su、仅有 agent_loaded 的实际输出场景。

原版 App 已恢复；完整播放来源仍未验证，Windows 服务端与 TV 客户端仍未实现。后续输入优先为正常“分享→复制链接”得到的内容链接，而非新的注入日志。

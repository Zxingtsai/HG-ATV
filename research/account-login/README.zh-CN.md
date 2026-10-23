# 官网匿名账号观察材料

产品功能与完成范围见[账号预览说明](../../docs/ACCOUNT.zh-CN.md)。这里保留研究辅助源码与匿名观察元数据，不包含登录凭据、有效二维码或真实账号确认成功的证据。

- `official-anonymous-observation.json`：请求域名、路径、参数**名称**、响应字段名称、匿名错误码，以及公开脚本 URL/SHA-256。字段名出现 `session_key` 不表示保留了它的值。
- `observe-official.py`：历史官网页面观察脚本，需要 Python Playwright、Chromium 和代理配置；运行会把官网脚本与页面图片写到本目录，这些输出保持本地。
- `smoke-api.mjs`、`smoke-ui.py`：当时的真实匿名二维码生成、显示及取消检查脚本，包含云端绝对路径和浏览器参数，需先按环境调整。不会替用户确认登录。

已筛选的运行结果位于 [API 记录](../../docs/verification/account-anonymous-api.json)和 [UI 记录](../../docs/verification/account-anonymous-ui.json)，避免重复归档。历史脚本使用容器浏览器参数，不是 Windows 的安装配置；脚本依赖和本地证据限制见[工作区说明](../../docs/WORKSPACE.zh-CN.md)。

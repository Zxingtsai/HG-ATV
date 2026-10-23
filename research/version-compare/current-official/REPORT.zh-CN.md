# 2026-10-22 官网普通 Android 下载身份核对

结论：本次实际观察的 `https://hongguoduanju.com/` 无搜索推广参数的普通 Android 入口，仍提供 **红果 7.4.1.32，versionCode 74132，包名 `com.phoenix.read`**。不是仅检查旧 APK 直链还可下载。

当前普通入口得到的 APK 与已有研究 APK 的整包 SHA-256 不同，但 **25 个 DEX 的逐成员 SHA-256 全部相同、AndroidManifest.xml SHA-256 相同、签名证书相同**。因此现有 `research/hongguo.apk` 仍是今日普通官网入口的同代码基线，可以继续用于现有研究，不必为了渠道包装变化切换目标。

## 真实来源链

1. 在 2026-10-22 UTC 重新 GET 指定官网首页，分别保存普通和 Android UA 的 HTML 与响应来源。首页仍载入 `main.9548ff80fd.js`，当前 runtime chunk map 映射出 `t.d1c39a18e1.js` 和 `page.18198431be.js`；这些 JS 均重新从首页所列官方静态源下载，记录 URL、SHA-256、抓取时间。
2. 当前首页 `page` 的初始化代码调用 `xW` 模块 `T6.Bookmall` 的生成方法；`xW` 默认 `Link` 是 `https://novel8662.ugurl.cn/NF2rW`。当前 `DR` 模块在没有 `enterFrom` 时返回默认状态、不选择 SEM 覆盖。具体代码片段和字节偏移保存在 `selection-evidence.json`。
3. 另用独立云端 Chromium／Playwright，Android 14 UA，实际加载无查询参数官网首页。当前网站自己的控制台输出 `[link] => https://novel8662.ugurl.cn/NF2rW?scheme=...`，包含 `ug_attr_lxft=69310258a`，见 `browser-observation.json`。没有使用用户浏览器、账号或手机，也未修改网站 JS。
4. 对浏览器生成的**完整链接**实际执行 GET，只记录跳转而不重复下载包体。真实链见 `selected-download-redirect.json`：

   `https://novel8662.ugurl.cn/NF2rW?scheme=...` **302** → `https://ugapk.com/N6TMQ?...` **302** → 当前 APK **200**。

   `https://lf9-apk.ugapk.cn/package/apk/novelread/12267_74132/novelread_69310258a_v12267_74132_80fa_1792452936.apk?v=1792452938`

5. HEAD 对完整短链返回 404（保存在 `selected-download-head.json`），因此没有把 HEAD 当作链接失效结论；正常 GET 给出上面的成功跳转。最终 APK 的独立 HEAD 返回内容长度 149,926,819。完整下载当前普通入口 APK 后计算 SHA-256，并使用 Android SDK `aapt dump badging` 与 `apksigner verify --print-certs` 检查身份，均退出码 0。

## 两包对照

| 项目 | 现有研究 APK（71853858a） | 今日普通入口 APK（69310258a） |
| --- | --- | --- |
| 路径 | `research/hongguo.apk` | 本目录 `hongguo-current-normal.apk` |
| 文件长度 | 149,926,819 | 149,926,819 |
| 整包 SHA-256 | `77f23369c02f8a2d7a66f1fbe960dcd7bc402e529f69a4b21bf047c59fea6d93` | `1f8f733377523ab7a5ea2a602e6e9e9834badf422727e07492d4118c6c0a69e1` |
| 包名 | `com.phoenix.read` | `com.phoenix.read` |
| versionName / versionCode | 7.4.1.32 / 74132 | 7.4.1.32 / 74132 |
| AndroidManifest.xml SHA-256 | `f9f43da3d8d110694f1be9c37afa39356655e5f1476cc077da3bb5ddfef94209` | 相同 |
| 25 个 DEX SHA-256 | 每个均与当前包相同 | 25/25 相同 |
| 签名证书 SHA-256 | `1fe01f1425c72dc1cd158e05cb696cb9fc17259a70f9d233fc48e8e42e6510ec` | 相同 |
| 证书主体 | `CN=novel,OU=fq,O=fq,L=sz,ST=gd,C=86` | 相同 |

附加检查：两个 ZIP 的所有成员名称、成员大小及 CRC 均一致（不是所有成员都额外计算了 SHA-256；DEX 和 manifest 做了逐内容 SHA-256）。`META-INF/BYTESIGN.RSA` 两包也逐内容 SHA-256 相同，并用 cryptography 读取出相同证书。这里将整包差异称为渠道包装差异，不声称已定位每个差异字节的具体机制。

现有 71853858a 渠道并非无来源：今日首页嵌入的 `semDeliveryConfig` 中百度兜底 Android 链仍是 `NukPJ`，正常 GET 仍转向该既有 APK；它是 SEM 兜底渠道，而无参数普通入口对应 69310258a。本结论来自普通入口的当下页面／JS／浏览器生成链接／完整 GET 跳转／APK 身份，未用旧直链可下载替代当日官网证据。

## 主要证据

- `home.html`、`home-provenance.json`：新鲜普通首页。
- `android-home.html`、`android-home-provenance.json`：新鲜 Android UA 首页。
- `main.9548ff80fd.js`、`t.d1c39a18e1.js`、`page.18198431be.js` 及各自 provenance：当前官方脚本。
- `router-data.json`、`selection-evidence.json`：当前嵌入配置与入口生成片段。
- `browser-observation.json`、`browser-mobile-home.html`、`browser-mobile-home.png`：独立 Chromium 的当次观察。未进行账号登录，也没有声称已经点击一个具备 button 语义的控件；此页移动端下载控件没有 button 角色，入口通过网站实际初始化输出确定。
- `selected-download-redirect.json`：当前浏览器完整生成链接的 GET 跳转链。
- `apk-download-provenance.json`、`identity.json`：完整普通入口 APK 的来源与身份。
- `channel-difference.json`、`dex-comparison.json`、`certificate-comparison.json`：两渠道对照。
- `current-normal-badging.txt`、`existing-sem-badging.txt`、`current-normal-certificate.txt`、`existing-sem-certificate.txt`：Android SDK 原始输出。apksigner 对两包都提示若干 META-INF 条目未受 JAR 签名保护的上游包警告，完整原文保留，验证退出码均为 0。

观察范围是本次时间、官网普通 Android 入口及上述两个渠道；不泛化为所有地区、灰度用户或所有应用商店的全局最新版。所有新增文件仅在本研究目录，未修改产品、未上传 GitHub。

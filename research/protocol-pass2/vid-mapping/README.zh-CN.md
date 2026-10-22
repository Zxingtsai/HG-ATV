# VID、枚举与真实播放组件的静态映射

2026-10-21 UTC；只读取用户已指定的原 `hongguo.apk`，未执行 APK、未操作手机、未发网络请求、未读取或请求内容密钥。全部新增证据是原 DEX 元数据和 Android SDK 35.0.0 dexdump 指令文本，没有新建或虚构 REA `ev_*` 记录。旧 REA 网络方法证据仅作为入口复用。

## 主要结论

原先 `ShortSeriesVideoModelCache` 协程之外，已定位主 shortvideo v2 数据组件的另一个模型请求入口：

```text
VideoDetailInfo.videoList: List<EpisodeInfo>
  -> ss4.e.a: EpisodeInfo.vid -> SaasVideoData.vid
  -> pr4.f$a.a: SaasVideoData.vid -> pr4.f.b
  -> com.dragon.read.component.shortvideo.impl.v2.data.b.i(pr4.f, ...)
  -> dt4.b.a(...)
  -> vs4.a.g(GetVideoModelRequest)
```

箭头表示已核对的字段赋值/参数类型，以及数据组件到 dt4/vs4 的直接调用关系；尚未将每个箭头都还原为一条独立完整控制流。`pr4.f$a.a` 的原始模式扫描候选调用者包括 autoplay、landingcache 和其他协程/任务组件，这组外围候选尚未逐个用 SDK 确认。这里没有声称上述节点在用户当前一次播放中实际全部执行，也没有建立全应用唯一播放路径。

**请求输入是业务数据中的 `vid` 或关联素材 ID，不是在本段代码中转换得到的 TTVideoEngine `v02...` 内容 VID。** 官网历史播放信息已能证明某些 item_id 与 `v02...` 之间另有映射，但尚未获得原版 App 的实际详情响应，不能因此断言官网 item_id、App EpisodeInfo.vid、TT VID 三者可以直接混用。

## 主 v2 请求路径的精确观察

原 `classes4.dex` 的 `com.dragon.read.component.shortvideo.impl.v2.data.b.i(Lpr4/f;ZZ)`：

- `0x0067` 读取 `pr4.f.b:String`；`0x0069` 读取平台 `pr4.f.c`；`0x006b` 读取 `VideoSeriesIdType`；`0x006d` 读取 content_type 数值；另取 source/fromVideoId/DNS/expireStrategy。
- `0x007d` 调用 `dt4.b.a(String, VideoPlatformType, boolean, VideoSeriesIdType, int, int, String, pr4.p, String)`。
- 更早的分支可能复用最近视频的运行中预取任务，否则执行网络模型请求。

原 `classes3.dex` 的 `dt4.b.a`：

- `0x0008` 把第一个 String 入参直接写到 `GetVideoModelRequest.videoId`。
- 平台空时 `0x0013` 取 `VideoPlatformType.Outer`。
- `MultiVideoModelOpt.enable=false` 时在 `0x003f` 设置 `bizParam.videoIdType`；为 true 时在 `0x004a` 设置顶层 `videoContentType`，找不到枚举时取 ShortSeriesPlay。
- 另设置分辨率/MP4 对齐、useOsPlayer、fromVideoId、source、deviceLevel，以及可选 DNS 和 expireStrategy。
- `0x00a0` 调用 `vs4.a.g(request)`。

原 `classes3.dex` 的 `pr4.f$a.a(SaasVideoData, VideoModelExpireStrategy)`：

- `0x0011` 读取 `SaasVideoData.vid`，`0x0016` 原样存入 `pr4.f.b`；平台也直接复制。
- 正常路径取 `VideoSeriesIdType.VideoId`；`isRelatedMaterialId` 或辅助判定 `video.a.e(data)` 为真时取 SeriesId。
- contentType 已有值时直接使用；空值时正常取 ShortSeriesPlay，关联素材分支取 PUGC。

原 `classes3.dex` 的 `ss4.e.a`：

- `0x0036` 读 `EpisodeInfo.vid`，`0x0038` 写 `SaasVideoData.vid`。
- `0x00b6` 起检测 vid 为空；若 relatedMaterialId 非空，`0x00c8` 改用 relatedMaterialId。`0x00ca` 另检查 EpisodeInfo.isPreviewMaterial；仅其为真才调用 `SaasVideoData.d(true)`，后者设置 isRelatedMaterialId 和 SeriesId 类型，不能把回退与标记当作无条件绑定。

这些方法均保留完整 `.dexdump.txt`；SDK 输出中的 code unit 是本方法指令偏移，不是源码行号。

## 枚举实际值

`seriessdk...VideoPlatformType` 与 `com.dragon.read.rpc.model.VideoPlatformType` 均为：

| 名称 | value |
| --- | --- |
| Unknown | 0 |
| PlatformDouyin | 1 |
| UgcVideo | 2 |
| Outer | 3 |
| PlatformXigua | 4 |
| Chameleon | 5 |
| Mixed | 1024 |

`VideoSeriesIdType`（对应 `GetVideoBizParam.videoIdType` / JSON `video_id_type`）：VideoId=0、SeriesId=1、PostId=2。

两个命名空间的 `VideoContentType` 也一致：ShortSeriesPlay=1、ScenePlay=2、ExpertRecommendBook=3、PPTRecommendBook=4、Movie=5、TelePlay=6、ShortPlay=7、DropMaterial=1000、PUGC=1001、UnrealShortPlay=1002、Album=1003、MotionComic=1004、FamousSceneVideo=1005、UgcPostVideo=1006、UnrealMotionComic=1007、CommerceVideoSlice=1008、AIRewriteDraft=1009、Video1ColPushBookVideo=1010、FamousSceneTtv=1011、AdReplacePlay=1012。

`enum-values.json` 为原 `<clinit>` 的 const / constructor 调用参数逐项记录。构造方法把最后一个 int 写入 `value`，`getValue()` 读取此字段；上表使用 value，**不是 Java enum ordinal**。没有从名称猜数字，也没有证明某部剧运行时一定选哪个内容类型。

## 详情字段与公开 ID 关系

原 `classes15.dex` field annotations / Signature 核对：

- `SaaSVideoDetailData.videoData` 为 `VideoDetailInfo`，JSON `video_data`。
- `VideoDetailInfo.videoList` 为 `List<EpisodeInfo>`，JSON `video_list`。
- `videoDetailList` 为 `List<VideoDetailInfo>`，不是另一个 TT 媒体模型列表。
- EpisodeInfo 有 `vid`、`seriesId`（series_id）、`relatedMaterialId`（related_material_id）、content_type、vid_index、trial_duration、is_preview_material、need_unlock 等；本选定类没有单独的 `tt_vid` 字段。

详见 `detail-metadata.json` / `detail-field-annotations.json`。模型未声明 `tt_vid` 不证明运行时不可能由其他响应或模型 JSON 获取该 ID。

`public-id-map.json` 只抽取已有官网观察的 11 条内容 ID 关系，不访问原敏感播放字段，也不重新请求。例如：

| item_id | TT VID |
| --- | --- |
| 7690963410778868761 | v02ebeg10000datsku7og65tsj5oop8g |
| 7690963491330477081 | v02ebeg10000datsl2vog65to9f3a5f0 |

它们来自既有官网响应结构，不是本分支验证成功的 App 播放输入，更不是解密或完整播放证据。

## 缓存路径范围纠正

跨 25 个原 DEX 的定向原始 invoke 模式扫描只找到一个 `ShortSeriesVideoModelCache$c.<init>` 调用候选，并由 SDK 确认：原 `classes16.dex` 的 `VideoAutoPlayListHolder$ItemViewHolder$bindVideoView$1.invokeSuspend`。

它在 `0x0023/0x0030/0x003b` 分别读取 `VideoTabModel$VideoData.vid/videoPlatform/contentType`，`0x0041` 构造缓存请求参数；`0x004a` 随后先检查已有 videoModel，非空直接使用，否则再走缓存/网络。

**这个构造点属于商城自动播放路径；不能仅凭这一处就说缓存类的所有方法仅用于商城。** 它的 b/c 方法、接口调用、动态调用和反射仍可能有其他使用者。原手机 hook 目标是下层 `c95.s0.g`，其范围也不能仅由这个上层缓存构造点推断。

另有 `ap4.d.apply` 在 `0x004d` 设置 caller_scene="download"，Outer/VideoId，之后调用 vs4.a.g；该新增路径有明确下载标签，不把它当作主观看页面的证据。

## 来源、搜索边界与复现

- 原 APK SHA-256：`77f23369c02f8a2d7a66f1fbe960dcd7bc402e529f69a4b21bf047c59fea6d93`。
- SDK 指令观察选取 classes3/4/5/7/9/15/16 中列出的类；每个输出文件与原 DEX 成员 SHA-256 见 `output-manifest.json`。不是整 APK 方法反编译。
- `find_constructor_candidates.py` / `find_method_candidates.py` / `find_field_candidates.py` 遍历 25 个 DEX 的选定 declared method code items，仅做原始 code-unit 模式筛选，不是完整 Dalvik 解码器；命中先标候选，报告关键链路再用 SDK 明确确认指令边界。未验证候选不能当作 xref 事实。
- `dex_metadata.py` 解析选定 declared field IDs、Gson/Signature 注解；原始 enum reference 显式解析，其他原始数字保留 encoded_type，不把 enum 索引当实际协议值。
- `dump_classes.py` 从原 ZIP 成员复制原字节，调用 Android SDK dexdump；只保留指定类块。显示 UTF-8 不兼容字节作替换显示，DEX 不改写。脚本及候选 JSON 均在本目录。
- 静态路由注解索引精确匹配 `/novel/player/video_model/v1/` 只看到 `classes15.dex kl8.a$a.getVideoModelRxJava`；这受静态 method annotations 范围限制，不覆盖动态拼接路由或原生网络行为。
- 未访问用户设备标识、账号凭据或内容密钥。本分支没有证明完整 App 协议已可重放或完整剧集已可播放。

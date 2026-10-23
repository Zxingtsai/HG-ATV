# 登录会话静态对照 / Login-session static comparison

旧版 **6.2.3.32** 与新版 **7.4.1.32** 在已查范围仍采用同一组会话概念：SDK `session_key`、Web cookie `sessionid`、账户状态 SharedPreferences 与退出清理逻辑。此处没有登录任何账号，也没有证明两种键的运行时值相同。

## 证据身份与边界

这是普通 DEX 元数据与 Android `dexdump -d` 的静态证据，**不是 REA 观察，也不是运行时通信抓包**。此 worker 未调用 REA；REA Evidence ID 留空，父任务可单独补充。
- 旧 APK SHA-256: `7724c9a2a7cd5a4cc53edf309dbd628a9e2418e459805b571eda9537881a8f27`
- 新 APK SHA-256: `77f23369c02f8a2d7a66f1fbe960dcd7bc402e529f69a4b21bf047c59fea6d93`
- 每个原始 DEX SHA-256、反汇编类与输出摘要见 `dump-manifest.json`；APK/DEX完整目录见 `old-identity.json`、`new-identity.json`。
- `*-session-string-candidates.json` 是全 DEX 字面量线索扫描；扫描不是完整指令解码，未验证线索不作为结论。

## Findings / 已证实与未解部分

### S01
Both APKs expose a business AccountServiceImpl.getSessionKey bridge. SDK session key is returned first; null fallback queries the cookie key sessionid. New fallback domain is security.snssdk.com; old domain comes from account configuration.

Boundary / 边界：session_key is an SDK model/SP key; sessionid is a cookie key. Their runtime values and equality have NOT been observed.

静态来源：
- `research/version-compare/account-library/session-static/old-com_dragon_read_user_AccountServiceImpl.dexdump.code.txt:108` — `[4abb10]`
- `research/version-compare/account-library/session-static/new-com_dragon_read_user_AccountServiceImpl.dexdump.code.txt:243` — `[630ea8]`
- `research/version-compare/account-library/session-static/old-com_bytedance_sdk_account_utils_m.dexdump.code.txt:269` — `[4ac308]`

### S02
Both SDKs persist account state in SharedPreferences com.bytedance.sdk.account_setting: session_key, session_sign, is_login, user_id and other account fields. Old h.j.ab loads, h.j.b saves; new impl.i.j loads, impl.i.n saves.

Boundary / 边界：Static persistence path only; did not inspect user files or prove installed account state.

静态来源：
- `research/version-compare/account-library/session-static/old-com_bytedance_sdk_account_h_j.dexdump.code.txt:223` — `[480b10]`
- `research/version-compare/account-library/session-static/old-com_bytedance_sdk_account_h_j.dexdump.code.txt:852` — `[48156c]`
- `research/version-compare/account-library/session-static/old-com_bytedance_sdk_account_h_j.dexdump.code.txt:2356` — `[482d90]`
- `research/version-compare/account-library/session-static/new-com_bytedance_sdk_account_impl_i.dexdump.code.txt:219` — `com.bytedance.sdk.account_setting`
- `research/version-compare/account-library/session-static/new-com_bytedance_sdk_account_impl_i.dexdump.code.txt:874` — `[6dc80c]`
- `research/version-compare/account-library/session-static/new-com_bytedance_sdk_account_impl_i.dexdump.code.txt:1490` — `[6dd1f0]`

### S03
Both SDK transport paths inspect Set-Cookie/sessionid and x-tt-token, x-tt-session-sign, x-tt-multi-sids; csrf cookie token is relayed as x-tt-passport-csrf-token. Old csrf SP is CsrfTokenManager_sp/csrf_token.

Boundary / 边界：Header names and parsing/transmission code, not live header values. TTNet/native cookie attachment behavior was not dynamically captured.

静态来源：
- `research/version-compare/account-library/session-static/old-com_bytedance_sdk_account_h_p.dexdump.code.txt:278` — `[486ac8]`
- `research/version-compare/account-library/session-static/old-com_bytedance_sdk_account_h_p.dexdump.code.txt:877` — `[487478]`
- `research/version-compare/account-library/session-static/old-com_bytedance_sdk_account_k.dexdump.code.txt:26` — `CsrfTokenManager_sp`
- `research/version-compare/account-library/session-static/new-com_bytedance_sdk_account_impl_x.dexdump.code.txt:600` — `"set-cookie"`
- `research/version-compare/account-library/session-static/new-com_bytedance_sdk_account_impl_x.dexdump.code.txt:606` — `"x-tt-session-sign"`
- `research/version-compare/account-library/session-static/new-com_bytedance_sdk_account_impl_x.dexdump.code.txt:170` — `"x-tt-passport-csrf-token"`

### S04
Successful business logout resets local account data and expires sid_tt, uid_tt, sessionid and sid_guard for .snssdk.com, then flushes cookies. Both also call TTTokenManager.clearToken.

Boundary / 边界：Old branch supports API<21 CookieSyncManager.sync, new branch directly flushes. Cookie clearing is not evidence of server-side revocation and does not assert all cookie domains/names are cleared.

静态来源：
- `research/version-compare/account-library/session-static/old-com_dragon_read_user_AccountServiceImpl.dexdump.code.txt:165` — `[4abc08]`
- `research/version-compare/account-library/session-static/old-com_dragon_read_user_b$11.dexdump.code.txt:11` — `[4b02d8]`
- `research/version-compare/account-library/session-static/old-com_dragon_read_user_b.dexdump.code.txt:1996` — `[4b4e98]`
- `research/version-compare/account-library/session-static/old-com_dragon_read_user_b.dexdump.code.txt:855` — `[4b3b44]`
- `research/version-compare/account-library/session-static/new-com_dragon_read_user_AccountServiceImpl.dexdump.code.txt:349` — `[631080]`
- `research/version-compare/account-library/session-static/new-com_dragon_read_user_AcctManager$l.dexdump.code.txt:11` — `[631fb8]`
- `research/version-compare/account-library/session-static/new-com_dragon_read_user_AcctManager.dexdump.code.txt:284` — `[63360c]`
- `research/version-compare/account-library/session-static/new-com_dragon_read_user_AcctManager.dexdump.code.txt:107` — `[633304]`

### S05
Both SDKs construct POST /passport/mobile/sms_login/ using mobile and code transformed by StringUtils.encryptWithXor, mix_mode=1 and optional captcha. Old SDK additionally allows auth_opposite and extra map fields in this factory.

Boundary / 边界：SDK request construction only; no SMS was requested, no account was logged in. XOR transformation implementation was not expanded and no credentials were generated.

静态来源：
- `research/version-compare/account-library/session-static/old-com_bytedance_sdk_account_l_b_r.dexdump.code.txt:24` — `[4969e8]`
- `research/version-compare/account-library/session-static/old-com_bytedance_sdk_account_l_b_r.dexdump.code.txt:46` — `[496a48]`
- `research/version-compare/account-library/session-static/old-com_bytedance_sdk_account_e_a$a.dexdump.code.txt:263` — `[47c1d0]`
- `research/version-compare/account-library/session-static/new-com_bytedance_sdk_account_impl_c.dexdump.code.txt:147` — `[6da08c]`
- `research/version-compare/account-library/session-static/new-eh1_a$a.dexdump.code.txt:162` — `[72bb8c]`

### S06
Old app user.a.a.a(String,String,String) creates user.a.a$31; its subscribe calls account.h.g.b(context) -> api.i.a(mobile,code,captcha,callback), an app business-to-SDK gateway. New SMS impl.c.g is confirmed at SDK construction level; the new UI/business caller was not fully traced.

Boundary / 边界：The UI event that selects this route, SDK api.i implementation dispatch and live request emission were not observed.

静态来源：
- `research/version-compare/account-library/session-static/old-com_dragon_read_user_a_a.dexdump.code.txt:266` — `[4af678]`
- `research/version-compare/account-library/session-static/old-com_dragon_read_user_a_a$31.dexdump.code.txt:23` — `[4ae544]`
- `research/version-compare/account-library/session-static/new-com_bytedance_sdk_account_impl_c.dexdump.code.txt:147` — `[6da08c]`

### S07
Old SMS success parser delegates l.b.r.b(JSONObject,JSONObject) -> h.c$a.b -> h.c$a.a -> account model. Old u.c.a(model,JSONObject,JSONObject) reads JSON session_key into model.h, with user_id/sec_user_id/new_user. Both transport paths separately collect Set-Cookie; exact live relationship between response session_key and cookie sessionid remains unknown. New SMS success parser kh1.d.i delegates impl.b$a.c -> wy7.d account model; that parser was not fully expanded.

Boundary / 边界：No claim that this is a complete response schema, nor that session fields are interchangeable. Existing candidate scans are leads rather than verified instruction boundaries.

静态来源：
- `research/version-compare/account-library/session-static/old-com_bytedance_sdk_account_l_b_r.dexdump.code.txt:120` — `Lcom/bytedance/sdk/account/h/c$a;.b:`
- `research/version-compare/account-library/session-static/old-com_bytedance_sdk_account_h_c$a.dexdump.code.txt:42` — `[47dfe4]`
- `research/version-compare/account-library/session-static/old-com_bytedance_sdk_account_u_c.dexdump.code.txt:232` — `[4aa5b0]`
- `research/version-compare/account-library/session-static/new-kh1_d.dexdump.code.txt:37` — `[7422a4]`

### S08
Old app Douyin login code user.a.a$8/$13 uses AuthorizeFramework and aweme_v2 with app id literal 7828, user_info plus optional mobile, skip_auth_confirm, fanqie.follow scopes. New SDK impl.t.b constructs /passport/auth/login/ and delegates form construction to impl.b.b; that form was not fully expanded.

Boundary / 边界：Do not equate this Douyin authorization flow with SMS login, or claim every SDK route is used by a current UI.

静态来源：
- `research/version-compare/account-library/session-static/old-com_dragon_read_user_a_a$8.dexdump.code.txt:26` — `[4af0d0]`
- `research/version-compare/account-library/session-static/old-com_dragon_read_user_a_a$13.dexdump.code.txt:26` — `[4ac9f8]`
- `research/version-compare/account-library/session-static/new-com_bytedance_sdk_account_impl_t.dexdump.code.txt:83` — `[6de3dc]`

## Conclusions / 可使用的结论

1. 两版本确有业务层读取会话与退出清理路径；登录能力没有因版本更替而在所查静态代码中消失。
2. SDK存在短信与第三方授权两套构造入口，不能把SDK端点出现等同于今日UI会执行它，更不能把静态可构造等同于服务器现在接受。
3. `session_key`既是SDK内存账户字段/持久化键，也在旧账户JSON模型解析器中出现；`sessionid`是CookieManager查询/Set-Cookie识别键。没有动态观察它们的实际值或等价关系。
4. 未做短信、登录、用户Cookie读取或收藏写入；本scope不证明认证有效性、收藏同步成功或旧版兼容性的原因。

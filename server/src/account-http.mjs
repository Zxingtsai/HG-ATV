import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.mjs';

function loopback(request) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
}
export function createAccountRoutes(account, sendJson) {
  const token = randomBytes(32).toString('base64url');
  const page = accountPage(token);
  return async (request, response, route, method) => {
    if (route !== '/account' && !route.startsWith('/account/')) return false;
    const port = request.socket.localPort;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
    const host = request.headers.host;
    if (!loopback(request) || !hosts.includes(host)) throw new AppError('ACCOUNT_LOCAL_ONLY', '请在服务器本机使用 localhost 打开账号页面', 403);
    if (request.headers.origin && request.headers.origin !== `http://${host}`) throw new AppError('ACCOUNT_ORIGIN_INVALID', '请从服务器本机账号页面操作', 403);
    if ((method === 'GET' || method === 'HEAD') && ['/account', '/account/'].includes(route)) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${token}'; style-src 'nonce-${token}'; img-src data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'` });
      response.end(method === 'HEAD' ? undefined : page); return true;
    }
    const supplied = request.headers['x-hg-account-token'];
    if (typeof supplied !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) {
      throw new AppError('ACCOUNT_CONTROL_REQUIRED', '请刷新服务器本机账号页面后重试', 403);
    }
    if (method === 'GET' && route === '/account/api/status') { sendJson(response, 200, account.status({ admin: true })); return true; }
    if (method === 'POST') {
      let size = 0;
      for await (const chunk of request) { if ((size += chunk.length) > 1024) throw new AppError('BODY_TOO_LARGE', '请求过大', 413); }
      const action = { '/account/api/start': () => account.start(), '/account/api/verify': () => account.start({ verifyOnly: true }),
        '/account/api/cancel': () => account.cancel(), '/account/api/logout': () => account.logout() }[route];
      if (action) { sendJson(response, 200, await action()); return true; }
    }
    throw new AppError('NOT_FOUND', '未找到此账号操作', 404);
  };
}

function accountPage(token) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>红果 TV · 服务端账号</title>
<style nonce="${token}">:root{color-scheme:light}body{font:16px/1.7 system-ui,sans-serif;margin:0;background:#f5f6f8;color:#18202b}main{max-width:660px;margin:7vh auto;padding:30px;background:white;border-radius:18px}h1{font-size:26px;margin-top:0}p{margin:12px 0}.muted{color:#5e6876;font-size:14px}#qr{display:none;width:250px;height:250px;object-fit:contain;margin:20px auto}#status{padding:16px;background:#f1f4f8;border-radius:10px}button{font:inherit;border:0;border-radius:9px;padding:11px 17px;margin:6px 8px 6px 0;cursor:pointer;background:#e9edf2;color:#152332}button:first-child{background:#ed383d;color:white}button:disabled{opacity:.5;cursor:wait}#error{color:#b42318;white-space:pre-wrap}@media(max-width:700px){main{margin:16px;padding:22px}}</style>
<main><h1>服务端红果账号</h1><p>用手机上的红果短剧 App 扫码，并在手机上确认登录。</p><p id="status" role="status" aria-live="polite">正在读取账号状态…</p><img id="qr" alt="红果官网登录二维码"><p id="profile"></p><div><button id="start">生成登录二维码</button><button id="verify">验证已保存的会话</button><button id="cancel">取消扫码</button><button id="logout">退出并清除本机会话</button></div><p id="error" role="alert"></p><p class="muted">扫一扫入口：红果 App → 我的 → 右上角功能列表 → 扫一扫。二维码过期后可重新生成。</p><p class="muted">这是红果官网账号会话。登录后服务端向官网请求时会使用该会话；App 原生接口与云收藏同步尚未接入。账号管理仅在服务器本机开放，电视不会收到账号凭据。</p></main>
<script nonce="${token}">
'use strict';
const token=${JSON.stringify(token)}, $=id=>document.getElementById(id);let busy=false,stopped=false;
async function call(path,method='GET'){const response=await fetch('/account/api/'+path,{method,cache:'no-store',headers:{'X-HG-Account-Token':token,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:'{}'}:{})});const data=await response.json();if(!response.ok)throw Error(data.error?.message||'账号操作失败');return data;}
function render(data){$('status').textContent=data.message;$('profile').textContent=data.nickname?'账号：'+data.nickname+(data.authenticated?'':'（待验证）'):'';if(data.qrImage){$('qr').src=data.qrImage;$('qr').style.display='block';}else{$('qr').removeAttribute('src');$('qr').style.display='none';}for(const id of ['start','verify'])$(id).disabled=busy||['opening','verifying'].includes(data.state);$('verify').hidden=!data.nickname;$('cancel').hidden=!['opening','waiting_scan','waiting_confirm','verifying'].includes(data.state);$('start').textContent=data.state==='authenticated'?'重新验证账号':data.qrImage?'重新生成二维码':'生成登录二维码';}
for(const id of ['start','verify','cancel','logout'])$(id).onclick=async()=>{if(busy)return;busy=true;$('error').textContent='';try{render(await call(id,'POST'));}catch(error){$('error').textContent=error.message;}finally{busy=false;}};
async function poll(){if(stopped)return;try{render(await call('status'));}catch(error){$('error').textContent=error.message;}setTimeout(poll,1500);}window.addEventListener('pagehide',()=>{stopped=true;$('qr').removeAttribute('src');});poll();
</script></html>`;
}

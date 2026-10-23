"""Open official anonymous login UI; never submit phone/SMS or retain cookies."""
import asyncio, datetime, hashlib, json, os
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from playwright.async_api import async_playwright

OUT = Path(__file__).resolve().parent

async def main():
    calls, scripts, tasks = [], [], []
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
            proxy={'server': os.environ['HTTPS_PROXY']}, args=['--no-sandbox', '--disable-dev-shm-usage'])
        context = await browser.new_context(viewport={'width':1280,'height':900})
        page = await context.new_page()
        async def response(r):
            url = urlsplit(r.url)
            if '/passport/' in url.path or '/sso/' in url.path or '/account/' in url.path:
                entry = {'host':url.hostname,'path':url.path,'query_keys':sorted(parse_qs(url.query)), 'method':r.request.method,'status':r.status}
                if r.request.post_data:
                    entry['form_keys'] = sorted(parse_qs(r.request.post_data))
                try:
                    value = await r.json()
                    entry['response_keys'] = sorted(value)
                    data = value.get('data')
                    if isinstance(data,dict):
                        entry['data_keys']=sorted(data)
                        for key in ['error_code','description','has_login','status','expire_time']:
                            if key in data:entry[key]=data[key]
                        if isinstance(data.get('qrcode'),str):entry['qrcode_format']={'length':len(data['qrcode']),'is_jpeg_base64':data['qrcode'].startswith('/9j/'),'is_png_base64':data['qrcode'].startswith('iVBOR')}
                    for k in ['message','error_code','has_login']:
                        if k in value:entry[k]=value[k]
                except Exception:pass
                calls.append(entry)
            if url.hostname == 'lf-fe.fqnovelstatic.com' and url.path.endswith('.js'):
                try:
                    raw = await r.body()
                    target=OUT/url.path.rsplit('/',1)[-1]
                    target.write_bytes(raw)
                    scripts.append({'url':r.url,'file':target.name,'sha256':hashlib.sha256(raw).hexdigest()})
                except Exception:pass
        page.on('response',lambda r:tasks.append(asyncio.create_task(response(r))))
        try:
            await page.goto('https://hongguoduanju.com/',wait_until='domcontentloaded',timeout=45000)
            await page.get_by_role('button',name='登录',exact=True).wait_for(timeout=45000)
            await page.get_by_role('button',name='登录',exact=True).click()
            await page.wait_for_timeout(7000)
            verification=await page.evaluate('''async () => {
                let runtime;
                window.rspackChunkhongguo.push([["hg_atv_probe_"+Date.now()],{},r=>runtime=r]);
                await Promise.all(["5y",32,"u2"].map(id=>runtime.e(id)));
                const {WebInterfaceSdk}=runtime("V1");
                try {
                    const r=await new WebInterfaceSdk({aid:8662,isBoe:false}).login.checkLogin({});
                    return {ok:true,keys:Object.keys(r),dataKeys:r.data?Object.keys(r.data):[],has_login:r.has_login??r.data?.has_login};
                } catch(e) {return {ok:false,error_code:e.error_code,code:e.code,description:e.description,type:typeof e};}
            }''')
            print('VERIFICATION',json.dumps(verification,ensure_ascii=False))
            ui=await page.locator('body').inner_text()
            (OUT/'official-login-ui.txt').write_text(ui)
            await page.screenshot(path=str(OUT/'official-login-ui.png'))
            print(json.dumps({'buttons':await page.get_by_role('button').all_text_contents(),'inputs':await page.locator('input').evaluate_all('(xs)=>xs.map(x=>({type:x.type,placeholder:x.placeholder,name:x.name}))')},ensure_ascii=False))
        except Exception as exc:
            print('UI error:',type(exc).__name__)
        finally:
            if tasks:await asyncio.gather(*tasks,return_exceptions=True)
            (OUT/'official-anonymous-observation.json').write_text(json.dumps({'date':datetime.datetime.now(datetime.timezone.utc).isoformat(),'calls':calls,'scripts':scripts,'scope':'Anonymous UI and status only; no phone/SMS/login, cookies or token values retained.'},ensure_ascii=False,indent=2))
            print(json.dumps(calls,ensure_ascii=False))
            await browser.close()

asyncio.run(main())

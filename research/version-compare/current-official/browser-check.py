import os,json,pathlib,datetime
from playwright.sync_api import sync_playwright
p=pathlib.Path(__file__).parent
logs=[];requests=[];downloads=[]
with sync_playwright() as w:
 kwargs={'headless':True,'executable_path':'/usr/bin/chromium','args':['--no-sandbox']}
 if os.environ.get('HTTPS_PROXY'): kwargs['proxy']={'server':os.environ['HTTPS_PROXY']}
 browser=w.chromium.launch(**kwargs)
 context=browser.new_context(user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',viewport={'width':412,'height':915},is_mobile=True,has_touch=True,accept_downloads=True)
 page=context.new_page()
 page.on('console',lambda msg: logs.append({'type':msg.type,'text':msg.text}))
 page.on('request',lambda req: requests.append({'url':req.url,'method':req.method}))
 page.on('download',lambda d: downloads.append({'url':d.url,'suggestedFilename':d.suggested_filename}))
 try:
  page.goto('https://hongguoduanju.com/',wait_until='domcontentloaded',timeout=60000)
  page.wait_for_timeout(30000)
  (p/'browser-mobile-home.html').write_text(page.content())
  page.screenshot(path=str(p/'browser-mobile-home.png'),full_page=False)
  buttons=page.get_by_role('button').all_text_contents()
  (p/'browser-observation.json').write_text(json.dumps({'fetchedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'url':page.url,'buttons':buttons,'console':logs,'requests':requests,'downloads':downloads},ensure_ascii=False,indent=2))
  print('buttons',buttons)
  print('links',[x for x in logs if '[link]' in x['text'] or 'semDelivery' in x['text']])
 finally: browser.close()

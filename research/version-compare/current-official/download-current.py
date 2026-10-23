import pathlib,urllib.request,json,hashlib,datetime
p=pathlib.Path(__file__).parent
u=json.loads((p/'NF2rW.provenance.json').read_text())['responseUrl']
r=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36','Referer':'https://hongguoduanju.com/'}),timeout=120)
h=hashlib.sha256();n=0
with (p/'hongguo-current-normal.apk.part').open('wb') as f:
 while True:
  b=r.read(2*1024*1024)
  if not b:break
  f.write(b);h.update(b);n+=len(b)
 if n!=int(r.headers.get('Content-Length',n)):raise RuntimeError('truncated download')
(p/'hongguo-current-normal.apk.part').rename(p/'hongguo-current-normal.apk')
j={'fetchedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'url':u,'responseUrl':r.url,'status':r.status,'headers':dict(r.headers),'bytes':n,'sha256':h.hexdigest()}
(p/'apk-download-provenance.json').write_text(json.dumps(j,indent=2))
print(json.dumps(j,indent=2))

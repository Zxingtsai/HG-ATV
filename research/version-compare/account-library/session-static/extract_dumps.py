import zipfile,subprocess,json,hashlib,re,sys
from pathlib import Path
OUT=Path('research/version-compare/account-library/session-static')
requests={
'old':{'apk':'research/version-compare/hongguo-6.2.3.32.apk','targets':{'classes8.dex':['Lcom/bytedance/sdk/account/e/a$a;','Lcom/bytedance/sdk/account/h/c$a;','Lcom/bytedance/sdk/account/u/c;'],'classes2.dex':['Lcom/dragon/read/user/a/a$31;']}},
'new':{'apk':'research/hongguo.apk','targets':{'classes21.dex':['Leh1/a$a;','Lkh1/d;','Lkg1/a;']}}
}
for ver,req in requests.items():
 for member,targets in req['targets'].items():
  path=OUT/(ver+'-'+member);data=zipfile.ZipFile(req['apk']).read(member);path.write_bytes(data)
  p=subprocess.Popen(['/workspace/tools/android/build-tools/35.0.0/dexdump','-d',str(path)],stdout=subprocess.PIPE,text=True,errors='replace')
  buf=[];selected=False;name=None
  def flush():
   if selected:
    dest=OUT/(ver+'-'+name[1:-1].replace('/','_')+'.dexdump.txt');dest.write_text(''.join(buf));print(str(dest),flush=True)
  for line in p.stdout:
   if re.match(r'^Class #\d+',line):flush();buf=[line];selected=False;name=None
   else:
    buf.append(line)
    if "Class descriptor" in line:
     name=line.split("'")[1];selected=name in targets
  flush();p.wait()

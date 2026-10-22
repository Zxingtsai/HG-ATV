"""Retain dexdump method blocks with exact selected DEX method/field references."""
import json,re,zipfile,hashlib,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent
APK=ROOT.parents[1]/'hongguo.apk'
TOOL='/workspace/tools/android/build-tools/35.0.0/dexdump'
TARGET=re.compile(r'invoke-\S+.*(?:Lcom/dragon/read/rpc/rpc/q7(?:\$a)?;\.|Lcom/dragon/read/rpc/model/VideoInfoRequest;\.<init>)')
rows=[];members=[]
with zipfile.ZipFile(APK) as source:
 for dn in ['classes2.dex','classes6.dex','classes7.dex','classes8.dex','classes9.dex']:
  data=source.read(dn);path=ROOT/dn;path.write_bytes(data)
  members.append({'member':dn,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
  proc=subprocess.Popen([TOOL,'-d','-n',str(path)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,errors='replace')
  state='';klass='';buf=[];found=[]
  def flush():
   if buf and any(TARGET.search(line)for line in buf):
    text=''.join(buf);found.append({'class':klass,'matches':[line.strip()for line in buf if TARGET.search(line)],'dump':text})
  for line in proc.stdout:
   if line.startswith('Class #'):
    flush();buf=[];state='';klass=''
   if 'Class descriptor' in line:
    klass=line.split("'",2)[1]
   if re.match(r'  (Direct|Virtual) methods',line):
    flush();buf=[];state='methods'
   if state=='methods' and re.match(r'    #\d+\s+:',line):
    flush();buf=[]
   if state=='methods':buf.append(line)
  flush();err=proc.stderr.read();rc=proc.wait()
  ROOT.joinpath(dn+'-q7-context.txt').write_text('\n'.join(item['dump']for item in found))
  for item in found:
   item.pop('dump');item['dex']=dn
   rows.append(item)
  print(dn,'blocks',len(found),'exit',rc,flush=True)
ROOT.joinpath('q7-caller-contexts.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
ROOT.joinpath('dex-member-provenance.json').write_text(json.dumps({'source_apk_sha256':hashlib.sha256(APK.read_bytes()).hexdigest(),'limitations':'Original DEX ZIP members extracted unchanged for offline disassembly; not a client or complete program analysis.','members':members},indent=2))
print(json.dumps(rows,ensure_ascii=False,indent=2))

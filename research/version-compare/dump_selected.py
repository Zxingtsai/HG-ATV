"""Exact class disassembly from original DEX members; no APK execution."""
import sys,json,zipfile,hashlib,subprocess
from pathlib import Path
from collections import defaultdict
apk,index,out,*targets=sys.argv[1:];out=Path(out);out.mkdir(parents=True,exist_ok=True);index=json.loads(Path(index).read_text());groups=defaultdict(set)
for s in targets:
 desc=s if s.startswith('L') and s.endswith(';') else 'L'+s.replace('.','/')+';'
 if desc not in index:raise ValueError('Missing class '+desc)
 groups[index[desc]].add(desc)
with zipfile.ZipFile(apk) as z:
 for member,descs in groups.items():
  data=z.read(member);local=out/member;local.write_bytes(data)
  p=subprocess.Popen(['/workspace/tools/android/build-tools/35.0.0/dexdump','-d',str(local)],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,errors='replace')
  current=None;lines=[];found=set()
  def save():
   if current:
    (out/(current[1:-1].replace('/','-')+'.dexdump.txt')).write_text(''.join(lines));found.add(current)
  try:
   for line in p.stdout:
    if line.startswith('Class #'):
     save();current=None;lines=[]
     if found==descs:break
    if 'Class descriptor' in line:
     desc=line.split("'")[1]
     if desc in descs:current=desc
    if current:lines.append(line)
   save()
  finally:
   p.terminate();p.wait(timeout=20)
  (out/(member+'.provenance.json')).write_text(json.dumps({'apk_sha256':hashlib.sha256(Path(apk).read_bytes()).hexdigest(),'member':member,'sha256':hashlib.sha256(data).hexdigest(),'targets':sorted(descs),'found':sorted(found),'scope':'Original class disassembly; no execution; UTF-8 replacement only for text rendering.'},indent=2))
  assert found==descs
  print(member,len(found),'classes dumped',flush=True)

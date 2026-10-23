import sys,zipfile,hashlib,json,subprocess,re
from pathlib import Path
apk,member,version,*selectors=sys.argv[1:]
out=Path(__file__).parent;dest=out/(version+'-'+member);data=zipfile.ZipFile(apk).read(member);dest.write_bytes(data)
proc=subprocess.Popen(['/workspace/tools/android/build-tools/35.0.0/dexdump','-d',str(dest)],stdout=subprocess.PIPE,text=True,errors='replace')
block=[];name=None;count=0
for line in proc.stdout:
 if re.match(r'^Class #\d+',line):
  if name and any(re.search(s,name) for s in selectors):
   f=out/(version+'-'+name[1:-1].replace('/','_').replace('$','_')+'.dexdump.txt');f.write_text(''.join(block));print(name,f,flush=True);count+=1
  block=[line];name=None
 else:
  block.append(line)
  m=re.match(r"  Class descriptor\s*: '(.*)'",line)
  if m:name=m[1]
if name and any(re.search(s,name) for s in selectors):
 f=out/(version+'-'+name[1:-1].replace('/','_').replace('$','_')+'.dexdump.txt');f.write_text(''.join(block));print(name,f,flush=True);count+=1
code=proc.wait();(out/(version+'-'+member+'.dexdump-provenance.json')).write_text(json.dumps({'source_apk':str(Path(apk).resolve()),'source_apk_sha256':hashlib.sha256(Path(apk).read_bytes()).hexdigest(),'dex_member':member,'dex_sha256':hashlib.sha256(data).hexdigest(),'tool':'Android SDK build-tools35.0.0 dexdump -d','selected_class_regex':selectors,'class_blocks':count,'returncode':code,'evidence_type':'ordinary static DEX disassembly, not REA or execution'},indent=2))

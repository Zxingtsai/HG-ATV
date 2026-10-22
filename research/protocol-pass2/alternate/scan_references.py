"""Read original DEX identities and method references without executing target code."""
import zipfile,struct,json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parent
APK=ROOT.parents[1]/'hongguo.apk'
z=zipfile.ZipFile(APK)
rows=[]
for dn in z.namelist():
 if not dn.endswith('.dex'):continue
 d=z.read(dn)
 def u32(o):return struct.unpack_from('<I',d,o)[0]
 def st(o):
  while d[o]&128:o+=1
  o+=1;return d[o:d.index(0,o)].decode('utf-8','replace')
 strings=[st(u32(u32(60)+4*i))for i in range(u32(56))];types=[strings[u32(u32(68)+4*i)]for i in range(u32(64))]
 hits=[]
 for i in range(u32(88)):
  ci,pi,ni=struct.unpack_from('<HHI',d,u32(92)+i*8);cl=types[ci];method=strings[ni]
  if method=='videoInfoRxJava' or cl in ['Lcom/dragon/read/rpc/rpc/q7;','Lcom/dragon/read/rpc/model/VideoInfoRequest;']:
   hits.append({'method_index':i,'class':cl,'method':method})
 if hits:
  rows.append({'dex':dn,'sha256':hashlib.sha256(d).hexdigest(),'references':hits})
print(json.dumps(rows,ensure_ascii=False,indent=2))
ROOT.joinpath('method-reference-index.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))

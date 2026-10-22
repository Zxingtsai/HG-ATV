"""Inventory exact feed/model field-id references across all original DEX members."""
import zipfile,struct,json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parent;APK=ROOT.parents[1]/'hongguo.apk';z=zipfile.ZipFile(APK);rows=[]
targets={'Lcom/dragon/read/rpc/model/VideoData;':{'url','videoModel','useVideoModel','vid','trialDuration','isPreviewMaterial'},'Lcom/dragon/read/rpc/model/VideoInfo;':{'videoUrl','videoModel','videoId'},'Lcom/dragon/read/rpc/model/VideoPlayInfo;':{'mainURL','videoID'},'Lcom/dragon/read/rpc/model/VideoInfoData;':{'mainUrl'}}
for dn in z.namelist():
 if not dn.endswith('.dex'):continue
 d=z.read(dn)
 def u32(o):return struct.unpack_from('<I',d,o)[0]
 def st(o):
  while d[o]&128:o+=1
  o+=1;return d[o:d.index(0,o)].decode('utf-8','replace')
 strings=[st(u32(u32(60)+4*i))for i in range(u32(56))];types=[strings[u32(u32(68)+4*i)]for i in range(u32(64))];hits=[]
 for i in range(u32(80)):
  ci,ti,ni=struct.unpack_from('<HHI',d,u32(84)+i*8);cl=types[ci];field=strings[ni]
  if field in targets.get(cl,set()):hits.append({'field_index':i,'class':cl,'field':field,'type':types[ti]})
 if hits:rows.append({'dex':dn,'sha256':hashlib.sha256(d).hexdigest(),'references':hits})
ROOT.joinpath('feed-field-reference-index.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
for r in rows:print(r['dex'],[(x['class'].split('/')[-1],x['field'])for x in r['references']],flush=True)

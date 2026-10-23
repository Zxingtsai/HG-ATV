"""Read declared annotations only; not REA and not runtime traffic."""
import sys,re,json,struct,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from dex_tools import Dex,iter_dex
OUT=Path(__file__).parent
for ver,apk in [('old',OUT.parent/'hongguo-6.2.3.32.apk'),('new',OUT.parents[1]/'hongguo.apk')]:
 records=[]
 for member,data in iter_dex(apk):
  d=Dex(data);digest=hashlib.sha256(data).hexdigest()
  for cls,off in d.classes():
   ann=d.u32(off+20)
   if not ann:continue
   ca,nf,nm,np=struct.unpack_from('<4I',data,ann)
   params={}
   for j in range(np):
    idx,poff=struct.unpack_from('<2I',data,ann+16+8*(nf+nm+j))
    params[idx]=[d.annotations(d.u32(poff+4+4*n)) for n in range(d.u32(poff))] if poff else []
   for j in range(nm):
    idx,aoff=struct.unpack_from('<2I',data,ann+16+8*(nf+j));annotations=d.annotations(aoff)
    if not any(any(isinstance(v,str) and '/' in v and re.search(r'(bookshelf|favorite|collect|passport|user/info|login)',v,re.I) for v in a['values'].values()) for a in annotations):continue
    records.append({'class':cls,'dex':member,'dex_sha256':digest,'method':d.method(idx),'annotations':annotations,'parameter_annotations':params.get(idx,[])})
 (OUT/(ver+'-endpoint-annotations.json')).write_text(json.dumps(records,ensure_ascii=False,indent=2))
 print(ver,len(records))
 for r in records:
  print(r['dex'],r['class'],r['method']['name'],r['method']['descriptor'],r['annotations'])

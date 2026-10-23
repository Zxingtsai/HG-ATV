"""Conservative DEX code-unit candidate scan. Recheck candidate instruction sites with dexdump/REA."""
import sys,re,json,hashlib,struct
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]));from dex_tools import Dex,iter_dex
OUT=Path(__file__).parent
PATTERN=re.compile(r'(GetBookShelfVideoInfoRequest|UpdateBookShelfVideoInfoRequest|GetBookShelfInfoRequest|AddBookShelfInfoRequest|DeleteBookShelfInfoRequest|UpdateBookShelfVideo;)')
def methods(d):
 for cls,off in d.classes():
  cur=d.u32(off+24)
  if not cur:continue
  counts=[]
  for _ in range(4):n,cur=d.uleb(cur);counts.append(n)
  for count in counts[:2]:
   for _ in range(count):_,cur=d.uleb(cur);_,cur=d.uleb(cur)
  for count in counts[2:]:
   idx=0
   for _ in range(count):
    diff,cur=d.uleb(cur);idx+=diff;_,cur=d.uleb(cur);code,cur=d.uleb(cur)
    if code:yield cls,idx,code
for ver,apk in [('old',OUT.parent/'hongguo-6.2.3.32.apk'),('new',OUT.parents[1]/'hongguo.apk')]:
 records=[]
 for member,data in iter_dex(apk):
  d=Dex(data);targets={i:m for i in range(d.u32(88)) if PATTERN.search(json.dumps(m:=d.method(i)))}
  if not targets:continue
  for cls,idx,off in methods(d):
   units=struct.unpack_from('<'+'H'*d.u32(off+12),data,off+16)
   refs=[]
   for pos in range(len(units)-1):
    if units[pos]&255 in (0x6e,0x6f,0x70,0x71,0x72,0x74,0x75,0x76,0x77,0x78) and units[pos+1] in targets:
     refs.append({'code_unit':pos,'file_offset':off+16+2*pos,'target':targets[units[pos+1]]})
   if refs:records.append({'dex':member,'dex_sha256':hashlib.sha256(data).hexdigest(),'class':cls,'method':d.method(idx),'code_offset':off,'candidate_references':refs})
 (OUT/(ver+'-shelf-reference-candidates.json')).write_text(json.dumps(records,ensure_ascii=False,indent=2));print(ver,len(records),flush=True)
 for r in records:
  if not r['class'].startswith(('Lcom/dragon/read/rpc/model/','Lcom/dragon/read/pbrpc/')):print(r['dex'],r['class'],r['method']['name'],r['method']['descriptor'],flush=True)

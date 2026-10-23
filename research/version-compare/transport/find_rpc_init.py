"""Locate candidate direct calls / exact-string users; verify via dexdump before claims."""
import sys,struct,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from dex_tools import Dex,iter_dex
rows=[]
for member,data in iter_dex('/workspace/hongguo-tv/research/version-compare/hongguo-6.2.3.32.apk'):
 d=Dex(data);targets={}
 for i in range(d.u32(88)):
  m=d.method(i)
  if m['owner']=='Lcom/bytedance/rpc/n;' and m['name']=='a' and m['descriptor']=='(Landroid/app/Application;Lcom/bytedance/rpc/d;)V':targets[i]='RPC_INIT'
 needles={i:s for i,s in enumerate(d.strings) if s in {'X-Xs-From-Web','version'}}
 if not targets and not needles:continue
 for owner,off in d.classes():
  cur=d.u32(off+24)
  if not cur:continue
  counts=[]
  for _ in range(4):n,cur=d.uleb(cur);counts.append(n)
  for n in counts[:2]:
   for _ in range(n):_,cur=d.uleb(cur);_,cur=d.uleb(cur)
  for n in counts[2:]:
   idx=0
   for _ in range(n):
    delta,cur=d.uleb(cur);idx+=delta;_,cur=d.uleb(cur);code,cur=d.uleb(cur)
    if not code:continue
    nwords=d.u32(code+12);words=struct.unpack_from('<'+str(nwords)+'H',data,code+16)
    hits=[]
    # Broad raw-code-unit candidates only; opcode boundaries checked in a second disassembly.
    for j in range(len(words)-2):
     opcode=words[j]&255
     if opcode in (0x71,0x77) and words[j+1] in targets:hits.append({'kind':targets[words[j+1]],'code_unit':j})
     if opcode==0x1a and words[j+1] in needles:hits.append({'kind':'literal','value':needles[words[j+1]],'code_unit':j})
     if opcode==0x1b and (words[j+1]|words[j+2]<<16) in needles:hits.append({'kind':'literal','value':needles[words[j+1]|words[j+2]<<16],'code_unit':j})
    if hits:rows.append({'member':member,'class':owner,'method':d.method(idx),'code_offset':code,'hits':hits})
Path(__file__).with_name('old-rpc-init-candidates.json').write_text(json.dumps({'scope':'Candidate code-unit search, not instruction-boundary verified; use original class disassembly to corroborate.','rows':rows},indent=2))
for r in rows:
 if any(h['kind']=='RPC_INIT' or h.get('value')=='X-Xs-From-Web' for h in r['hits']):print(r['member'],r['class'],r['method']['name'],r['code_offset'],r['hits'],flush=True)

"""Locate original field reads/writes in declared methods; verify instruction boundaries.
Uses standard DEX instruction widths, including switch/array payloads. No target execution.
"""
import json,re,struct,zipfile,hashlib,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent;APK=ROOT.parents[1]/'hongguo.apk'
WIDTH=[1]*256
for op in [2,5,8,0x13,0x15,0x16,0x19,0x1a,0x1c,0x1f,0x20,0x22,0x23,0x29,0xfe,0xff]:WIDTH[op]=2
for op in [3,6,9,0x14,0x17,0x1b,0x24,0x25,0x26,0x2a,0x2b,0x2c,0xfc,0xfd]:WIDTH[op]=3
WIDTH[0x18]=5
for a,b,w in [(0x2d,0x3d,2),(0x44,0x6d,2),(0x6e,0x72,3),(0x74,0x78,3),(0x90,0xaf,2),(0xd0,0xe2,2),(0xfa,0xfb,4)]:
 for op in range(a,b+1):WIDTH[op]=w
results=[]
with zipfile.ZipFile(APK) as z:
 for dn in (sys.argv[2:] or ['classes.dex','classes10.dex','classes9.dex']):
  d=z.read(dn)
  def u32(o):return struct.unpack_from('<I',d,o)[0]
  def uleb(o):
   v=0;s=0
   while True:
    b=d[o];o+=1;v|=(b&127)<<s;s+=7
    if b<128:return v,o
  def st(o):
   _,o=uleb(o);return d[o:d.index(0,o)].decode('utf-8','replace')
  ss=[st(u32(u32(60)+4*i))for i in range(u32(56))];ts=[ss[u32(u32(68)+4*i)]for i in range(u32(64))]
  fields=[struct.unpack_from('<HHI',d,u32(84)+8*i)for i in range(u32(80))];ms=[struct.unpack_from('<HHI',d,u32(92)+8*i)for i in range(u32(88))]
  targets={i:(ts[ci],ss[ni],ts[ti])for i,(ci,ti,ni)in enumerate(fields)if ts[ci]=='Lcom/dragon/read/pages/bookmall/model/VideoTabModel$VideoData;'and ss[ni]in['url','videoModel','isTrailer']}
  pat=re.compile(b'[\x52-\x6d].(?:'+b'|'.join(re.escape(struct.pack('<H',v))for v in targets)+b')',re.S)
  def boundary(c):
   pos=0;valid=set()
   while pos<len(c)//2:
    valid.add(pos);word=struct.unpack_from('<H',c,pos*2)[0];op=word&255;step=WIDTH[op]
    if op==0 and word:
     if word==0x0100:step=4+2*struct.unpack_from('<H',c,pos*2+2)[0]
     elif word==0x0200:step=2+4*struct.unpack_from('<H',c,pos*2+2)[0]
     elif word==0x0300:
      el=struct.unpack_from('<H',c,pos*2+2)[0];n=struct.unpack_from('<I',c,pos*2+4)[0];step=4+(el*n+1)//2
     else:raise ValueError('Unknown payload '+hex(word))
    pos+=step
   if pos!=len(c)//2:raise ValueError('Instruction overrun')
   return valid
  count=0
  for i in range(u32(96)):
   co=u32(100)+32*i;off=u32(co+24)
   if not off:continue
   nstat,off=uleb(off);ninst,off=uleb(off);ndirect,off=uleb(off);nvirtual,off=uleb(off)
   for _ in range(nstat+ninst):_,off=uleb(off);_,off=uleb(off)
   for n in [ndirect,nvirtual]:
    mi=0
    for _ in range(n):
     delta,off=uleb(off);mi+=delta;_,off=uleb(off);code,off=uleb(off)
     if not code:continue
     c=d[code+16:code+16+2*u32(code+12)];matches=[m for m in pat.finditer(c)if m.start()%2==0]
     if not matches:continue
     valid=boundary(c);hits=[]
     for m in matches:
      if m.start()//2 not in valid:continue
      fi=struct.unpack_from('<H',c,m.start()+2)[0]
      if fi in targets:hits.append({'code_unit_offset':m.start()//2,'opcode':hex(c[m.start()]),'field_index':fi,'field':targets[fi]})
     if hits:
      ci,pi,ni=ms[mi];po=u32(76)+12*pi;ret=ts[u32(po+4)];par=u32(po+8);params=[]if not par else[ts[struct.unpack_from('<H',d,par+4+2*j)[0]]for j in range(u32(par))]
      results.append({'dex':dn,'class':ts[ci],'method':ss[ni],'descriptor':'('+''.join(params)+')'+ret,'method_index':mi,'code_offset':code,'hits':hits});count+=1
  print(dn,'methods',count,flush=True)
ROOT.joinpath((sys.argv[1] if len(sys.argv)>1 else 'feed')+'-caller-instructions.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
for r in results:print(r['dex'],r['class'],r['method'],[(x['field'][1],x['opcode'])for x in r['hits']],flush=True)

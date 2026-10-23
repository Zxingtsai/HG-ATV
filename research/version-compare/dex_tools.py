"""Read-only DEX metadata helpers; normal shell evidence, not REA observations."""
import struct,zipfile,hashlib,json,re,sys,argparse
from pathlib import Path
class Dex:
 def __init__(self,data):
  self.data=data
  self.strings=[self.string(self.u32(self.u32(60)+4*i)) for i in range(self.u32(56))]
  self.types=[self.strings[self.u32(self.u32(68)+4*i)] for i in range(self.u32(64))]
 def u32(self,o):return struct.unpack_from('<I',self.data,o)[0]
 def u16(self,o):return struct.unpack_from('<H',self.data,o)[0]
 def uleb(self,o):
  v=s=0
  while True:
   b=self.data[o];o+=1;v|=(b&127)<<s;s+=7
   if b<128:return v,o
 def string(self,o):
  _,o=self.uleb(o);return self.data[o:self.data.index(0,o)].decode('utf-8','replace')
 def proto(self,i):
  p=self.u32(76)+12*i;off=self.u32(p+8)
  return '('+(''.join(self.types[self.u16(off+4+2*j)] for j in range(self.u32(off))) if off else '')+')'+self.types[self.u32(p+4)]
 def field(self,i):
  ci,ti,ni=struct.unpack_from('<HHI',self.data,self.u32(84)+8*i)
  return {'index':i,'owner':self.types[ci],'name':self.strings[ni],'type':self.types[ti]}
 def method(self,i):
  ci,pi,ni=struct.unpack_from('<HHI',self.data,self.u32(92)+8*i)
  return {'index':i,'owner':self.types[ci],'name':self.strings[ni],'descriptor':self.proto(pi)}
 def annotation(self,o):
  ti,o=self.uleb(o);n,o=self.uleb(o);values={}
  for _ in range(n):ni,o=self.uleb(o);v,o=self.value(o);values[self.strings[ni]]=v
  return {'type':self.types[ti],'values':values},o
 def value(self,o):
  h=self.data[o];o+=1;t=h&31;size=(h>>5)+1
  if t==28:
   n,o=self.uleb(o);arr=[]
   for _ in range(n):v,o=self.value(o);arr.append(v)
   return arr,o
  if t==29:return self.annotation(o)
  if t==30:return None,o
  if t==31:return bool(h>>5),o
  n=int.from_bytes(self.data[o:o+size],'little');o+=size
  if t==23:return self.strings[n],o
  if t==24:return self.types[n],o
  if t in (25,27):return self.field(n),o
  if t==26:return self.method(n),o
  return {'encoded_type':t,'unsigned':n},o
 def annotations(self,o):return [self.annotation(self.u32(o+4+4*i)+1)[0] for i in range(self.u32(o))] if o else []
 def classes(self):
  for i in range(self.u32(96)):
   o=self.u32(100)+32*i
   yield self.types[self.u32(o)],o
 def class_info(self,desc):
  for name,o in self.classes():
   if name!=desc:continue
   ci,flags,superi,inter,source,anno,encoded,static=struct.unpack_from('<8I',self.data,o)
   result={'class':name,'access_flags':flags,'source_file':self.strings[source] if source!=0xffffffff else None,'super':self.types[superi] if superi!=0xffffffff else None,'interfaces':[self.types[self.u16(inter+4+2*j)] for j in range(self.u32(inter))] if inter else [],'fields':[],'methods':[],'annotations':[]}
   fa={};ma={}
   if anno:
    ca,nf,nm,np=struct.unpack_from('<4I',self.data,anno);result['annotations']=self.annotations(ca)
    for j in range(nf):idx,off=struct.unpack_from('<2I',self.data,anno+16+8*j);fa[idx]=self.annotations(off)
    for j in range(nm):idx,off=struct.unpack_from('<2I',self.data,anno+16+8*nf+8*j);ma[idx]=self.annotations(off)
   if encoded:
    counts=[]
    for _ in range(4):n,encoded=self.uleb(encoded);counts.append(n)
    for count in counts[:2]:
     idx=0
     for _ in range(count):
      diff,encoded=self.uleb(encoded);idx+=diff;access,encoded=self.uleb(encoded)
      result['fields'].append(dict(self.field(idx),access_flags=access,annotations=fa.get(idx,[])))
    for count in counts[2:]:
     idx=0
     for _ in range(count):
      diff,encoded=self.uleb(encoded);idx+=diff;access,encoded=self.uleb(encoded);code,encoded=self.uleb(encoded)
      result['methods'].append(dict(self.method(idx),access_flags=access,code_offset=code,annotations=ma.get(idx,[])))
   return result
  return None

def descriptor(s):return s if s.startswith('L') and s.endswith(';') else 'L'+s.replace('.','/')+';'
def iter_dex(apk):
 with zipfile.ZipFile(apk) as z:
  for name in z.namelist():
   if re.fullmatch(r'classes(?:\d+)?\.dex',name):yield name,z.read(name)
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=['index','classes','strings']);p.add_argument('apk');p.add_argument('out');p.add_argument('selectors',nargs='*');a=p.parse_args();out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
 index={};inventory=[];results=[];wanted={descriptor(x) for x in a.selectors}
 for name,data in iter_dex(a.apk):
  d=Dex(data);inventory.append({'member':name,'sha256':hashlib.sha256(data).hexdigest(),'classes':d.u32(96),'strings':d.u32(56)})
  if a.command=='index':
   for cls,_ in d.classes():index[cls]=name
  elif a.command=='classes':
   for cls,_ in d.classes():
    if cls in wanted:results.append({'dex':name,'dex_sha256':hashlib.sha256(data).hexdigest(),**d.class_info(cls)})
  else:
   regex=re.compile(a.selectors[0],re.I)
   for i,s in enumerate(d.strings):
    if regex.search(s):results.append({'dex':name,'string_index':i,'value':s})
 identity={'apk_path':str(Path(a.apk).resolve()),'sha256':hashlib.sha256(Path(a.apk).read_bytes()).hexdigest(),'scope':'Declared DEX metadata and literal strings only; static shell parser, no execution; UTF-8 decode replaces invalid/MUTF sequences.','dex':inventory}
 (out/'identity.json').write_text(json.dumps(identity,indent=2))
 if a.command=='index':
  (out/'class-index.json').write_text(json.dumps(index));print('indexed',len(index),'classes in',len(inventory),'DEX',flush=True)
 else:
  (out/(a.command+'.json')).write_text(json.dumps(results,ensure_ascii=False,indent=2));print(a.command,len(results),'records',flush=True)
if __name__=='__main__':main()

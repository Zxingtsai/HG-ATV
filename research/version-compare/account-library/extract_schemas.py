"""Declared fields and serialized names only; no server response was requested."""
import json,sys,zipfile,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]));from dex_tools import Dex
OUT=Path(__file__).parent;ROOT=OUT.parents[2]
names=['GetBookShelfVideoInfoRequest','GetBookShelfVideoInfoResponse','GetBookShelfVideoInfoData','BookShelfVideoData','VideoData','UpdateBookShelfVideoInfoRequest','UpdateBookShelfVideoInfoResponse','UpdateBookShelfVideo','GetBookShelfVideoListRequest','GetBookShelfVideoListResponse','GetBookShelfVideoListData','VideoShelfOperateType','ReadingBookType','LightBookShelfVideoData']
for ver,apk,index in [('old',ROOT/'research/version-compare/hongguo-6.2.3.32.apk',ROOT/'research/version-compare/old/class-index.json'),('new',ROOT/'research/hongguo.apk',ROOT/'research/class-index.json')]:
 idx=json.load(open(index));wanted={'Lcom/dragon/read/rpc/model/'+n+';' for n in names};records=[]
 with zipfile.ZipFile(apk) as z:
  for member in sorted({idx[n] for n in wanted if n in idx}):
   data=z.read(member);d=Dex(data)
   for n in sorted(wanted):
    if idx.get(n)!=member:continue
    info=d.class_info(n)
    fields=[]
    for f in info['fields']:
     if f['access_flags']&8:continue
     fields.append({'java_name':f['name'],'type':f['type'],'serialized_name':next((a['values'].get('value') for a in f['annotations'] if a['type'].endswith('SerializedName;')),None),'generic_signature':next((a['values'].get('value') for a in f['annotations'] if a['type'].endswith('Signature;')),None)})
    records.append({'class':n,'dex':member,'dex_sha256':hashlib.sha256(data).hexdigest(),'super':info['super'],'fields':fields,'static_field_names':[f['name'] for f in info['fields'] if f['access_flags']&8]})
 (OUT/(ver+'-model-schemas.json')).write_text(json.dumps({'apk_sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'evidence_type':'ordinary static declared DEX metadata, not REA and not a captured response','models':records},ensure_ascii=False,indent=2))
 print(ver,len(records))

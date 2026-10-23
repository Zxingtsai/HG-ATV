"""Read-only, scoped REA evidence collection through the existing serialized bridge."""
import urllib.request,json,zipfile,hashlib
from pathlib import Path
OUT=Path(__file__).parent;ROOT=OUT.parents[2]
plans=[
 ('old-business','research/version-compare/hongguo-6.2.3.32.apk','classes12.dex','com.dragon.read.pages.video.e$q','run','()V'),
 ('new-business','research/hongguo.apk','classes7.dex','com.dragon.read.pages.video.VideoCollDataServer','k','(Lcom/dragon/read/base/util/callback/Callback;)V'),
 ('old-account','research/version-compare/hongguo-6.2.3.32.apk','classes2.dex','com.dragon.read.user.AccountServiceImpl','getSessionKey','()Ljava/lang/String;'),
 ('new-account','research/hongguo.apk','classes11.dex','com.dragon.read.user.AccountServiceImpl','getSessionKey','()Ljava/lang/String;'),
]
def call(name,args,stem):
 req=urllib.request.Request('http://127.0.0.1:8780',data=json.dumps({'name':name,'arguments':args}).encode(),headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=600) as response:result=json.load(response)
 (OUT/(stem+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2));ev=result.get('result',{}).get('structuredContent',{})
 print(stem,ev.get('evidence_id'),result.get('result',{}).get('isError'),flush=True)
 return ev
for label,apk,dex,cls,method,desc in plans:
 apk=ROOT/apk;carrier=OUT/(label+'-carrier.apk')
 with zipfile.ZipFile(apk) as z,zipfile.ZipFile(carrier,'w',zipfile.ZIP_DEFLATED) as dst:
  data=z.read(dex);dst.writestr('AndroidManifest.xml',z.read('AndroidManifest.xml'));dst.writestr('classes.dex',data)
 (OUT/(label+'-carrier-provenance.json')).write_text(json.dumps({'source_apk':str(apk),'source_apk_sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'source_dex':dex,'source_dex_sha256':hashlib.sha256(data).hexdigest(),'carrier':str(carrier.resolve()),'carrier_sha256':hashlib.sha256(carrier.read_bytes()).hexdigest(),'scope':'Manifest and one byte-identical DEX in reduced unsigned carrier; static inspection only, never launched. Other DEX references may be unresolved.'},indent=2))
 inv=call('inspect_android_class',{'path':str(carrier.resolve()),'class_name':cls},'rea-'+label+'-class')
 choices=[m for m in inv.get('normalized_result',{}).get('methods',[]) if m['name']==method and m.get('dex_descriptor')==desc]
 if len(choices)!=1:print('SELECTOR_UNRESOLVED',label,flush=True);continue
 call('inspect_android_method',{'path':str(carrier.resolve()),'class_name':cls,'method_name':method,'overload_index':choices[0]['overload_index']},'rea-'+label+'-method')

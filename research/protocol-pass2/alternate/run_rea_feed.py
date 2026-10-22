"""Independent bounded REA stdio pass for selected original feed consumers."""
import json,os,subprocess,zipfile,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parent;SOURCE=ROOT.parents[1]/'hongguo.apk';CARRIER=ROOT/'analysis-feed-slice.apk'
members=[]
with zipfile.ZipFile(SOURCE) as src, zipfile.ZipFile(CARRIER,'w',zipfile.ZIP_DEFLATED) as out:
 for name in ['AndroidManifest.xml','resources.arsc','classes6.dex','classes7.dex']:
  data=src.read(name);out.writestr(name,data);members.append({'member':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
ROOT.joinpath('analysis-feed-slice-provenance.json').write_text(json.dumps({'source_apk_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'derived_apk_sha256':hashlib.sha256(CARRIER.read_bytes()).hexdigest(),'limitations':'Unsigned offline analysis carrier containing only byte-identical original classes6.dex/classes7.dex, manifest and resources; excludes other DEX/native/runtime behavior. Not installable and not a third-party client.','members':members},indent=2))
env=dict(os.environ,REA_JADX_MCP_JAR='/workspace/tools/jadx-headless-mcp-0.7.1-all.jar',REA_JADX_HEAP_MIB='2048',REA_JADX_OPERATION_TIMEOUT_MS='180000')
process=subprocess.Popen(['node','/home/agent/.npm/_npx/a1722018f28f9df2/node_modules/rea-agents/scripts/rea.mjs','mcp'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=open(ROOT/'rea-feed.stderr.log','w'),text=True,env=env)
serial=0

def rpc(method,params):
 global serial
 serial+=1;ident=serial;process.stdin.write(json.dumps({'jsonrpc':'2.0','id':ident,'method':method,'params':params})+'\n');process.stdin.flush()
 while True:
  line=process.stdout.readline()
  if not line:raise RuntimeError('REA exited')
  response=json.loads(line)
  if response.get('id')==ident:return response

def call(name,arguments,file):
 result=rpc('tools/call',{'name':name,'arguments':arguments});ROOT.joinpath(file+'.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
 evidence=result.get('result',{}).get('structuredContent')
 if not evidence:
  blocks=result.get('result',{}).get('content',[])
  for block in blocks:
   if block.get('type')=='text':
    try:evidence=json.loads(block['text']);break
    except ValueError:pass
 if not evidence:raise RuntimeError('No evidence '+file)
 if evidence.get('error'):raise RuntimeError(str(evidence['error']))
 print(file,evidence.get('evidence_id'),flush=True)
 return evidence

def method(class_name,method_name,descriptor,label):
 inventory=call('inspect_android_class',{'path':str(CARRIER),'class_name':class_name},label+'-class')
 methods=inventory['normalized_result']['methods'];selected=[m for m in methods if m['name']==method_name and m.get('dex_descriptor')==descriptor]
 if len(selected)!=1:raise RuntimeError('Ambiguous method '+label+str(selected))
 evidence=call('inspect_android_method',{'path':str(CARRIER),'class_name':class_name,'method_name':method_name,'overload_index':selected[0]['overload_index']},label+'-method')
 normalized=evidence['normalized_result'];ROOT.joinpath(label+'-source.txt').write_text(normalized.get('source',{}).get('text',''))
 print('source_chars',len(normalized.get('source',{}).get('text','')),flush=True)

try:
 rpc('initialize',{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'alternate-feed-offline','version':'1'}})
 process.stdin.write(json.dumps({'jsonrpc':'2.0','method':'notifications/initialized'})+'\n');process.stdin.flush()
 call('inspect_android_package',{'path':str(CARRIER),'detail':'summary'},'feed-package')
 method('com.dragon.read.pages.bookmall.model.VideoTabModel$VideoData','f','(Lcom/dragon/read/rpc/model/VideoData;)Lcom/dragon/read/pages/bookmall/model/VideoTabModel$VideoData;','video-tab-data-f')
 method('ov5.s','M','(Lcom/dragon/read/rpc/model/CellViewData;ILjava/lang/String;JLjava/lang/String;)Lpv5/c;','ov5-s-M')
 call('export_evidence_bundle',{'path':str(ROOT/'rea-feed-evidence-bundle.json')},'rea-feed-export')
finally:
 process.terminate()
 try:process.wait(timeout=15)
 except subprocess.TimeoutExpired:process.kill();process.wait()

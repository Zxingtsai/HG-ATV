"""Local stdin controller for an independent REA stdio session; no listening ports."""
import os,json,sys,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent
env=dict(os.environ,REA_JADX_MCP_JAR='/workspace/tools/jadx-headless-mcp-0.7.1-all.jar',REA_JADX_HEAP_MIB='2048',REA_JADX_OPERATION_TIMEOUT_MS='180000')
p=subprocess.Popen(['node','/home/agent/.npm/_npx/a1722018f28f9df2/node_modules/rea-agents/scripts/rea.mjs','mcp'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=open(ROOT/'rea-stdio.stderr.log','a'),text=True,env=env);ident=0

def rpc(method,params):
 global ident
 ident+=1;i=ident;p.stdin.write(json.dumps({'jsonrpc':'2.0','id':i,'method':method,'params':params})+'\n');p.stdin.flush()
 while True:
  line=p.stdout.readline()
  if not line:raise RuntimeError('REA exited')
  response=json.loads(line)
  if response.get('id')==i:return response
try:
 rpc('initialize',{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'alternate-feed-offline','version':'2'}})
 p.stdin.write(json.dumps({'jsonrpc':'2.0','method':'notifications/initialized'})+'\n');p.stdin.flush()
 print('READY',flush=True)
 for line in sys.stdin:
  c=json.loads(line)
  if c.get('quit'):break
  response=rpc('tools/call',{'name':c['name'],'arguments':c['arguments']});out=ROOT/c['output'];out.write_text(json.dumps(response,ensure_ascii=False,indent=2))
  e=response.get('result',{}).get('structuredContent')
  if not e:
   for block in response.get('result',{}).get('content',[]):
    if block.get('type')=='text':
     try:e=json.loads(block['text']);break
     except ValueError:pass
  if e:
   n=e.get('normalized_result',e);print('RESULT',out.name,e.get('evidence_id'),'KEYS',list(n),flush=True)
   print(json.dumps(n,ensure_ascii=False)[:18000],flush=True)
   if isinstance(n.get('source'),dict):out.with_suffix('.source.txt').write_text(n['source'].get('text',''))
  else:print(str(response)[:1000],flush=True)
finally:
 p.terminate()
 try:p.wait(timeout=15)
 except subprocess.TimeoutExpired:p.kill();p.wait()

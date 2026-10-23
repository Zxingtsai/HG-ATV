// Static REA reproduction. Requires an existing pinned rea-agents installation.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const [apkArg,outArg,...labels]=process.argv.slice(2);
if(!apkArg||!outArg||!process.env.REA_INSTALL) throw Error('Usage: REA_INSTALL=/path/to/npm-prefix node replay.mjs APK NEW_OUTPUT_DIR [record labels without .json]');
const apk=resolve(apkArg),out=resolve(outArg),install=resolve(process.env.REA_INSTALL);
const index=JSON.parse(await readFile(new URL('./evidence-index.json',import.meta.url),'utf8'));
const sha=createHash('sha256').update(await readFile(apk)).digest('hex');
if(sha!==index.apk.sha256) throw Error('APK SHA-256 differs from the inspected original');
if(!process.env.REA_JADX_MCP_JAR)throw Error('Set REA_JADX_MCP_JAR to the pinned engine');
const jarSha=createHash('sha256').update(await readFile(process.env.REA_JADX_MCP_JAR)).digest('hex');
if(jarSha!==index.engine.sha256)throw Error('JADX JAR SHA-256 differs from the pinned engine');
const pkg=JSON.parse(await readFile(join(install,'node_modules/rea-agents/package.json'),'utf8'));
if(pkg.version!=='6.7.0')throw Error('This recipe pins rea-agents 6.7.0');
const selected=index.records.filter(r=>!labels.length||labels.includes(r.record.replace(/\.json$/,'')));
if(!selected.length||labels.some(l=>!selected.some(r=>r.record===l+'.json')))throw Error('Unknown/empty record selection');
await mkdir(out); // Deliberately refuses to overwrite an existing evidence directory.
const {Client}=await import(pathToFileURL(join(install,'node_modules/@modelcontextprotocol/client/dist/index.mjs')));
const {StdioClientTransport}=await import(pathToFileURL(join(install,'node_modules/@modelcontextprotocol/client/dist/stdio.mjs')));
const client=new Client({name:'hg-old-reproduction',version:'1.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[join(install,'node_modules/rea-agents/scripts/rea.mjs'),'mcp'],env:{...process.env,REA_JADX_HEAP_MIB:'4096',REA_JADX_ACTIVE_PROCESSOR_COUNT:'2',REA_JADX_OPERATION_TIMEOUT_MS:'600000'},stderr:'inherit'});
let failed=false;
try{
 await client.connect(transport);
 for(const r of selected){
  const args={...r.arguments,path:apk},start=Date.now();
  try{
   // MCP SDK 2.x accepts request options as the SECOND argument.
   const result=await client.callTool({name:r.tool,arguments:args},{timeout:660000});
   await writeFile(join(out,r.record),JSON.stringify({started_at:new Date(start).toISOString(),duration_ms:Date.now()-start,request:{name:r.tool,arguments:args},result},null,2)+'\n');
   console.log(r.record,result.isError?'error':'saved');failed ||= !!result.isError;
  }catch(error){
   failed=true;await writeFile(join(out,r.record),JSON.stringify({request:{name:r.tool,arguments:args},error:String(error),duration_ms:Date.now()-start},null,2)+'\n');
   console.error(r.record,String(error));
  }
 }
 const exported=await client.callTool({name:'export_evidence_bundle',arguments:{path:join(out,'session-bundle.json')}},{timeout:660000});
 await writeFile(join(out,'export-result.json'),JSON.stringify(exported,null,2)+'\n');
 failed ||= !!exported.isError;
}finally{await client.close();}
process.exitCode=failed?1:0;

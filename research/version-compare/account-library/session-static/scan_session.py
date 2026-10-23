import sys,json,re,hashlib,struct
from pathlib import Path
sys.path.insert(0,str(Path('research/version-compare').resolve()))
from dex_tools import Dex,iter_dex
OUT=Path('research/version-compare/account-library/session-static')
regex=re.compile(r'^(sessionid(?:_ss)?|session_id|sid_guard|sid_tt|sid_ucp(?:_sso_v1)?|uid_tt(?:_ss)?|Cookie|Set-Cookie|cookie|session_key|tt_sessionid|passport_csrf_token|login_user_info|user_info|userInfo|account_session|session_token|token)$|(?:^https?://|^/).*(?:passport|accounts?)/(?:.*(?:login|logout|user|info|session).*)',re.I)
for ver,apk in [('old','research/version-compare/hongguo-6.2.3.32.apk'),('new','research/hongguo.apk')]:
 records=[];inventory=[]
 for member,data in iter_dex(apk):
  d=Dex(data);matched={i:s for i,s in enumerate(d.strings) if regex.search(s)}
  inventory.append({'member':member,'sha256':hashlib.sha256(data).hexdigest(),'matched_literals':matched})
  if not matched:continue
  for cls,o in d.classes():
   encoded=d.u32(o+24)
   if not encoded:continue
   counts=[]
   for _ in range(4):n,encoded=d.uleb(encoded);counts.append(n)
   for count in counts[:2]:
    for _ in range(count):_,encoded=d.uleb(encoded);_,encoded=d.uleb(encoded)
   for count in counts[2:]:
    idx=0
    for _ in range(count):
     diff,encoded=d.uleb(encoded);idx+=diff;access,encoded=d.uleb(encoded);code,encoded=d.uleb(encoded)
     if not code:continue
     words=struct.unpack_from('<'+'H'*d.u32(code+12),data,code+16);hits=[]
     # Candidate scan only: 16-bit code units, verified via dexdump before conclusions.
     for pos,word in enumerate(words):
      if word&255==0x1a and pos+1<len(words):si=words[pos+1]
      elif word&255==0x1b and pos+2<len(words):si=words[pos+1]|words[pos+2]<<16
      else:continue
      if si in matched:hits.append({'code_unit':pos,'string_index':si,'literal':matched[si]})
     if hits:records.append({'dex':member,'class':cls,'method':d.method(idx),'code_offset':code,'candidate_string_uses':hits})
 (OUT/(ver+'-session-string-candidates.json')).write_text(json.dumps(records,ensure_ascii=False,indent=2))
 (OUT/(ver+'-identity.json')).write_text(json.dumps({'apk_path':str(Path(apk).resolve()),'apk_sha256':hashlib.sha256(Path(apk).read_bytes()).hexdigest(),'evidence_type':'normal DEX static scan, not REA or runtime','dex_inventory':inventory},ensure_ascii=False,indent=2))
 print(ver,'records',len(records),flush=True)
 relevant=[r for r in records if any(re.search('sessionid|sid_guard|passport_csrf',s['literal']) for s in r['candidate_string_uses'])]
 for r in relevant:print(r['dex'],r['class'],r['method']['name'],[s['literal'] for s in r['candidate_string_uses']],flush=True)

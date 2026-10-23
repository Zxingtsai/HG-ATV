from pathlib import Path
import zipfile,hashlib,json,re,subprocess,datetime
p=Path(__file__).parent
old=Path('/workspace/hongguo-tv/research/hongguo.apk');new=p/'hongguo-current-normal.apk'
sha=lambda b:hashlib.sha256(b).hexdigest()
def identity(file,label):
 j={'path':str(file),'bytes':file.stat().st_size,'sha256':sha(file.read_bytes())}
 with zipfile.ZipFile(file) as z:
  j['manifestSha256']=sha(z.read('AndroidManifest.xml'))
  j['dex']={n:{'size':z.getinfo(n).file_size,'sha256':sha(z.read(n))} for n in z.namelist() if re.fullmatch(r'classes(?:[2-9]|[1-9]\d+)?\.dex',n)}
  j['members']={x.filename:{'size':x.file_size,'crc32':f'{x.CRC:08x}'} for x in z.infolist()}
 cmds={'certificate':['/workspace/tools/android/build-tools/35.0.0/apksigner','verify','--print-certs',str(file)],'badging':['/workspace/tools/android/build-tools/35.0.0/aapt','dump','badging',str(file)]}
 for kind,cmd in cmds.items():
  r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True);(p/f'{label}-{kind}.txt').write_text(r.stdout);j[kind+'ExitCode']=r.returncode
  if kind=='certificate':j['signerCertificateSha256']=re.findall(r'certificate SHA-256 digest: ([a-f0-9]+)',r.stdout)
  else:j['packageBadging']=r.stdout.splitlines()[0]
 return j
first=identity(old,'existing-sem');second=identity(new,'current-normal')
names=sorted(set(first['dex'])|set(second['dex']),key=lambda s:(len(s),s))
dex=[{'member':n,'existing':first['dex'].get(n),'current':second['dex'].get(n),'same':first['dex'].get(n)==second['dex'].get(n)} for n in names]
entrynames=set(first['members'])|set(second['members']);changed=[n for n in sorted(entrynames) if first['members'].get(n)!=second['members'].get(n)]
j={'comparedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'existing':first,'current':second,'wholeApkSame':first['sha256']==second['sha256'],'manifestSame':first['manifestSha256']==second['manifestSha256'],'certificateSame':first['signerCertificateSha256']==second['signerCertificateSha256'],'dexCount':len(names),'allDexMembersSame':all(x['same'] for x in dex),'dexMembers':dex,'zipMemberCrcOrSizeDifferences':changed,'conclusion':'Different distribution-channel APK bytes; same manifest, signing certificate and all DEX members. Existing APK is the same code baseline as the current ordinary official Android entry.'}
(p/'channel-difference.json').write_text(json.dumps(j,ensure_ascii=False,indent=2))
(p/'identity.json').write_text(json.dumps({k:v for k,v in second.items() if k not in ['members']},ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in j.items() if k not in ['existing','current','dexMembers']},indent=2)); print('badging',second['packageBadging'])

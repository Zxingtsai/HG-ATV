"""Disassemble selected classes from original old APK members; no APK execution."""
import hashlib, json, subprocess, sys, zipfile
from collections import defaultdict
from pathlib import Path
ROOT=Path(__file__).resolve().parent
APK=ROOT.parent/'hongguo-6.2.3.32.apk'
INDEX=json.loads((ROOT.parent/'old/class-index.json').read_text())
groups=defaultdict(set)
for arg in sys.argv[1:]:
    desc=arg if arg.startswith('L') and arg.endswith(';') else 'L'+arg.replace('.','/')+';'
    groups[INDEX[desc]].add(desc)
with zipfile.ZipFile(APK) as apk:
    for member,targets in groups.items():
        data=apk.read(member);path=ROOT/member;path.write_bytes(data)
        proc=subprocess.Popen(['/workspace/tools/android/build-tools/35.0.0/dexdump','-d',str(path)],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,errors='replace')
        current=None;lines=[];found=set()
        def save():
            if current:
                (ROOT/(current[1:-1].replace('/','-')+'.dexdump.txt')).write_text(''.join(lines));found.add(current)
        try:
            for line in proc.stdout:
                if line.startswith('Class #'):
                    save();current=None;lines=[]
                    if found==targets:break
                if 'Class descriptor' in line:
                    d=line.split("'")[1]
                    if d in targets:current=d
                if current:lines.append(line)
            save()
        finally:proc.terminate();proc.wait(timeout=15)
        print(member,sorted(found),flush=True)
        (ROOT/(member+'.dump-provenance.json')).write_text(json.dumps({'member':member,'sha256':hashlib.sha256(data).hexdigest(),'targets':sorted(targets),'found':sorted(found),'decode_errors':'replace display; original DEX bytes unchanged'},indent=2))
        if found!=targets:raise RuntimeError(str(targets-found))

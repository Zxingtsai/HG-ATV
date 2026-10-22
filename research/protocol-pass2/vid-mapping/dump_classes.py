"""Extract exact Android SDK dexdump class blocks from original APK members."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent
APK = ROOT.parents[1] / 'hongguo.apk'
SDK = '/workspace/tools/android/build-tools/35.0.0/dexdump'
member = sys.argv[1]
targets = set(sys.argv[2:])
with zipfile.ZipFile(APK) as archive:
    raw = archive.read(member)
dex = ROOT / member
dex.write_bytes(raw)
observed = {}
proc = subprocess.Popen([SDK, '-d', str(dex)], stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE, text=True, errors='replace')
current = None
lines = []
def save():
    if current:
        dest = ROOT / (current[1:-1].replace('/', '-') + '.dexdump.txt')
        dest.write_text(''.join(lines))
        observed[current] = dest.name
try:
    for line in proc.stdout:
        if line.startswith('Class #'):
            save()
            current, lines = None, []
            if set(observed) == targets:
                break
        if 'Class descriptor' in line:
            descriptor = line.split("'")[1]
            if descriptor in targets:
                current = descriptor
        if current:
            lines.append(line)
    save()
finally:
    proc.terminate()
    proc.wait(timeout=10)
identity = {'source_apk_sha256': hashlib.sha256(APK.read_bytes()).hexdigest(),
            'dex_member': member, 'dex_sha256': hashlib.sha256(raw).hexdigest(),
            'dex_bytes': len(raw), 'requested_classes': sorted(targets),
            'class_outputs': observed, 'method': 'Android SDK 35.0.0 dexdump -d; no APK execution'}
query_digest = hashlib.sha256('\n'.join(sorted(targets)).encode()).hexdigest()[:12]
(ROOT / (member + '.' + query_digest + '.identity.json')).write_text(json.dumps(identity, indent=2))
print(json.dumps(identity, indent=2))

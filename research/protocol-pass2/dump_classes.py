"""Extract selected original DEX class disassemblies, without executing APK code."""
import hashlib
import json
import subprocess
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent
INDEX = json.loads((ROOT / 'class-index.json').read_text())
groups = defaultdict(set)
for name in sys.argv[1:]:
    descriptor = name if name.startswith('L') and name.endswith(';') else 'L' + name.replace('.', '/') + ';'
    groups[INDEX[descriptor]].add(descriptor)

with zipfile.ZipFile(ROOT / 'hongguo.apk') as apk:
    for dex, targets in groups.items():
        data = apk.read(dex)
        local = OUT / dex
        local.write_bytes(data)
        proc = subprocess.Popen(['/workspace/tools/android/build-tools/35.0.0/dexdump', '-d', str(local)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors='replace')
        current = None
        lines = []
        found = set()

        def save():
            if current:
                target = OUT / (current[1:-1].replace('/', '-') + '.dexdump.txt')
                target.write_text(''.join(lines))
                print(target.name, flush=True)
                found.add(current)

        try:
            for line in proc.stdout:
                if line.startswith('Class #'):
                    save()
                    current, lines = None, []
                    if found == targets:
                        break
                if 'Class descriptor' in line:
                    name = line.split("'")[1]
                    if name in targets:
                        current = name
                if current:
                    lines.append(line)
            save()
        finally:
            proc.terminate()
            proc.wait(timeout=15)
        record = {'dex_member': dex, 'sha256': hashlib.sha256(data).hexdigest(),
                  'targets': sorted(targets), 'found': sorted(found),
                  'text_decode_errors': 'replace; source bytes unchanged'}
        (OUT / (dex + '.dump-provenance.json')).write_text(json.dumps(record, indent=2))
        if found != targets:
            raise RuntimeError('Classes missing: ' + str(targets - found))

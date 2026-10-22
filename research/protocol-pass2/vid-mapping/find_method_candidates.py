"""Raw DEX invoke-pattern candidates, requiring independent disassembly confirmation."""
import hashlib
import json
from pathlib import Path
import struct
import sys
import zipfile

ROOT = Path(__file__).resolve().parent
APK = ROOT.parents[1] / 'hongguo.apk'
TARGETS = set(zip(sys.argv[1::2], sys.argv[2::2]))
results = []
with zipfile.ZipFile(APK) as archive:
    for member in archive.namelist():
        if not member.endswith('.dex'):
            continue
        data = archive.read(member)
        def u32(offset): return struct.unpack_from('<I', data, offset)[0]
        def uleb(offset):
            value = shift = 0
            while True:
                byte = data[offset]; offset += 1
                value |= (byte & 127) << shift; shift += 7
                if byte < 128: return value, offset
        def string(offset):
            _, offset = uleb(offset)
            return data[offset:data.index(0, offset)].decode('utf-8', 'replace')
        strings = [string(u32(u32(60) + 4*i)) for i in range(u32(56))]
        types = [strings[u32(u32(68) + 4*i)] for i in range(u32(64))]
        methods = [struct.unpack_from('<HHI', data, u32(92) + 8*i) for i in range(u32(88))]
        target_ids = {i for i, (ci, pi, ni) in enumerate(methods)
                      if (types[ci], strings[ni]) in TARGETS}
        if not target_ids:
            continue
        for i in range(u32(96)):
            class_offset = u32(100) + 32*i
            encoded = u32(class_offset + 24)
            if not encoded: continue
            counts = []
            for _ in range(4):
                n, encoded = uleb(encoded); counts.append(n)
            for _ in range(counts[0] + counts[1]):
                _, encoded = uleb(encoded); _, encoded = uleb(encoded)
            for count in counts[2:]:
                method_id = 0
                for _ in range(count):
                    diff, encoded = uleb(encoded); method_id += diff
                    _, encoded = uleb(encoded); code, encoded = uleb(encoded)
                    if not code: continue
                    length = u32(code + 12)
                    insns = struct.unpack_from('<' + 'H'*length, data, code + 16)
                    for pc in range(max(0, length - 2)):
                        if insns[pc] & 255 not in (0x6e, 0x6f, 0x70, 0x71, 0x72, 0x74, 0x75, 0x76, 0x77, 0x78) or insns[pc+1] not in target_ids:
                            continue
                        ci, pi, ni = methods[method_id]
                        results.append({'dex': member, 'dex_sha256': hashlib.sha256(data).hexdigest(),
                                        'caller_class': types[ci], 'caller_method': strings[ni],
                                        'caller_method_id': method_id, 'code_unit_candidate': pc,
                                        'target_method_id': insns[pc+1], 'target': [types[methods[insns[pc+1]][0]], strings[methods[insns[pc+1]][2]]]})
(ROOT / 'method-candidates.json').write_text(json.dumps({
    'source_apk_sha256': hashlib.sha256(APK.read_bytes()).hexdigest(),
    'targets': sorted(TARGETS), 'limitations': 'Raw code-unit pattern scan; candidates only until SDK dexdump confirms instruction boundaries.',
    'candidates': results}, indent=2))
print(json.dumps(results, indent=2))

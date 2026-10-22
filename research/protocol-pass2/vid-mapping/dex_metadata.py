"""Read declared DEX field names/types and annotations; never execute APK code."""
import hashlib
import json
from pathlib import Path
import struct
import sys
import zipfile

ROOT = Path(__file__).resolve().parent
APK = ROOT.parents[1] / 'hongguo.apk'
member, *targets = sys.argv[1:]
with zipfile.ZipFile(APK) as archive:
    data = archive.read(member)
def u32(offset): return struct.unpack_from('<I', data, offset)[0]
def uleb(offset):
    val = shift = 0
    while True:
        byte = data[offset]; offset += 1
        val |= (byte & 127) << shift; shift += 7
        if byte < 128: return val, offset
def string(offset):
    _, offset = uleb(offset)
    return data[offset:data.index(0, offset)].decode('utf-8', 'replace')
strings = [string(u32(u32(60) + 4*i)) for i in range(u32(56))]
types = [strings[u32(u32(68) + 4*i)] for i in range(u32(64))]
def field(index):
    ci, ti, ni = struct.unpack_from('<HHI', data, u32(84) + 8*index)
    return {'field_id': index, 'class': types[ci], 'name': strings[ni], 'type': types[ti]}
def annotation(offset):
    typ, offset = uleb(offset); count, offset = uleb(offset); vals = {}
    for _ in range(count):
        name, offset = uleb(offset); val, offset = value(offset); vals[strings[name]] = val
    return {'type': types[typ], 'values': vals}, offset
def value(offset):
    header = data[offset]; offset += 1; typ = header & 31; size = (header >> 5) + 1
    if typ == 28:
        count, offset = uleb(offset); arr = []
        for _ in range(count):
            val, offset = value(offset); arr.append(val)
        return arr, offset
    if typ == 29: return annotation(offset)
    if typ == 30: return None, offset
    if typ == 31: return header >> 5, offset
    val = int.from_bytes(data[offset:offset+size], 'little'); offset += size
    if typ == 23: return strings[val], offset
    if typ == 24: return types[val], offset
    if typ in (25, 27): return field(val), offset
    return {'encoded_type': typ, 'raw_unsigned': val}, offset
def annotations(offset):
    return [annotation(u32(offset+4+4*i)+1)[0] for i in range(u32(offset))]
result = []
for i in range(u32(96)):
    offset = u32(100) + 32*i; typ = types[u32(offset)]
    if typ not in targets: continue
    directory = u32(offset+20); encoded = u32(offset+24); field_ids = []
    if encoded:
        counts = []
        for _ in range(4):
            count, encoded = uleb(encoded); counts.append(count)
        for count in counts[:2]:
            index = 0
            for _ in range(count):
                diff, encoded = uleb(encoded); index += diff
                _, encoded = uleb(encoded); field_ids.append(index)
    annotated = {}
    if directory:
        for j in range(u32(directory+4)):
            index, annotation_offset = struct.unpack_from('<II', data, directory+16+8*j)
            annotated[index] = annotations(annotation_offset)
    result.append({'class': typ, 'fields': [dict(field(index), annotations=annotated.get(index, [])) for index in field_ids]})
out = {'source_apk_sha256': hashlib.sha256(APK.read_bytes()).hexdigest(),
       'dex_member': member, 'dex_sha256': hashlib.sha256(data).hexdigest(),
       'scope': 'Selected declared field IDs and field annotations; no execution, runtime values, or method behavior.',
       'classes': result}
print(json.dumps(out, ensure_ascii=False, indent=2))

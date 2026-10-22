"""Save one read-only REA query through the existing local research bridge."""
import json
import sys
import urllib.request
from pathlib import Path

name, argument_json, output = sys.argv[1:]
payload = {'name': name, 'arguments': json.loads(argument_json)}
request = urllib.request.Request('http://127.0.0.1:8777',
    data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(request, timeout=270) as response:
    result = json.load(response)
Path(output).write_text(json.dumps(result, ensure_ascii=False, indent=2))
record = result.get('result', {}).get('structuredContent')
if record:
    print('Evidence:', record.get('evidence_id'), flush=True)
    normalized = record.get('normalized_result', {})
    print(json.dumps(normalized, ensure_ascii=False)[:16000], flush=True)
else:
    print(json.dumps(result, ensure_ascii=False)[:2500], flush=True)
if result.get('error') or result.get('result', {}).get('isError'):
    sys.exit(1)

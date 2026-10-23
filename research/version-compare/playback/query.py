"""Save focused read-only REA results through the task bridge."""
import json, sys, urllib.request
from pathlib import Path
name, raw_args, output = sys.argv[1:]
req = urllib.request.Request('http://127.0.0.1:8780', data=json.dumps({'name': name, 'arguments': json.loads(raw_args)}).encode(), headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(req, timeout=290) as response:
    result = json.load(response)
Path(output).write_text(json.dumps(result, ensure_ascii=False, indent=2))
e = result.get('result', {}).get('structuredContent', {})
print('Evidence:', e.get('evidence_id'), flush=True)
n = e.get('normalized_result', {})
print(json.dumps(n, ensure_ascii=False)[:18000] if n else json.dumps(result, ensure_ascii=False)[:1800], flush=True)

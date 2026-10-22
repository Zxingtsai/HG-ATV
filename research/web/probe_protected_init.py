#!/usr/bin/env python3
"""Inspect MP4 initialization metadata only; no decryption or playback is attempted."""
import json
from urllib.request import Request, urlopen
from probe_website import request, OUT, UA

response=request('/api/video/protected/play-info',body={'series_id':'7690961604636052505','item_id':'7690963410778868761','definition':'720p'})
info=json.loads(response['data']).get('play_info',{})
checks={}
for label,obj in [('video',info),('audio',info.get('audio',{}))]:
    try:
        with urlopen(Request(obj['main_url'],headers={'Range':'bytes=0-4095','User-Agent':UA}),timeout=25) as response:
            source=response.read(4096)
            checks[label]={'status':response.status,'content_type':response.headers.get('Content-Type'),'content_range':response.headers.get('Content-Range'),'bytes_read':len(source),'markers':{marker.decode():source.find(marker) for marker in [b'encv',b'enca',b'sinf',b'tenc',b'cenc',b'pssh',b'sidx',b'moov']}}
    except Exception as error:checks[label]={'error':str(error)}
OUT.joinpath('protected-media-observation.json').write_text(json.dumps(checks,indent=2))
print(json.dumps(checks,indent=2))

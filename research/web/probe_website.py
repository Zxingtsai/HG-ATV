#!/usr/bin/env python3
"""Reproduce anonymous official-site catalogue and episode availability observations.
No login, decryption, signature generation or private API emulation is performed.
"""
from __future__ import annotations
import argparse, concurrent.futures, datetime, hashlib, html, json, re
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = 'https://hongguoduanju.com'
OUT = Path(__file__).resolve().parent
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36'

class Scripts(HTMLParser):
    def __init__(self): super().__init__(); self.scripts=[]
    def handle_starttag(self, tag, attrs):
        if tag=='script': self.scripts.append(dict(attrs))

def router_data(source):
    match = re.search(r'_ROUTER_DATA\s*=\s*',source)
    if not match: raise ValueError('No official router-data assignment')
    result = json.JSONDecoder().raw_decode(source[match.end():])[0]
    parser=Scripts();parser.feed(source)
    for attrs in parser.scripts:
        raw=attrs.get('data-fn-args')
        if not raw: continue
        args=json.loads(raw)
        if attrs.get('data-fn-name')=='r':
            route,key,value,*_=args
            result['loaderData'].setdefault(route,{})[key]=value
        elif attrs.get('data-fn-name')=='mergeLoaderData':
            route,items=args
            for item in items:
                values=[json.loads(v) for v in item['routerDataFnArgs']]
                if item['routerDataFnName']=='p' and values:
                    result['loaderData'].setdefault(route,{})[item['key']]=values[0]
    return result

def request(path, *, body=None, limit=None, headers=None):
    extra={'User-Agent':UA,'Referer':BASE+'/'};extra.update(headers or {})
    if body is not None: extra['Content-Type']='application/json'
    req=Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,headers=extra)
    try:
        with urlopen(req,timeout=35) as response:
            data=response.read(limit) if limit else response.read()
            return {'status':response.status,'type':response.headers.get('Content-Type'),'length':response.headers.get('Content-Length'),'range':response.headers.get('Content-Range'),'url':response.url,'data':data}
    except HTTPError as error:
        return {'status':error.code,'type':error.headers.get('Content-Type'),'data':error.read(2048)}

def page(path):
    response=request(path)
    if response['status']!=200: raise ValueError(f'{path}: HTTP {response["status"]}')
    source=response['data'].decode();data=router_data(source)
    identity=hashlib.sha256(path.encode()).hexdigest()[:12]
    (OUT/f'page-{identity}.json').write_text(json.dumps(data,ensure_ascii=False,indent=2))
    return data

def values(data): return [value for value in data['loaderData'].values() if isinstance(value,dict)]

def redact_playback_metadata(value):
    # Retain schema/status evidence without retaining ephemeral playback credentials.
    if isinstance(value,dict):
        return {key: ('<redacted>' if key in ('kid','player_access_key','play_auth_token','spade_a') else ('<signed media URL redacted>' if key in ('main_url','backup_url','backup_url_1') else redact_playback_metadata(item))) for key,item in value.items()}
    if isinstance(value,list): return [redact_playback_metadata(item) for item in value]
    return value

def episode_probe(series_id,item_id,index):
    result={'series_id':series_id,'episode':index,'item_id':item_id}
    try:
        data=page(f'/player/{series_id}/{item_id}');route=next(v for v in values(data) if 'seriesDetail' in v)
        result.update(page_success=route.get('isSuccess'),page_vid=route.get('vid'),public_video_seo=route.get('publicVideoSeo'),protected_playback=route.get('protectedPlayback'))
    except Exception as error: result['page_error']=str(error)
    public=request(f'/video/public/{item_id}/360p.mp4',limit=128,headers={'Range':'bytes=0-127'})
    result['public_mp4']={k:v for k,v in public.items() if k not in ('data','url')}
    result['public_mp4']['sample_hex']=public['data'][:24].hex()
    if not (public.get('type') or '').startswith('video/'): result['public_mp4']['error_body']=public['data'].decode(errors='replace')[:300]
    protected=request('/api/video/protected/play-info',body={'series_id':series_id,'item_id':item_id,'definition':'720p'})
    result['protected_api']={'status':protected['status'],'type':protected.get('type')}
    try:
        protected_json=json.loads(protected['data']);result['protected_api']['body']=redact_playback_metadata(protected_json)
    except ValueError:result['protected_api']['body']=protected['data'].decode(errors='replace')[:300]
    return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--series',nargs='*',default=['7690961604636052505','7694653385668037657','7697852455970671678']);args=parser.parse_args()
    summary={'observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'base_url':BASE,'catalogue':{},'series':[],'episode_probes':[]}
    for path in ['/', '/category/real-drama','/category/real-drama?page=2','/rank/hot-drama','/search/'+quote('军需处长')]:
        try:
            data=page(path);routes=values(data)
            entry={key:value for route in routes for key,value in route.items() if key in ('isSuccess','pagination','totalCount','accessibleEpisodeCnt')}
            entry['routes']={k:list(v) if isinstance(v,dict) else None for k,v in data['loaderData'].items()}
            entry['list_counts']={key:len(route[key]) for route in routes for key in ('homeSections','recommendList','searchList') if isinstance(route.get(key),list)}
            for route in routes:
                if isinstance(route.get('content'),dict):entry['rank_count']=len(route['content'].get('rankList',[]))
            summary['catalogue'][path]=entry
        except Exception as error:summary['catalogue'][path]={'error':str(error)}
    probes=[]
    for series_id in args.series:
        data=page('/detail?series_id='+series_id);detail=next(v['seriesDetail'] for v in values(data) if 'seriesDetail' in v)
        ids=detail.get('vid_list',[])
        summary['series'].append({k:detail.get(k) for k in ('series_id','series_name','episode_cnt','accessible_episode_cnt','series_episode_info')}|{'vid_list_count':len(ids)})
        positions=sorted(set([0,1,2,len(ids)//2,len(ids)-1]))
        probes.extend((series_id,ids[index],index+1) for index in positions if index<len(ids))
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for result in pool.map(lambda probe:episode_probe(*probe),probes):
            summary['episode_probes'].append(result)
            (OUT/'observations.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
            print(result['series_id'],result['episode'],'page=',result.get('page_success'),'public=',result['public_mp4']['status'],'protected=',result['protected_api']['status'],flush=True)
    dest=OUT/'observations.json';dest.write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(dest)

if __name__=='__main__':main()

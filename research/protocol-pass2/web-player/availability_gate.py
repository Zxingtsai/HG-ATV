"""Bounded catalogue/first-middle-last availability check; no key retention."""
import concurrent.futures
import argparse
import datetime
import json
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / 'web'))
from probe_website import router_data

BASE = 'https://hongguoduanju.com'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36'
SERIES = ['7690961604636052505', '7693806079737613336', '7530119479875882009', '7503745441910017049']


def get_detail(series):
    with urlopen(Request(BASE + '/detail?series_id=' + series, headers={'User-Agent': UA}), timeout=35) as response:
        data = router_data(response.read(4 * 1024 * 1024).decode())
    return next(v['seriesDetail'] for v in data['loaderData'].values() if isinstance(v, dict) and 'seriesDetail' in v)


def probe(case):
    series, item, index = case
    result = {'series_id': series, 'item_id': item, 'episode': index}
    payload = {'series_id': series, 'item_id': item, 'definition': '720p'}
    request = Request(BASE + '/api/video/protected/play-info', data=json.dumps(payload).encode(),
        headers={'User-Agent': UA, 'Content-Type': 'application/json', 'Referer': BASE + '/'})
    try:
        try:
            response = urlopen(request, timeout=35)
        except HTTPError as error:
            response = error
        with response:
            result['protected_status'] = response.status
            data = json.load(response)
        info = data.get('play_info')
        result['protected_available'] = isinstance(info, dict) and bool(info.get('main_url'))
        if result['protected_available']:
            result.update(vid=info.get('vid'), duration=info.get('duration'), codec=info.get('codec_type'))
        else:
            result['protected_error'] = data.get('error')
    except Exception as error:
        result['protected_failure_type'] = type(error).__name__
    if not result.get('protected_available'):
        try:
            request = Request(BASE + '/video/public/' + item + '/360p.mp4',
                headers={'User-Agent': UA, 'Referer': BASE + '/', 'Range': 'bytes=0-63'})
            with urlopen(request, timeout=30) as response:
                head = response.read(64)
                result['public_status'] = response.status
                result['public_available'] = response.status in (200, 206) and head[4:8] == b'ftyp'
                result['public_range'] = response.headers.get('Content-Range')
        except HTTPError as error:
            result.update(public_status=error.code, public_available=False)
        except Exception as error:
            result['public_failure_type'] = type(error).__name__
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--series', nargs='+', default=SERIES)
    parser.add_argument('--out', default='availability-gate.json')
    options = parser.parse_args()
    result = {'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'scope': 'four declared series, first/middle/last; availability is not complete decode', 'series': [], 'probes': []}
    cases = []
    for series in options.series:
        try:
            detail = get_detail(series)
            ids = detail['vid_list']
            result['series'].append({'series_id': series, 'name': detail.get('series_name'),
                'episodes': len(ids), 'accessible_episode_cnt': detail.get('accessible_episode_cnt')})
            cases.extend((series, str(ids[i]), i + 1) for i in sorted({0, len(ids) // 2, len(ids) - 1}))
        except Exception as error:
            result['series'].append({'series_id': series, 'error_type': type(error).__name__})
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for entry in pool.map(probe, cases):
            result['probes'].append(entry)
            print(json.dumps(entry, ensure_ascii=False), flush=True)
            (HERE / options.out).write_text(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

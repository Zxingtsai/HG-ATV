#!/usr/bin/env python3
"""Bounded anonymous search pagination probe; saves only public catalogue evidence."""
import argparse
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import sys
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'web'))
from probe_website import request


def fetch_page(query, page):
    path = '/api/search/result?' + urlencode({'query': query, 'page': page})
    attempts = []
    result = {'page_requested': page, 'path': path, 'attempts': attempts}
    for _ in range(3):
        try:
            response = request(path)
            body = json.loads(response['data'])
            attempts.append({'status': response['status'],
                             'sha256': hashlib.sha256(response['data']).hexdigest(),
                             'bytes': len(response['data'])})
            if response['status'] != 200:
                attempts[-1]['code'] = body.get('code')
                if response['status'] not in (502, 503, 504):
                    break
                continue
            result.update({key: body.get(key) for key in
                           ('totalCount', 'pageNum', 'totalPages', 'hasMore')})
            result['items'] = [
                {'series_id': item['video_data'].get('series_id'),
                 'series_title': item['video_data'].get('series_title') or item['video_data'].get('series_name'),
                 'kind': 'video'} if isinstance(item.get('video_data'), dict)
                else {'kind': 'other', 'fields': sorted(item)}
                for item in body['searchList']]
            result['success'] = body.get('pageNum') == page
            break
        except Exception as error:
            # Do not serialize headers, cookies, request context or exception URLs.
            attempts.append({'error_type': type(error).__name__})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--query', default='军需处长')
    parser.add_argument('--max-pages', type=int, default=30)
    parser.add_argument('--out', type=Path, default=Path(__file__).with_name('observations.json'))
    args = parser.parse_args()
    if not 1 <= args.max_pages <= 50:
        parser.error('--max-pages must be between 1 and 50')
    first = fetch_page(args.query, 1)
    rows = [first]
    if first.get('success') and isinstance(first.get('totalPages'), int):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            for row in pool.map(lambda page: fetch_page(args.query, page),
                                range(2, min(args.max_pages, first['totalPages']) + 1)):
                rows.append(row)
                print('page', row['page_requested'], 'success', row.get('success', False), flush=True)
    ids = [item['series_id'] for row in rows for item in row.get('items', [])
           if item.get('kind') == 'video']
    report = {'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'base_url': 'https://hongguoduanju.com', 'query': args.query,
              'authentication': 'anonymous; no cookies supplied',
              'pages': rows, 'video_rows': len(ids), 'unique_series_ids': len(set(ids)),
              'all_reported_pages_returned': bool(first.get('success')) and
                  len(rows) == first.get('totalPages') and all(row.get('success') for row in rows),
              'boundary': 'One query and observation window; ranking/total can change between requests.'}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(args.out, 'unique series', len(set(ids)), flush=True)


if __name__ == '__main__':
    main()

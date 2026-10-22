"""Validate normal website playback using its public software worker protocol.

Playback secrets remain in process memory and stdin pipes. Only sanitized
observations are saved. Media artifacts use .private. names and are not shipped.
"""
import argparse
import asyncio
import concurrent.futures
import datetime
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError

HERE = Path(__file__).resolve().parent
BASE = 'https://hongguoduanju.com'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36'


async def browser_play_info(body, attempts):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        options = {'executable_path': '/usr/bin/chromium', 'headless': True,
            'args': ['--no-sandbox', '--disable-dev-shm-usage']}
        if os.environ.get('HTTPS_PROXY'):
            options['proxy'] = {'server': os.environ['HTTPS_PROXY']}
        browser = await p.chromium.launch(**options)
        try:
            page = await browser.new_page()
            await page.goto(BASE + '/', wait_until='domcontentloaded', timeout=45000)
            history = []
            for attempt in range(attempts):
                reply = await page.evaluate('''async body => {
                    const response = await fetch('/api/video/protected/play-info', {
                        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
                    return {status:response.status, data:await response.json()};
                }''', body)
                history.append({'status': reply['status'], 'error': reply['data'].get('error')})
                if reply['data'].get('error') != 'protected_playback_unavailable' or attempt + 1 == attempts:
                    return dict(reply, attempts=history)
                await asyncio.sleep(2 ** attempt)
        finally:
            await browser.close()


def download_track(entry):
    name, info, target = entry
    request = Request(info['main_url'], headers={'User-Agent': UA, 'Referer': BASE + '/'})
    total = 0
    digest = hashlib.sha256()
    with urlopen(request, timeout=40) as response, target.open('wb') as output:
        if int(response.headers.get('Content-Length') or 0) > 128 * 1024 * 1024:
            raise ValueError('MEDIA_SIZE_LIMIT')
        while True:
            block = response.read(256 * 1024)
            if not block:
                break
            total += len(block)
            if total > 128 * 1024 * 1024:
                raise ValueError('MEDIA_SIZE_LIMIT')
            digest.update(block)
            output.write(block)
    return {'track': name, 'bytes': total, 'sha256': digest.hexdigest(),
            'host': urlsplit(info['main_url']).hostname}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--series', default='7690961604636052505')
    parser.add_argument('--item', default='7690963410778868761')
    parser.add_argument('--definition', default='720p', choices=['360p', '480p', '720p'])
    parser.add_argument('--browser-api', action='store_true')
    parser.add_argument('--attempts', type=int, choices=[1, 2, 3], default=3)
    args = parser.parse_args()
    tag = args.item + '-' + args.definition
    observations = {'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'series_id': args.series, 'item_id': args.item, 'definition': args.definition,
        'method': 'Official play-info response and unmodified public player worker messages; no key export or CDM bypass.'}
    result_path = HERE / (tag + '-observation.json')
    phase = 'play-info'
    try:
        body = {'series_id': args.series, 'item_id': args.item, 'definition': args.definition}
        request = Request(BASE + '/api/video/protected/play-info', data=json.dumps(body).encode(),
            headers={'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': BASE + '/'})
        if args.browser_api:
            reply = asyncio.run(browser_play_info(body, args.attempts))
            data = reply['data']
            observations.update(api_http_status=reply['status'], api_transport='normal_browser_fetch',
                api_attempts=reply['attempts'])
        else:
            observations['api_attempts'] = []
            for attempt in range(args.attempts):
                try:
                    response = urlopen(request, timeout=35)
                except HTTPError as error:
                    response = error
                with response:
                    observations['api_http_status'] = response.status
                    data = json.load(response)
                observations['api_attempts'].append({'status': response.status, 'error': data.get('error')})
                if data.get('error') != 'protected_playback_unavailable' or attempt + 1 == args.attempts:
                    break
                time.sleep(2 ** attempt)
        info = data.get('play_info')
        if not isinstance(info, dict):
            observations['api_error'] = data.get('error')
            raise ValueError('NO_PLAY_INFO')
        audio = info.get('audio')
        if not info.get('player_access_key') or not isinstance(audio, dict) or not audio.get('player_access_key'):
            raise ValueError('INCOMPLETE_PLAY_INFO')
        observations.update(vid=info.get('vid'), expected_duration=info.get('duration'),
            width=info.get('width'), height=info.get('height'), codec=info.get('codec_type'),
            normal_software_decryption=True, shared_audio_video_key=audio['player_access_key'] == info['player_access_key'])
        encrypted_video = HERE / (tag + '-video.encrypted.private.mp4')
        encrypted_audio = HERE / (tag + '-audio.encrypted.private.mp4')
        clear_video = HERE / (tag + '-video.clear.private.mp4')
        clear_audio = HERE / (tag + '-audio.clear.private.mp4')
        merged = HERE / (tag + '.decoded.private.mp4')
        phase = 'download'
        print('Downloading normal signed media tracks.', flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            observations['downloads'] = list(pool.map(download_track, [
                ('video', info, encrypted_video), ('audio', audio, encrypted_audio)]))
        phase = 'worker'
        print('Using official worker updateValue/decryptHeader/decryptBody.', flush=True)
        job = {'tracks': [
            {'input': str(encrypted_video), 'output': str(clear_video), 'isVideo': True,
             'secretKey': info['player_access_key']},
            {'input': str(encrypted_audio), 'output': str(clear_audio), 'isVideo': False,
             'secretKey': audio['player_access_key']}]}
        bridge = subprocess.run(['node', str(HERE / 'sdk_bridge.cjs')], input=json.dumps(job),
            text=True, capture_output=True, timeout=150)
        observations['worker_exit_code'] = bridge.returncode
        observations['worker'] = json.loads(bridge.stdout)
        if bridge.returncode or not observations['worker'].get('ok'):
            raise ValueError('WORKER_FAILED')
        phase = 'remux'
        print('Remuxing the worker output.', flush=True)
        remux = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(clear_video),
            '-i', str(clear_audio), '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy',
            '-movflags', '+faststart', str(merged)], capture_output=True, text=True, timeout=60)
        observations['remux_exit_code'] = remux.returncode
        if remux.returncode:
            (HERE / (tag + '-remux.private.log')).write_text(remux.stderr)
            raise ValueError('REMUX_FAILED')
        phase = 'decode'
        probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
            'format=duration,size:stream=codec_name,codec_type,width,height,duration,r_frame_rate',
            '-of', 'json', str(merged)], capture_output=True, text=True, timeout=30)
        observations['media'] = json.loads(probe.stdout)
        print('Decoding the complete result with FFmpeg.', flush=True)
        decode = subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-i', str(merged),
            '-progress', 'pipe:1', '-nostats', '-f', 'null', '-'], capture_output=True, text=True, timeout=360)
        observations['decode_exit_code'] = decode.returncode
        progress = dict(line.split('=', 1) for line in decode.stdout.splitlines() if '=' in line)
        observations['decode_progress'] = {k: progress.get(k) for k in ['frame', 'out_time', 'progress']}
        observations['decode_stderr_sha256'] = hashlib.sha256(decode.stderr.encode()).hexdigest()
        duration = float(observations['media']['format']['duration'])
        observations['duration_difference'] = abs(duration - float(info['duration']))
        observations['full_decode_passed'] = (probe.returncode == decode.returncode == 0
            and progress.get('progress') == 'end' and int(progress.get('frame', 0)) > 0
            and observations['duration_difference'] < 2)
        if decode.returncode:
            (HERE / (tag + '-decode.private.log')).write_text(decode.stderr)
    except Exception as error:
        observations['failure'] = {'phase': phase, 'type': type(error).__name__}
        if isinstance(error, ValueError) and str(error) in {'MEDIA_SIZE_LIMIT', 'NO_PLAY_INFO',
                'INCOMPLETE_PLAY_INFO', 'WORKER_FAILED', 'REMUX_FAILED'}:
            observations['failure']['code'] = str(error)
        print('Validation failed at', phase, type(error).__name__, flush=True)
    result_path.write_text(json.dumps(observations, ensure_ascii=False, indent=2))
    print(json.dumps(observations, ensure_ascii=False, indent=2), flush=True)
    return 0 if observations.get('full_decode_passed') else 1


if __name__ == '__main__':
    raise SystemExit(main())

"""Observe the official anonymous web player in an owned Chromium process.

Records playback state and response status only. Never records keys, cookies,
signed media URLs, console message contents, or request/response bodies.
"""
import asyncio
import datetime
import json
import os
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright

OUT = Path(__file__).resolve().parent
URL = 'https://hongguoduanju.com/player/7690961604636052505/7690963410778868761'


async def main():
    counts = Counter()
    failures = Counter()
    snapshots = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
            proxy={'server': os.environ['HTTPS_PROXY']},
            args=['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'])
        context = await browser.new_context(viewport={'width': 1280, 'height': 720})
        page = await context.new_page()
        page.on('response', lambda r: counts.update([(urlsplit(r.url).hostname, r.status)]))
        page.on('requestfailed', lambda r: failures.update([(urlsplit(r.url).hostname, r.failure)]))
        try:
            response = await page.goto(URL, wait_until='domcontentloaded', timeout=45000)
            for step in range(6):
                await page.wait_for_timeout(5000)
                snapshot = await page.evaluate('''() => ({
                    video: [...document.querySelectorAll('video')].map(v => ({
                        duration: Number.isFinite(v.duration) ? v.duration : null,
                        currentTime: v.currentTime, readyState:v.readyState,
                        networkState:v.networkState, paused:v.paused, ended:v.ended,
                        width:v.videoWidth, height:v.videoHeight,
                        error:v.error ? {code:v.error.code} : null,
                        quality:v.getVideoPlaybackQuality ? {
                            decoded:v.getVideoPlaybackQuality().totalVideoFrames,
                            dropped:v.getVideoPlaybackQuality().droppedVideoFrames
                        } : null
                    })),
                    buttons: [...document.querySelectorAll('button')].map(b => b.innerText).slice(0,25),
                    title:document.title
                })''')
                snapshot['elapsed_seconds'] = (step + 1) * 5
                snapshots.append(snapshot)
                print(json.dumps(snapshot, ensure_ascii=False), flush=True)
                if step == 0:
                    await page.evaluate('''() => {
                        for (const v of document.querySelectorAll('video')) {
                            v.muted=true; v.play().catch(() => {});
                        }
                    }''')
            result = {'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'page_status': response.status if response else None,
                'snapshots': snapshots,
                'responses': [{'host': h, 'status': s, 'count': n} for (h,s),n in counts.items()],
                'failures': [{'host': h, 'reason': str(r)[:150], 'count': n} for (h,r),n in failures.items()]}
        except Exception as exc:
            result = {'error_type': type(exc).__name__, 'snapshots': snapshots,
                      'responses': [{'host': h,'status': s,'count': n} for (h,s),n in counts.items()]}
            print('Browser probe error:', type(exc).__name__, flush=True)
        finally:
            await browser.close()
        (OUT/'browser-playback-observation.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(main())

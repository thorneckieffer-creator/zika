#!/usr/bin/env python3
"""Build a bundled voice pack for 字卡.

One MP3 clip per word and per character, concatenated into a single .pack file with a JSON
index of {key: [offset, length]}. The app fetches the pack once and slices clips out of it.

    python3 -m venv ~/.cache/zika-voice/venv
    ~/.cache/zika-voice/venv/bin/pip install edge-tts
    ~/.cache/zika-voice/venv/bin/python tools/build_voice_pack.py --voice zh-TW-YunJheNeural --out audio-tw-m

Keys are derived from WORDS (data/words.js) exactly as the app derives them (audioKey), so a
pack rebuilt after new lessons are added covers them automatically. Clips are cached on disk,
so an interrupted or repeated run only synthesises what is missing.

Voices: zh-TW-HsiaoChenNeural (female, 曉臻), zh-TW-YunJheNeural (male, 雲哲),
zh-TW-HsiaoYuNeural (female, 曉雨). Synthesis uses Microsoft Edge's read-aloud service.
"""
import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

import applib

ROOT = Path(__file__).resolve().parent.parent
HAN = re.compile(r'[㐀-鿿]')


def audio_key(text):
    """Mirror of audioKey() in js/audio.js: Han characters only, else letters and digits."""
    text = str(text).split('（')[0]
    han = ''.join(HAN.findall(text))
    return han or re.sub(r'[^A-Za-z0-9]', '', text)


def load_keys():
    words = applib.read_data('WORDS')
    keys = set()
    for w in words:
        k = audio_key(w['t'])
        if k:
            keys.add(k)
        keys.update(HAN.findall(str(w['t']).split('（')[0]))
    return sorted(keys)


async def synth(key, voice, rate, cache, sem, stats, pause=0.6):
    import edge_tts
    path = cache / (key + '.mp3')
    if path.exists() and path.stat().st_size > 1000:
        stats['cached'] += 1
        return
    async with sem:
        for attempt in range(8):
            try:
                # a stalled connection must not hang the whole build
                await asyncio.wait_for(edge_tts.Communicate(key, voice, rate=rate).save(str(path)), timeout=30)
                if path.stat().st_size > 1000:
                    stats['made'] += 1
                    await asyncio.sleep(pause)   # stay well under the service's burst limit (it blocks for hours past ~60 a minute)
                    return
            except (Exception, asyncio.TimeoutError):
                pass
            # "No audio was received" means the service is throttling: back off properly, then retry
            await asyncio.sleep(min(90, 15 * (attempt + 1)))
        stats['failed'].append(key)
        if path.exists():
            path.unlink()


async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--voice', default='zh-TW-YunJheNeural')
    ap.add_argument('--rate', default='-12%', help='speaking rate relative to normal (default: slightly slow)')
    ap.add_argument('--out', default='audio-tw-m', help='basename under assets/: <out>.pack and <out>-index.json')
    ap.add_argument('--cache', default=str(Path.home() / '.cache' / 'zika-voice'))
    ap.add_argument('--jobs', type=int, default=1)
    ap.add_argument('--limit', type=int, default=0, help='only the first N keys (for a quick test)')
    ap.add_argument('--pause', type=float, default=2.0, help='seconds to wait after each clip')
    a = ap.parse_args()

    keys = load_keys()
    if a.limit:
        keys = keys[:a.limit]
    cache = Path(a.cache) / (a.voice + '_' + a.rate.replace('%', 'pct'))
    cache.mkdir(parents=True, exist_ok=True)
    stats = {'cached': 0, 'made': 0, 'failed': []}
    sem = asyncio.Semaphore(a.jobs)
    print(f'{len(keys)} keys · voice {a.voice} · rate {a.rate}', flush=True)

    todo = [synth(k, a.voice, a.rate, cache, sem, stats, a.pause) for k in keys]
    for i in range(0, len(todo), 50):
        await asyncio.gather(*todo[i:i + 50])
        print(f'  {min(i + 50, len(todo))}/{len(todo)} · new {stats["made"]} · cached {stats["cached"]} · failed {len(stats["failed"])}', flush=True)

    index, blob = {}, bytearray()
    for k in keys:
        p = cache / (k + '.mp3')
        if not p.exists():
            continue
        data = p.read_bytes()
        index[k] = [len(blob), len(data)]
        blob += data

    if a.limit:
        print(f'test run: {len(index)} clips, {len(blob)} bytes — nothing written')
        return
    (ROOT / 'assets' / (a.out + '.pack')).write_bytes(bytes(blob))
    (ROOT / 'assets' / (a.out + '-index.json')).write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'wrote assets/{a.out}.pack ({len(blob) / 1e6:.1f} MB) and assets/{a.out}-index.json ({len(index)} clips)')
    if stats['failed']:
        print('FAILED keys (re-run to retry):', ' '.join(stats['failed']))
        sys.exit(1)


if __name__ == '__main__':
    asyncio.run(main())

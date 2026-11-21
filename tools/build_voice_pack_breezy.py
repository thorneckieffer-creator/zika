#!/usr/bin/env python3
"""Build a 字卡 voice pack with BreezyVoice — MediaTek Research's open-source Taiwanese Mandarin
TTS, which speaks in the voice of whoever is on a short reference recording.

Setup (once; everything lives under ~/.cache/zika-voice/bv and can be deleted to undo it) is
described in CLAUDE.md. Run from inside the BreezyVoice checkout, with that environment's Python:

    cd ~/.cache/zika-voice/bv/BreezyVoice
    PYTHONUTF8=1 ../env/bin/python <repo>/tools/build_voice_pack_breezy.py \
        --prompt-wav ../prompts/me.wav --prompt-text "what is said in the recording" --out audio-me

The reference should be 8–15 seconds of one person speaking Mandarin clearly, mono, no music or
noise, with its exact transcript (voice.html records one). The model copies the reference's pace
as well as its sound. Clips are cached per reference voice, so a stopped run resumes.

What this adds on top of the model:
  • readings from tools/content/readings.json (the publisher's 注音) wherever the model would guess
    differently, and one clip per reading for words that share characters (了@le, 了@liǎo);
  • a floor and a ceiling on clip length, because a zero-shot model sometimes cuts a very short
    text off or rambles;
  • --verify: each clip is transcribed back with Whisper and re-rendered (up to 3 takes) when the
    syllables heard are not the syllables asked for. Clips that never pass are listed at the end.

Use --sample N to render N everyday words into voice-samples/ for listening instead of a pack.
Use --keys-file FILE to render only the clip keys listed in it (the first tab-separated field of each
line; 字@pinyin for one reading of several) into --sample-dir, as <key>.mp3. No pack is written.

It is built to stay out of the way on a machine that is being used: it runs at low priority, renders
at most --stage clips per run (default 120) and then exits so all its memory is returned, frees GPU
memory after every clip, and stops early if it grows past --max-gb. Run it again to continue; the
last run writes the pack. tools/build_voice_staged.sh loops it with a pause between stages.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

import applib

os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')
# Keep the GPU allocator on a short leash: without a cap it grows until macOS starts swapping.
os.environ.setdefault('PYTORCH_MPS_HIGH_WATERMARK_RATIO', '0.2')
os.environ.setdefault('PYTORCH_MPS_LOW_WATERMARK_RATIO', '0.15')
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, os.getcwd())                       # the BreezyVoice checkout

from build_voice_pack import audio_key, load_keys    # same keys as every other pack

HAN = re.compile(r'[㐀-鿿]')
SAMPLE_WORDS = ['你好', '謝謝', '老師', '學生', '臺灣', '垃圾', '便宜', '漂亮', '為什麼', '對不起',
                '差一點', '好不容易', '人情味', '擔仔麵', '一般來說', '得', '了', '行', '覺', '樂']


def py_id(p):
    """Pinyin as a key suffix; pyKey() in js/audio.js must produce the same string."""
    return unicodedata.normalize('NFC', re.sub(r"[\s'’\-·,，!！]", '', str(p).split('/')[0].lower()))


def to_mp3(wav, sr, bitrate=64):
    """Trim silence, level the volume, and encode to mono MP3. Returns (bytes, seconds, 16 kHz audio)."""
    import lameenc
    import librosa
    import numpy as np
    y = librosa.resample(wav, orig_sr=sr, target_sr=24000)
    y, _ = librosa.effects.trim(y, top_db=38)
    pad = np.zeros(int(24000 * 0.06), dtype=y.dtype)
    y = np.concatenate([pad, y, pad])
    y = y / (float(np.max(np.abs(y))) or 1.0) * 0.89
    enc = lameenc.Encoder(); enc.set_bit_rate(bitrate); enc.set_in_sample_rate(24000); enc.set_channels(1); enc.set_quality(2)
    return enc.encode((y * 32767).astype('<i2').tobytes()) + enc.flush(), len(y) / 24000, librosa.resample(y, orig_sr=24000, target_sr=16000)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--prompt-wav', required=True)
    ap.add_argument('--prompt-text', required=True)
    ap.add_argument('--out', default='audio-me', help='basename under assets/')
    ap.add_argument('--sample', type=int, default=0, help='render N sample words to --sample-dir and stop')
    ap.add_argument('--sample-dir', default=str(ROOT / 'voice-samples'))
    ap.add_argument('--keys-file', help='render only the clip keys in this file into --sample-dir; no pack is written')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--verify', action='store_true', help='listen back to every clip with Whisper')
    ap.add_argument('--device', default='auto', help='auto, mps or cpu')
    ap.add_argument('--stage', type=int, default=120, help='most clips to render in one run (0 = no limit)')
    ap.add_argument('--max-gb', type=float, default=7.0, help='stop the stage if this process uses more memory than this')
    ap.add_argument('--model', default='MediaTek-Research/BreezyVoice-300M')
    a = ap.parse_args()

    prompt = Path(a.prompt_wav).expanduser()
    if not prompt.exists():
        sys.exit(f'reference recording not found: {prompt}')
    voice_id = hashlib.sha1(prompt.read_bytes() + a.prompt_text.encode()).hexdigest()[:10]
    cache = Path.home() / '.cache' / 'zika-voice' / f'breezy-{voice_id}'
    cache.mkdir(parents=True, exist_ok=True)

    # ---- what to say: every key, plus one clip per reading where words share characters but not sound
    rfile = ROOT / 'tools' / 'content' / 'readings.json'
    readings = json.loads(rfile.read_text(encoding='utf-8')) if rfile.exists() else {'words': {}, 'chars': {}}
    WORDS = applib.read_data('WORDS')
    by_key = {}                                        # key -> [(pinyin id, syllables)], in textbook order
    for w in WORDS:
        k = audio_key(w['t']); syl = readings['words'].get(w['id'])
        if k and syl and all(pid != py_id(w['p']) for pid, _ in by_key.setdefault(k, [])):
            by_key[k].append((py_id(w['p']), syl))
    jobs = {}                                          # clip key -> syllables to pin (None = the model decides)
    for k in (SAMPLE_WORDS[:a.sample] if a.sample else load_keys()):
        variants = by_key.get(k, [])
        if len(k) == 1 and not variants and k in readings['chars']:
            jobs[k] = [readings['chars'][k]]
        else:
            jobs[k] = variants[0][1] if variants else None
        if len(variants) > 1:
            for pid, syl in variants:
                jobs[f'{k}@{pid}'] = syl
    keys = list(jobs)
    if a.keys_file:
        only = [l.split('\t')[0].strip() for l in Path(a.keys_file).read_text(encoding='utf-8').split('\n') if l.strip() and not l.startswith('#')]
        unknown = [k for k in only if k not in jobs]
        if unknown:
            sys.exit('not clip keys of this course: ' + ' '.join(unknown))
        keys = only
    if a.limit:
        keys = keys[:a.limit]
    todo = [k for k in keys if not (cache / (k + '.mp3')).exists()]
    remaining = len(todo)
    if a.stage and not a.sample:
        todo = todo[:a.stage]
    print(f'{len(keys)} clips · {remaining} still to render · this run does {len(todo)} · voice {voice_id}', flush=True)
    try:
        os.nice(12)                                    # yield to whatever else the machine is doing
    except OSError:
        pass

    if todo:
        import numpy as np
        import torch
        import torchaudio
        from g2pw import G2PWConverter
        from single_inference import CustomCosyVoice, get_bopomofo_rare
        from cosyvoice.utils.file_utils import load_wav
        from utils.word_utils import word_to_dataset_frequency, char2phn, always_augment_chars

        dev = a.device if a.device != 'auto' else ('mps' if torch.backends.mps.is_available() else 'cpu')
        model = CustomCosyVoice(a.model)
        fe, m = model.frontend, model.model
        m.llm.to(dev); m.flow.to(dev); m.hift.to(dev)
        g2p = G2PWConverter(num_workers=0)

        # The repo's text normaliser turns Traditional into Simplified on macOS, which makes the model treat
        # nearly every character as rare. The text here is already clean, so it is passed straight through.
        # The reference is analysed once, not once per clip (that alone is most of the time on a CPU).
        p16 = load_wav(str(prompt), 16000)
        ptok, plen = fe._extract_text_token(get_bopomofo_rare(a.prompt_text, g2p))
        feat, flen = fe._extract_speech_feat(torchaudio.transforms.Resample(orig_freq=16000, new_freq=22050)(p16))
        stok, slen = fe._extract_speech_token(p16)
        emb = fe._extract_spk_embedding(p16)
        on = lambda t: t.to(dev)

        texts = [k.split('@')[0] for k in todo]
        guesses = dict(zip(texts, g2p(texts)))        # one batched call: g2pw costs seconds per call, not per text

        def plan(k):
            """Annotated text for the model, and the syllables a listener should hear."""
            text = k.split('@')[0]; pinned = jobs[k]; guess = guesses[text]
            out, want = '', []
            for i, ch in enumerate(text):
                pin = pinned[i] if pinned and len(pinned) == len(text) else None
                said = guess[i] if i < len(guess) else None
                reading = pin or said
                want.append(reading)
                freq = word_to_dataset_frequency.get(ch, 0)
                unusual = len(char2phn.get(ch, [])) >= 2 and reading != char2phn[ch][0] and (freq < 10000 or ch in always_augment_chars)
                out += ch + (f'[:{reading}]' if reading and ((pin and pin != said) or freq < 500 or unusual) else '')
            return out, want

        def render(text, han):
            with torch.inference_mode():
                ttok, tlen = fe._extract_text_token(text + '。')
                n = ttok.shape[1]
                tok = m.llm.inference(text=on(ttok), text_len=on(tlen), prompt_text=on(ptok), prompt_text_len=on(plen),
                                      prompt_speech_token=on(stok), prompt_speech_token_len=on(slen), embedding=on(emb), beam_size=1, sampling=25,
                                      min_token_text_ratio=max(3, -(-han * 10 // n)),          # ≥ 0.2 s a syllable (50 tokens/s)
                                      max_token_text_ratio=max(30, (han * 40 + 30) // n))      # ≤ 0.8 s a syllable + a tail
                mel = m.flow.inference(token=on(tok), token_len=on(torch.tensor([tok.size(1)], dtype=torch.int32)), prompt_token=on(stok),
                                       prompt_token_len=on(slen), prompt_feat=on(feat), prompt_feat_len=on(flen), embedding=on(emb))
                return m.hift.inference(mel=mel).cpu().numpy()[0]

        asr = cc = None
        if a.verify:
            import opencc
            import whisper
            asr = whisper.load_model('small'); cc = opencc.OpenCC('s2t')
        toneless = lambda s: re.sub(r'\d', '', s or '')

        def heard_ok(y16, want):
            """How many of the wanted syllables Whisper heard, tolerant of homophones and of tone."""
            r = asr.transcribe(y16.astype(np.float32), language='zh', fp16=False, condition_on_previous_text=False,
                               initial_prompt='以下是繁體中文的詞語。')
            heard = HAN.findall(cc.convert(r['text']))
            hits = sum(1 for i, w in enumerate(want)
                       if i < len(heard) and w and toneless(w) in {toneless(x) for x in char2phn.get(heard[i], [])})
            return hits - abs(len(heard) - len(want)), ''.join(heard)

        import gc
        import resource
        def used_gb():
            gpu = torch.mps.driver_allocated_memory() if dev == 'mps' else 0
            return max(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss, gpu) / 1e9
        t0 = time.time(); flagged = []
        old = cache / '_flagged.txt'
        if old.exists():
            flagged = [x for x in old.read_text(encoding='utf-8').split('\n') if x]
        for i, k in enumerate(todo, 1):
            text, want = plan(k)
            han = len(HAN.findall(k.split('@')[0])) or max(1, len(k) // 2)
            best = None
            for take in range(3):
                try:
                    mp3, dur, y16 = to_mp3(render(text, han), 22050)
                except Exception as err:
                    print(f'  ! {k}: {type(err).__name__} {str(err)[:90]}', flush=True); continue
                # a lone syllable is too short for speech recognition to judge; those are checked by length only
                score, heard = (heard_ok(y16, want) if asr and all(want) and han >= 2 else (len(want), ''))
                if not (0.15 * han <= dur <= 0.8 * han + 0.9):
                    score -= 2
                if best is None or score > best[0]:
                    best = (score, mp3, heard, dur)
                if score >= len(want):
                    break
            if best is None:
                flagged.append(f'{k} (failed)'); continue
            (cache / (k + '.mp3')).write_bytes(best[1])
            if best[0] < len(want):
                flagged.append(f'{k} (heard “{best[2]}”, {best[3]:.1f}s)')
            if dev == 'mps':
                torch.mps.empty_cache()
            if i % 10 == 0:
                gc.collect()
            if i % 20 == 0 or i == len(todo):
                rate = (time.time() - t0) / i
                print(f'  {i}/{len(todo)} · {rate:.1f} s per clip · {used_gb():.1f} GB in use · {len(flagged)} flagged', flush=True)
            if used_gb() > a.max_gb:
                print(f'  stopping this stage early: {used_gb():.1f} GB in use (limit {a.max_gb})', flush=True); break
        report = cache / '_flagged.txt'
        report.write_text('\n'.join(flagged), encoding='utf-8')
        if flagged:
            print(f'{len(flagged)} clips to check by ear (also in {report}):', flush=True)
            print('  ' + ' · '.join(flagged[:40]) + (' …' if len(flagged) > 40 else ''), flush=True)

    if a.keys_file:
        out = Path(a.sample_dir).expanduser()
        out.mkdir(parents=True, exist_ok=True)
        done = [k for k in keys if (cache / (k + '.mp3')).exists()]
        for k in done:
            (out / (k + '.mp3')).write_bytes((cache / (k + '.mp3')).read_bytes())
        print(f'{len(done)} of {len(keys)} clips in {out}')
        sys.exit(0 if len(done) == len(keys) else 3)
    if a.sample:
        out = Path(a.sample_dir) / f'breezy-{voice_id}'
        out.mkdir(parents=True, exist_ok=True)
        for n, k in enumerate(keys, 1):
            if (cache / (k + '.mp3')).exists():
                (out / f'{n:02d} {k}.mp3').write_bytes((cache / (k + '.mp3')).read_bytes())
        print(f'samples in {out}')
        return

    left = sum(1 for k in keys if not (cache / (k + '.mp3')).exists())
    if left:
        print(f'{left} clips still to render — run again to continue (nothing written to assets/ yet)')
        sys.exit(3)
    index, blob = {}, bytearray()
    for k in keys:
        p = cache / (k + '.mp3')
        if p.exists():
            data = p.read_bytes(); index[k] = [len(blob), len(data)]; blob += data
    if a.limit:
        print(f'test run: {len(index)} clips, {len(blob)} bytes — nothing written'); return
    (ROOT / 'assets' / (a.out + '.pack')).write_bytes(bytes(blob))
    (ROOT / 'assets' / (a.out + '-index.json')).write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'wrote assets/{a.out}.pack ({len(blob) / 1e6:.1f} MB) and its index ({len(index)} clips)')


if __name__ == '__main__':
    main()

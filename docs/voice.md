# Voice packs

The voice area: `assets/audio-*`, `voice.html`, `tools/build_voice_pack.py`, `tools/build_voice_pack_breezy.py`, `tools/build_voice_staged.sh`, `tools/build_readings.py`, `tools/content/readings.json`, and the audio functions in `index.html` (`VOICE_PACKS`, `loadPack`, `playBundled`, `playAudio`, `pyKey`, `setVoice`). How playback falls through from pack to system voice is in [architecture.md](architecture.md#audio-playback).

Three slots in `VOICE_PACKS`: `f` (`audio-tw`, 曉臻, the default), `m` (`audio-tw-m`, 雲哲) and `me` (`audio-me`, Thorne's own cloned voice). Settings offers only the packs whose index file exists. A clip key is the word's Han characters; words that share characters but not sound also have `字@pinyin` keys (`pyKey()` in the app, `py_id()` in the builder), and `speakWord` passes the word's pinyin so the right one plays.

Two builders:

- `tools/build_voice_pack.py` — Microsoft's read-aloud voices through edge-tts. Simple, but the service throttles hard (it stopped after 66 clips in November 2026).
- `tools/build_voice_pack_breezy.py` — BreezyVoice (open source, MediaTek Research): clones the voice on a short reference recording. `voice.html` records that reference in the browser. `tools/build_readings.py` writes `tools/content/readings.json` (the publisher's 注音), which the builder uses to pin pronunciations.

BreezyVoice setup on this Mac lives in `~/.cache/zika-voice/bv/` (Miniforge, a Python 3.10 env with pynini from conda-forge, the BreezyVoice checkout, reference recordings in `prompts/`). Lessons learned the hard way:

- **Run it staged, never as one long job.** An uncapped run on the GPU filled the Mac's memory and pushed it deep into swap. `tools/build_voice_staged.sh` renders 120 clips per process at low priority with a pause between stages, caps the GPU allocator, and stops a stage that grows past 7 GB.
- A script that loads the model needs `if __name__ == '__main__':` (g2pw spawns processes on macOS).
- Pin `ruamel.yaml==0.18.6`; install `openai-whisper` unpinned; `setuptools<81`.
- Do not use the repo's text normaliser on macOS — it converts Traditional to Simplified.
- g2pw costs about 8 s per call regardless of size: batch every text into one call.
- The clone copies the reference's speaking pace as well as its sound.
- Claude cannot hear audio. Whisper listen-back catches gross failures on words of two or more syllables but is unreliable on single syllables; Thorne has to approve the sound by ear before a pack ships.

After building or extending a pack, bump `ASSETS` in `sw.js` and run `node tools/check.mjs`, which reports every word without a clip.

## Tone coach (聲調教練, v43, beta)

A drill mode (`tcoach`, functions prefixed `tc`) that records the learner saying a word, shows the pitch curve of each syllable against the native clip's, and grades each tone. It runs entirely in the browser; no audio leaves the device.

- **Pipeline:** recording → 16 kHz → YIN pitch track (`tcPitch`) → cleaning (`tcClean`) → voiced stretches merged or split into one per syllable (`tcSyllables`) → each syllable reduced to 16 points (`tcShape`) → a small softmax classifier (`tcClassify`, weights in `TC_W`).
- **The classifier was fitted on the bundled 曉臻 clips**: 1,962 labelled non-neutral syllables, 90% on held-out syllables (tone 1 97%, tone 2 94%, tone 3 72%, tone 4 92%). If the analysis changes, refit it: decode every clip, build the same features, train, and replace `TC_W`. It has never been validated against a human learner's voice — treat grades as a guide, and the curves as the real feedback.
- **Speaker normalisation:** pitch is judged against the speaker's own mid pitch and spread. For the native voice these are measured once per pack (`tcNativeStats`, cached in localStorage). For the learner they are learned from every recording (`S.vp`: frame count, sum, sum of squares, in semitones re 100 Hz); the first run asks for one read-aloud sentence so it starts with a real estimate.
- **Expected tones** come from the word's pinyin with third-tone sandhi applied (`tcExpected`); neutral tones are shown but not graded.
- **State:** `S.tone` holds totals per tone, a confusion count (`"2>3"`), and the best score per word. Both `S.tone` and `S.vp` sync.
- **Not done:** sentence-level practice; tone-pair drills chosen from the learner's weakest confusions; a classifier trained on more than one voice.


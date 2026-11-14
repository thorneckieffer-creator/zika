# 字卡 Zìkǎ

A spaced-repetition study app for *A Course in Contemporary Chinese* (當代中文課程), the textbook series used at NTNU's Mandarin Training Center in Taipei. It covers Books 1 and 2 in full and Book 3 through Lesson 4 so far: 1,478 words, 1,005 characters and 199 grammar points across 34 lessons, in Traditional characters with Taiwan readings.

**Live app:** https://thorneckieffer-creator.github.io/zika/

It is a single-page progressive web app with no build step and no server of its own. It installs to the Home Screen on iPhone, iPad and Mac, works offline, and keeps every device on the same deck through Firebase.

## What it does

| Area | What you get |
|---|---|
| **Scheduling** | FSRS-5. Two cards per word (recognise, and recall/write) plus grammar cloze cards, with a daily intake per lane. |
| **My words** | A personal deck for vocabulary met outside class: add one word or paste a list, pinyin is filled in, and it is scheduled like the course but kept apart from it. |
| **Three lanes** | *This week* (the live lesson), *Catch-up* (words the writing test flagged, plus the hard list) and *Maintenance* (everything else). |
| **Writing** | Paper-first. The writing test shows English and pinyin, you write the character on paper, then grade yourself. Missed words go to a printable 田字格 sheet that tapers ×20 → ×5 → ×1. |
| **Exam prep (大考試)** | A lesson range and a date. Every word is sorted into ✓ / ~ / ✗ piles that can be re-tested, dictated, reviewed or printed. |
| **Drills** | 認字 recognition, 聲調 tones, 聽寫 dictation, sentence dictation, "Which one?" confusables, reading sprint, sentence building, speaking. |
| **Characters** | Stroke-order animation, component breakdown (meaning part and sound part), phonetic series, and a 萌典 panel with radical, stroke count, 注音 and definition. |
| **Audio** | Bundled Taiwan neural voices for every word and every character (曉臻, female; 雲哲, male, when its pack is installed), with the system voice as fallback. |
| **Brain** | A map of every character you know, by lesson and by word type, with a time-lapse. |
| **Yours** | Set your name, book and lesson in one place; day, night or automatic; the warm Paper palette or a neutral Clean one; six accent colours; study characters in sans, 明體 or 楷體. |
| **Notion** | Deep links to the lesson pages, and a confidence export (Hard / Learning / Know / Mastered) for the Characters table. |

## Install

**iPhone and iPad.** Open the live app in Safari, then Share → **Add to Home Screen**. The Home Screen app keeps its own storage, separate from Safari, so link it once (see below) and download the offline pack from **Settings → Offline & audio** while on Wi-Fi.

**Mac.** Use it in the browser, or install it from Chrome (address bar → Install) or Safari (File → Add to Dock). Desktop Chrome also enables the automatic backup file.

## Linking devices

Progress syncs through a shared *sync code*.

1. On the first device: **Settings → Cloud sync → Generate**.
2. On every other device: scan the QR code shown there, or type the code and tap **Link**.
3. On iPhone or iPad, repeat step 2 once inside the Home Screen app.

A device that has never been studied on adopts the cloud deck silently. If both sides hold progress, the app asks which copy wins and keeps the other for one undo.

The sync code is the only secret: anyone who has it can read and write that deck. Keep it out of screenshots and out of this repository.

## How it works

```
index.html            the whole app: styles, data, logic
sw.js                 service worker (offline shell + asset cache)
manifest.webmanifest  install metadata
voice.html            records a reference sentence for a cloned voice pack
assets/
  audio-tw.pack       zh-TW neural voice 曉臻 (female), 1,707 clips: words + characters
  audio-tw-index.json clip offsets into the pack
  audio-tw-m.*        zh-TW neural voice 雲哲 (male), same layout, offered in Settings when present
  strokes.json        stroke-order data for 1,003 characters
  hanzi-writer.min.js stroke animation engine
  icon-*.png
tools/
  check.mjs                  release check: syntax, versions, data integrity
  import_dangdai.py          imports lessons from a downloaded DangDai volume
  add_characters.py          adds stroke data and component breakdowns for new characters
  content/                   original grammar write-ups for new books; 注音 readings per word
  build_voice_pack.py        builds a voice pack from the word list (Microsoft neural voices)
  build_voice_pack_breezy.py builds a pack in a cloned voice (BreezyVoice), with
  build_voice_staged.sh        a staged runner and build_readings.py for pinned readings
docs/                 working notes by area: architecture, content, voice, releasing, roadmap
```

**State.** One JSON object in `localStorage` under the key `shida_b1_fsrs_v2`. The key name is historical and must not change, because every device's progress lives under it.

**Sync.** Firebase Realtime Database with anonymous sign-in. Each save writes the whole state to `rooms/<sync code>/study_state` after a short debounce; other devices listening on that code adopt it within about a second. Last write wins, and the database rejects any write older than the one it holds. Settings that belong to a device (voice, theme, backup file, offline pack) do not sync.

**Offline.** The service worker serves the app shell network-first with a cache fallback, and keeps audio and stroke data in a separate long-lived cache so an app update never forces a second 22 MB download.

**Backup.** Three rolling daily snapshots inside the browser, an optional file that desktop Chrome rewrites after every session, and manual export/import.

### Firebase setup (only if you fork this)

1. Create a Firebase project, add a Realtime Database, and enable **Anonymous** sign-in.
2. Register a web app and paste its config into `FIREBASE_CONFIG` in `index.html`.
3. Publish these database rules:

```json
{
  "rules": {
    "rooms": {
      "$room": {
        ".read": "auth != null",
        ".write": "auth != null",
        "study_state": {
          ".validate": "!data.exists() || newData.child('synced_at').val() > data.child('synced_at').val()"
        }
      }
    }
  }
}
```

## Development

```bash
python3 -m http.server 8791 --bind 127.0.0.1   # then open http://127.0.0.1:8791/
node tools/check.mjs                           # run before every release
```

A release is a commit on `main`; GitHub Pages deploys it within a couple of minutes. Each release bumps the version in two places that the check keeps in step: `APP_VERSION` in `index.html` and `VERSION` in `sw.js`.

`CLAUDE.md` is the starting point for anyone (or any assistant) changing the code: who owns what, and the rules that protect existing progress. The detail is split by area under `docs/`:

| Notes | What is in them |
|---|---|
| [docs/architecture.md](docs/architecture.md) | How `index.html` is layered, the data schemas, scheduler, sync, audio playback. |
| [docs/design.md](docs/design.md) | How the app should look and feel, and what those choices rest on. |
| [docs/multi-user.md](docs/multi-user.md) | What it takes to open the app to other learners. |
| [docs/content.md](docs/content.md) | Adding a book: where the word lists come from and what may be copied. |
| [docs/voice.md](docs/voice.md) | Voice packs and the two builders. |
| [docs/releasing.md](docs/releasing.md) | The release steps, GitHub Pages, and working in two sessions at once. |
| [docs/roadmap.md](docs/roadmap.md) | Everything still open, by area. |

## Roadmap

- **Books 3 and 4.** Book 3 is being added volume by volume from the publisher's 當代中文 app (`tools/import_dangdai.py`, `tools/add_characters.py`); Lessons 5–12 and Book 4 follow. Grammar explanations, example sentences and reading passages for the new lessons are written for this app rather than copied from the textbook.
- **Your own voice.** A voice pack cloned from a short recording of the learner, built with the open-source BreezyVoice model.
- **Leaner sync.** Send changes rather than the whole deck.
- **One layer.** Fold the version-by-version patches in `index.html` into a single definition of each function.

The full list, including known gaps, is in [docs/roadmap.md](docs/roadmap.md).

## Credits

Vocabulary lists follow *A Course in Contemporary Chinese* (NTNU Mandarin Training Center; Linking Publishing), compiled with Zhong Chinese. Scheduling is [FSRS-5](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm). Stroke data and animation are from [Hanzi Writer](https://hanziwriter.org/) and Make Me a Hanzi. Dictionary panels use [萌典](https://www.moedict.tw/). QR codes use qrcode-generator (MIT). The app is a personal study tool and is not affiliated with NTNU or the publisher.

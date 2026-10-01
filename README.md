# 字卡 · Shida Book 1 FSRS Tracker

Traditional-character spaced-repetition app for *A Course in Contemporary Chinese* Book 1 (NTNU/Shida), with FSRS-5 scheduling, handwriting practice with stroke-order animations, tone-colored pinyin with speech, and a live "brain" visualization of every character you know.

## Deploy to GitHub Pages (one-time, ~5 minutes)

1. Create a new repo on github.com (e.g. `zika`), **Public**.
2. Upload everything in this folder (drag-and-drop works on github.com → "uploading an existing file"). Keep the folder structure (`assets/` etc.).
3. Repo → **Settings → Pages** → Source: "Deploy from a branch" → Branch: `main`, folder `/ (root)` → Save.

Two minutes later your app is live at `https://<your-username>.github.io/zika/`.

### Or with git / Claude Code

```bash
cd site
git init && git add -A && git commit -m "字卡 v3"
gh repo create zika --public --source=. --push
gh api repos/{owner}/zika/pages -X POST -f 'source[branch]=main' -f 'source[path]=/'
```

Or just tell Claude Code: *"deploy this folder to GitHub Pages"*.


## Cloud sync between devices (v18)

Progress syncs through a Firebase Realtime Database. Both devices join the same **sync code**; every save writes the whole study state (last write wins) and the other device picks it up within about a second. Offline, the app keeps working from its local copy and pushes when it reconnects.

### One-time Firebase setup (about 5 minutes)

1. https://console.firebase.google.com → **Add project** (name it `zika-sync`, Analytics off).
2. **Build → Realtime Database → Create database** (any region, start in test mode).
3. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable**.
4. **Project settings (gear) → Your apps → Web (`</>`)** → register the app → copy the `firebaseConfig` object.
5. Either paste that object into `const FIREBASE_CONFIG = …` near the end of `index.html`, or open the app → **Settings → Cloud sync → Firebase config** and paste it there (per browser).
6. **Realtime Database → Rules**, replace with the rules below and publish.

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

The `.validate` line makes the server reject any write older than what it already holds, so a stale device can never overwrite a newer one.

### Linking devices (v28: one scan)

**Mac:** Settings → Cloud sync → **Generate**. The card then shows a QR code and a *Copy link* button.
**iPad:** point the Camera at the QR code → tap the link → Safari opens the app already linked and pulls the Mac's deck. Then Share → **Add to Home Screen**. The home-screen app has its own storage on iPadOS, so open it once and type the same code on the *Cloud sync is off* card on Today → **Link**. Done — it stays linked.

A device that has never reviewed anything adopts the cloud copy silently; one that has its own progress asks which copy should win.


On the first device: **Settings → Cloud sync → Generate**. Type the same code on the second device and tap **Link**. If both devices already hold progress, the app asks which copy should win. The `Mac` / `iPad` badge in the header shows this device's name and the sync state: pulsing = sending, ✓ = synced, hollow = offline.

Device-local settings (voice, audio source, appearance, backup file) do not sync; everything else does.

## On your phone

Open the URL in Safari/Chrome → Share → **Add to Home Screen**. It installs like a native app and works offline after the first visit (reviews on the MRT included). Progress lives in the browser and, once Cloud sync is set up (below), on every device that shares your sync code.

## Best audio

The app uses your device's speech voices and auto-picks the best Mandarin one. In desktop Chrome, open Settings (in-app) and select **"Google 國語（臺灣）"** for Google-Translate-quality Taiwanese Mandarin. On iPhone, iOS's built-in **Mei-Jia** (zh-TW) is used automatically.

## Updating the app

Replace `index.html` with a newer version and push — your progress is untouched (it lives in your browser's storage, not the file). Keep occasional JSON exports as backup insurance.

## What's in here

```
index.html            the entire app (vocab data embedded)
sw.js                 offline cache (PWA)
manifest.webmanifest  home-screen install metadata
assets/
  hanzi-writer.min.js stroke-order animation engine
  strokes/            stroke data for all 490 Book 1 characters
  icon-192/512.png    app icon
```

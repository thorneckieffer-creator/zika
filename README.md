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

## On your phone

Open the URL in Safari/Chrome → Share → **Add to Home Screen**. It installs like a native app and works offline after the first visit (reviews on the MRT included). Progress is saved per-device in the browser — use **Settings → Export/Import** to move progress between devices.

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

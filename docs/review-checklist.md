# What "right" means

The list the checker holds every change against (`.claude/agents/verify-app.md`). A change passes only if every line that applies to the screens it touched is true. Where to find each feature and how to exercise it is in [feature-map.md](feature-map.md).

**The rule for this file: any note Thorne has had to give twice becomes a line here**, in the last section, with the month he said it. Then nobody, person or assistant, makes that mistake a third time. Lines that a script can check belong in `tools/check.mjs` instead, where they cannot be skipped.

## Checked by the script, not by eye

`node tools/review.mjs pass` runs `node tools/check.mjs` and refuses to record a PASS if it fails: every script block parses, the two version numbers agree, the storage key has not moved, the automatic backup file is still offered as `zika-progress.json`, the word, grammar and usage data are sound, the voice packs and dictionary are whole, the manifest has no `id`, the viewport still forbids zooming, and the tone coach still hears synthetic tones.

## Every change

1. The app loads at 390 × 844, 820 × 1180 and 1180 × 796 with no errors in the console from its own code, and no failed request for a file it ships.
2. The version at the foot of Review is the one being released.
3. Nothing scrolls sideways on the phone.
4. The phone has its bottom bar of four (Today, Review, Drill, More). Wider screens have the text row under the top bar. The top bar stays in view.
5. At 1180 × 796 the answer side of a review card and its four grade buttons fit without scrolling.
6. On the phone the grade buttons stay above the bottom bar, however long the answer is.
7. A sheet is never taller than the screen: it scrolls inside itself. A toast shows above an open sheet, so its Undo can be tapped.
8. Every finished state offers a way to keep going (a finished session, an empty deck, a lane with nothing due).
9. A lesson is always named book by book: "Book 2 · Lesson 7" or "B2 L7". A bare running number ("Lesson 22") anywhere on screen is a fail.
10. The changed screens are readable in the night colours and with a second accent colour. A white box at night, or text that vanishes, means a literal colour was used instead of a variable.
11. New work uses a sheet, or acts and offers Undo. It does not open a browser alert or confirm box.
12. The page still does not zoom: focusing a field on the phone does not enlarge the page. (The script holds the viewport setting.)
13. What the change was meant to do, it does. Test the request itself, not only that nothing broke.

## Look and feel

From [design.md](design.md). These fail a change that adds or alters a screen.

14. **Nothing was restyled that the request did not ask for.** Compare the changed screens with the last release, which the checker serves beside the change (never with the live site); an unasked change to colour, spacing, type or layout is a fail.
15. Flat surfaces: no shadows, no textures, no gradients, no hover lift.
16. One filled button per screen, for the one thing to do next. Everything else is quieter.
17. Colour means something: the brand colour is for things you tap, green is for learned or correct. A result is never written in the brand colour and a button is never filled with green.
18. Sentence case. No letter-spaced capitals. A label says what the thing is.
19. Study characters are in the face chosen in Settings; interface text is always sans.

## When the change touches saved progress, settings or sync

From the rules in [CLAUDE.md](../CLAUDE.md).

20. Grade a card, reload: the grade, the day's counts and the queue are as they were left.
21. A deck saved by the previous version opens in the new one with every card's schedule intact: make the deck in the last release, served beside the change, then open the change on it. Reload twice: a migration must do nothing the second time.
22. A setting that belongs to the device (voice, theme, backup file, offline pack) is still set after a reload and is not offered to other devices.
23. No test linked the local copy to a sync room, and no sync code appears in any file, screenshot or report.

## When the change adds or edits content

24. New words appear under the right book and lesson in Library, with pinyin and meaning, and can be studied.
25. A new word and each of its characters plays audio, or falls back to the system voice with no error.
26. A new character opens its stroke order and components. A gap is listed in the report, not hidden.
27. A file under `assets/` that changed under the same name reaches a device that already holds the old one: its `?v=` was raised where the app and `sw.js` ask for it, or `ASSETS` in `sw.js` was bumped. Assets are served from the cache first, so without that the devices keep the old file for good. This is the one line checked by reading the diff: the checker's browser does not hold the old file at the same address.

## Standing notes from Thorne

Seeded from [design.md](design.md) and [architecture.md](architecture.md). Add to this list; do not rewrite it.

- Do not restyle the app unless he asks, and when he asks, change one thing at a time so he can judge it. (Nov 2026; v48 was reverted for this: "It was way cleaner before.")
- The original colours on flat surfaces, sans characters, no texture. (Nov 2026)
- Book by book, never a running total of lessons.

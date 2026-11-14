# Other users: what it would take

The app was built for one learner. This is the plan for opening it to others, in the order the work should happen. Nothing here is built yet except where a version is named.

## Where it stands

| Piece | Today | Why it does not stretch to other people |
|---|---|---|
| Identity | A *sync code*. Whoever holds it can read and write that deck. | It is a shared password with no owner: no sign-in, no recovery, no way to revoke one device. |
| Storage | `rooms/<code>/study_state` in Firebase Realtime Database, anonymous sign-in. | The rules let any signed-in client open any room whose code it knows. |
| Sync | The whole deck is written on every save; the newest write wins. | Two devices studying at once lose one side's reviews, and every save re-sends everything. |
| Profile | Name, book and lesson are settings (`userName`, `curLesson`) since v44. | Ready. |
| First run | The start-up migrations (`_v11` … `_v38`) replay Thorne's own history: a brand-new device lands on Book 2 · Lesson 11 with his exam range. | A new learner needs a clean start, not his. |
| Personal links | `NOTION` and `NOTION_LESSON` point at Thorne's Notion pages. | They mean nothing to anyone else. |
| Content | Books 1–3 word lists follow the publisher's textbook. | Fine for one student's study tool; distributing them as a product needs the publisher's permission. |
| Voices | 曉臻 from Microsoft's read-aloud service; `audio-me` is Thorne's cloned voice. | The read-aloud service is an unofficial route with no licence to redistribute what it produces, and a personal voice must never ship to other people. |

## The steps

1. **A clean first run.** One function, `freshInstall()`, that sets every migration flag without running the migrations, then asks three things: name, book and lesson, and "which lessons do you already know" (the Library's *Know it all* does the marking). Decks with history skip it. Remove the rule in the v44 block that names an unnamed deck "Thorne".
2. **Accounts.** Firebase Authentication with Apple, Google and email-link sign-in. A device that is signed in anonymously is *upgraded* (`linkWithCredential`), so nothing on it is lost.
3. **Storage per person.** Move the deck to `users/<uid>/…` with rules that allow only that user:

   ```json
   { "rules": { "users": { "$uid": { ".read": "auth.uid === $uid", ".write": "auth.uid === $uid" } } } }
   ```

   Thorne's migration: on first sign-in, copy `rooms/<code>/study_state` to his user path and leave the room read-only for a month. The sync code and QR link stay as the way to add a device, but they hand over a sign-in, not the deck.
4. **Sync by card, not by deck.** Write `users/<uid>/cards/<card id>` and `users/<uid>/log/<day>` as they change, and merge by each card's `last` timestamp. This removes the lost-review case and cuts traffic from the whole deck per save to one card per review. It is also what keeps the free Firebase plan (1 GB stored, 10 GB downloaded a month, 100 devices connected at once) sufficient for longer: whole-deck sync spends the download allowance on every review. Measure a real deck's size before deciding how many learners the free plan carries.
5. **Personal things become personal.** Notion links move into settings (empty by default). A cloned voice is stored per user (Firebase Storage or on the device only) and is never part of the public bundle.
6. **Content and voice rights.** Before inviting anyone outside a private circle: ask NTNU MTC / Linking Publishing about the word lists, or ship the app with *My words* and shared decks only and let each learner import their own book. Rebuild the bundled voice with a licensed service (Azure Speech has the same voices) or the open model.
7. **Account basics.** Delete-my-data, export (exists), a privacy note, and Firebase App Check so the database cannot be scripted from outside the app.
8. **Later, if it becomes a class tool.** A class is a shared `curLesson` and exam date that members follow; a teacher sets them once.

## What v44 already did toward this

- The learner's name and course position are settings, shown in the greeting and the *Where you are* sheet, instead of text in the page.
- *My words* gives every learner a deck that does not depend on the textbook's content.
- New code lives in its own script block with its own prefixes (`sh*`, `my*`), not in another wrapper layer.

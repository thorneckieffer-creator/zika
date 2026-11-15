# Other users: the decided design

The app was built for one learner. This file is how it opens to others: what was decided and why, what was rejected, what is built, and what a person still has to do by hand.

**State (November 2026).** The accounts foundation is built and tested as stand-alone files. **Nothing is wired into the app, and nothing has been changed in the live Firebase project**: the app the learner studies with is exactly as it was.

| Piece | Where | State |
|---|---|---|
| Who a device is, joining, sign-out, delete, export, the move out of a room | `js/account.js` (`ac*`) | Built; tested against a fake Firebase. Not loaded by the page. |
| Security rules | `firebase/database.rules.json`, explained in [firebase/README.md](../firebase/README.md) | Built; tested with two rule evaluators. Not published. |
| Sync by record | `js/sync-records.js` (`sy*`) on branch `users-sync`; **its notes, `docs/sync.md` there, are the data layout** | Built there; run against these rules here. Not loaded by the page. |
| A clean first run for a new learner | — | Not built (step 1 below). |

## Where it stands

| Piece | Today | Why it does not stretch to other people |
|---|---|---|
| Identity | A *sync code*. Whoever holds it can read and write that deck. | It is a shared password with no owner: no sign-in, no recovery, no way to remove one device. |
| Storage | `rooms/<code>/study_state` in Firebase Realtime Database, anonymous sign-in. | The rules let any signed-in client open any room whose code it knows. |
| Sync | The whole deck is written on every save; the newest write wins. | Two devices studying at once lose one side's reviews, and every save re-sends everything. |
| Profile | Name, book and lesson are settings (`userName`, `curLesson`) since v44. | Ready. |
| First run | The start-up migrations replay Thorne's own history: a brand-new device lands on Book 2 · Lesson 11 with his exam range. | A new learner needs a clean start, not his. |
| Personal links | `NOTION` and `NOTION_LESSON` point at Thorne's Notion pages. | They mean nothing to anyone else. |
| Content | Books 1–3 word lists follow the publisher's textbook. | Fine for one student's study tool; distributing them as a product needs the publisher's permission. |
| Voices | 曉臻 and 雲哲 from Microsoft's read-aloud service; `audio-me` is Thorne's cloned voice. | The read-aloud service is an unofficial route with no licence to redistribute what it produces, and a personal voice must never ship to other people. |

## The decisions

| Question | Decision |
|---|---|
| Who is a person? | A Firebase uid. Every device signs in anonymously the first time it opens, as today, and owns a tree at `users/<uid>`. An **account** is that same uid with an email and password attached — the device is upgraded, not replaced, so nothing moves. |
| How does a person sign in at launch? | **Email and password.** It is the one method that never leaves the page, so it works the same in Safari, on a Mac and inside an app installed on an iPhone's Home Screen. Google comes second, Apple third, each only after a test on a real device. |
| How does a second device get in? | **Either way.** Sign in with the same email, or — with no account at all — the new device shows an eight-character code, a device that owns the deck types it, and the new device is *approved*: the rules let that one device read and write the owner's tree until the owner removes it. |
| Where is the deck? | `users/<uid>/rec/…`, one record per card, setting, day and list member. The layout is the sync engine's (`docs/sync.md` on `users-sync`). |
| What about the old rooms? | Untouched. The `rooms` branch of the rules is word for word what is published today; the app keeps using its room until the learner moves the deck, once, by choice. |
| A cloned voice? | Never stored online. The rules have no branch for it and refuse anything they do not list. |
| App Check? | Registered and watched at launch, **enforced on the database only once every one of the learner's devices runs a version that sends tokens**. |

## How a person signs in

The app is static files on `github.io`, with no server, and its main home is an app installed to an iPhone or iPad Home Screen. That combination rules most sign-in methods out. What was found, with the source for each:

| Method | What stands in the way | Verdict |
|---|---|---|
| **Email + password** | Nothing. The page sends the email and password to Firebase and gets a session back: no second window, no trip to another site, no storage shared with anyone. Attaching one to an anonymous device keeps its uid ([Firebase: anonymous auth](https://firebase.google.com/docs/auth/web/anonymous-auth)). | **Launch.** |
| Email link ("magic link") | The free plan sends **five** sign-in-link emails a day for the whole project ([Firebase Auth limits](https://firebase.google.com/docs/auth/limits)). And the link opens in Safari, whose storage an installed Home Screen app does not share ([iOS PWA compatibility](https://firt.dev/notes/pwa-ios/): storage shared with the browser — no; only a push message can open an installed app), so the sign-in would finish in the wrong place. | Rejected. |
| Google through Firebase's redirect (`signInWithRedirect`) | Since browsers began blocking third-party storage (Safari 16.1, Firefox 109, Chrome 115) it only works if the sign-in helper is served from the app's own domain: by Firebase Hosting, a reverse proxy, or a copy of the helper files at `/__/auth/` ([Firebase: redirect best practices](https://firebase.google.com/docs/auth/web/redirect-best-practices)). GitHub Pages can do none of those for a project site. | Not possible here. |
| Google through Firebase's pop-up (`signInWithPopup`) | The same page offers it as the fallback, with the warning that pop-ups are sometimes blocked. In an installed iPhone app the pop-up has a history of opening and never handing the result back ([firebase-js-sdk #77](https://github.com/firebase/firebase-js-sdk/issues/77): closed as fixed in 2020, with mixed reports after). | Not for launch. |
| Google's own button (Google Identity Services) | Google's page says redirect mode is required on iOS, and redirect mode *posts* the token to a server address ([supported browsers](https://developers.google.com/identity/gsi/web/guides/supported-browsers), [`login_uri`](https://developers.google.com/identity/gsi/web/reference/js-reference)). A static site cannot receive a POST. | Not possible here. |
| **Google by a full-page trip** | The page goes to Google and comes straight back to the app's own address with an ID token in the address (`response_type=id_token`, listed in [Google's OpenID configuration](https://accounts.google.com/.well-known/openid-configuration)); the app hands it to Firebase (`linkWithCredential` / `signInWithCredential`, the "sign in with the provider independently" option of the Firebase page above). No pop-up, no third-party storage, no server, no Google script in the page. **Unknown:** where that trip lands inside an installed iPhone app — a page outside the app's own address opens in an in-app browser there, and reports differ on whether the way back arrives in the app's storage. | **Second.** Built (`acGoogleUrl`, `acGoogleToken`, `acSignInWithIdToken`), switched off until a client id is set, and not to be switched on before it has been tried on a real iPhone, installed. |
| Apple | Needs a paid Apple Developer membership, a Services ID, a verified domain and a key ([Firebase: Apple](https://firebase.google.com/docs/auth/web/apple)). Firebase's flow for it is the same pop-up or redirect as above. Apple's own redirect returns a name or email only by POST ([Apple forum](https://developer.apple.com/forums/thread/121760)); without them it can return an ID token in the address, which would fit the full-page trip. | **Third**, if there is a membership and learners ask. Not built. |
| Passkeys | Firebase Authentication has no passkey sign-in in its web SDK; the request is open ([firebase-js-sdk #2123](https://github.com/firebase/firebase-js-sdk/issues/2123)) and the community add-on runs on Cloud Functions, which the free plan does not have. | Not available. |

Two details of the email-and-password choice:

- **The emails Firebase sends** (confirm your address, reset your password) open in Safari. That is fine: they act on the account, not on the device. Back in the app, *I have confirmed* re-reads the account.
- **The SDK version matters.** Projects created after September 2023 protect against finding out which emails have accounts; with that on, attaching an email to an anonymous user needs web SDK 10.6.0 or newer ([email enumeration protection](https://cloud.google.com/identity-platform/docs/admin/email-enumeration-protection)). The app loads 10.12.0. For the same reason a wrong password and an unknown email read the same, and the reset message never says whether the address exists.

**What cannot be known without a real device:** that an installed Home Screen app keeps its sign-in between launches and across iOS updates (documented, not observed here); the whole Google trip; how the email, password and code fields behave with the iPhone keyboard and password manager; and that the look is right — this work was done without a browser.

## How a second device joins

Decided: **both** — the same account on every device, *or* approval by code — because each covers what the other cannot.

**Approval by code** (works with no account):

1. On the new device: Settings → Account → *Join with a code*. It shows eight characters (`ABCD-2345`, an alphabet without look-alikes), a QR code of the same, and waits. In the database it has written `joins/<code>` with its own uid and name.
2. On a device that owns the deck: *Add a device*, type the code. It shows the name the new device gave and asks. On *Let it in* it writes, in one step, `users/<owner>/devices/<new device's uid>` and the answer on the request.
3. The new device sees the answer, checks that the owner's tree really lets it in, clears its request and its own online copy, and from then on uses `users/<owner>`. What it had studied on its own stays on it and is merged by the sync engine.

The code is typed, not scanned, as the main path on purpose: on an iPhone the Camera opens links in Safari, never in the installed app, so a scanned link would arrive in a browser that does not hold the deck. The approve sheet warns when it is opened in a browser where nothing has been studied.

| Concern | How it comes out |
|---|---|
| **Removing one device** | The owner deletes its entry. Its writes are refused from that moment; it finds out at its next write or start, goes back to a tree of its own and keeps what it holds. |
| **A lost device that was approved** | Remove it from the list on the owner's device. The thief keeps the copy that was on it, as with any lost phone. |
| **A lost device that was signed in with the email** | Change the password (the reset email): Firebase withdraws the other sessions, within the hour that a session token lives. A "sign out everywhere, now" switch is possible in the rules ([session revocation](https://firebase.google.com/docs/auth/admin/manage-sessions)) and was left out: one more thing that can lock the owner out. |
| **The owner's device is lost and there was no account** | The other approved devices keep syncing with each other, but nobody can add or remove one. On any of them: *Leave* (it keeps its copy as a deck of its own), create an account there, and let the others in again. The panel says plainly, while there is no account, that the deck hangs on one device. |
| **A learner who never wants an account** | Never needs one. Anonymous devices and codes are the whole system for them. |
| **Who may approve** | Only the owner's uid: the owning device, or any device signed in with the owner's email. An approved device cannot approve another. |
| **Cost** | One extra lookup inside the rules per read or write, which is not billed. A request is about 100 bytes and is deleted when used; one user can hold one at a time. |
| **A guessed code** | A code lives ten minutes, the list of requests cannot be read, and there are 31⁸ ≈ 8.5 × 10¹¹ codes. Someone who did guess one could answer it first and pull the new device into *their* deck (never the other way round: a code gives no access to anything). |

Rejected:

- **Keep the sync code as the way in.** A permanent shared secret with no owner is the problem being solved.
- **The owner shows a code and the new device claims it.** Then the code *is* access to the deck for as long as it lives. The other way round, a leaked code gives nothing: only the owner, on the owner's device, approves.
- **Custom tokens, or a device-code flow.** Both need a server.
- **Sign-in only.** A no-account learner would be left with one device, and adding a phone would mean typing a password on it.

## The data, and the rules

The deck lives in `users/<uid>/rec/<kind>~<id>`; a record is `{h, m, j}` — a version stamp, the server's time, the value as JSON — or `{h, m, d: 1}` when deleted. **`docs/sync.md` on branch `users-sync` is the definition**; this file does not repeat it. Around it, `js/account.js` keeps `devices`, `joining`, `profile`, `meta/migration`, and the top-level `joins`.

The rules are explained branch by branch in [firebase/README.md](../firebase/README.md). In outline:

- `rooms/…` exactly as today.
- `users/<uid>`: read by the owner and approved devices; `rec` and `meta/v` written by both; `devices`, `profile`, `meta/migration`, `joining` by the owner alone; the whole tree deletable by the owner in one write; anything unlisted refused.
- A record must carry the server's time, a well-formed stamp **not older than the stored one**, and exactly a value or a deleted mark; a value is at most 100,000 characters.
- `joins/<code>`: one standing request per user; answered once, within ten minutes, only by an account that approves the device in the same write.

**What the live rules are.** They cannot be read from here. Two things say what they must be: `README.md` publishes a rules text for anyone who forks the app, and the client depends on it — `fbPush` treats a refused write as "another device saved more recently", which only the `synced_at` rule in that text produces. The `rooms` branch here is that text, and a test compares the two. **Before anything is published, a person must read the real rules in the console and compare** (the steps are in firebase/README.md).

**How far the rule tests can be trusted.** They run on two independent evaluators of the rules language, agree on 184 cases and 30,000 generated operations, and every condition in the rules is shown to matter by removing it. That is good evidence that the rules say what was meant, and no evidence about Google's own implementation where the documentation is thin — above all the string comparison the newer-only rule uses. The official emulator needs Java, which this machine does not have; the script and commands for it are ready, and unrun.

**The free plan.** With sync by record the engine's own measurements (`docs/sync.md`) put a full deck at 785 KB and a learner-month at about 5 MB of downloads: roughly 800 to 1,300 active learners on the free plan, limited first by 100 simultaneous connections and by 1 GB of storage. The rules cap every record but **cannot cap what one account stores in total**; firebase/README.md says why, and what protects the plan instead (App Check above all).

## Moving Thorne's deck

Designed, and tested against a fake. **Not run.** Not to be run before the exam.

Before: the release that loads `js/account.js` and the sync engine is on all three devices' way; the new rules are published; App Check is not enforced.

1. **On the Mac**, update the app and wait for the sync pill to say *synced*. The Mac and the room now hold the same deck.
2. Settings → Account → **Create account** (email and password). The Mac's uid does not change.
3. **Move the deck** — `acMigrateRoom({code, local: {at: SYNC.at, dirty: SYNC.dirty}})`:
   - refuses unless the Mac has nothing unsent and is level with the room;
   - reads `rooms/<code>/study_state`, once. It never writes to the room and stores the code nowhere;
   - writes a marker, `users/<uid>/meta/migration` = *copying*;
   - hands the blob to the sync engine's import (`syImport`), which turns it into records stamped as old — so anything studied later, anywhere, wins over it — and sends them;
   - sets the marker to *done*.
   Run again, it sees *done* and does nothing. Interrupted, it leaves *copying* and the next run repeats the import, which is harmless for the reason above.
4. The Mac stops using the room (stop listening; keep the code in storage, marked retired) and syncs `users/<uid>` from now on.
5. **On the iPad and the iPhone**, update, then either sign in with the email or *Join with a code* approved on the Mac. Whatever each studied after step 3 is on that device and is merged record by record when it joins. A device still running the old version keeps writing to the room, which nothing reads any more: those reviews wait on that device until it updates and joins.
6. Check the three devices agree: cards started, the streak, today's counts.
7. **The way back**, at any time: the room still holds the deck as it was at step 3. Clearing the *retired* mark on each device resumes the old sync.
8. A month later, delete the room by hand in the console — after asking Thorne ([CLAUDE.md](../CLAUDE.md)).

## Account basics

- **Delete my data.** One button. For an owner: the online tree in one write, then the copy on the device, then the sign-in itself; an account types its password first, so that the server will accept removing the sign-in *before* anything is deleted. For an approved device: it leaves and erases its own copy; the deck is not its to delete. The old room, if there is one, is not touched by this (step 8 above).
- **Export.** `acExportData()` returns everything the service holds for the deck as one object; the panel offers it as a file. The app's own export of the deck on the device stays as it is.
- **Sign out on this device.** Asks what to do with the copy: remove it (the default), or keep it as a deck of its own. Refuses to remove a copy that has changes the account has not received.
- **The privacy note** is `acPrivacyHtml()`: what is kept (progress, settings, My words, device names, an email if there is an account), where (this device; Google's Firebase in Singapore), who can read it (the learner and approved devices; the person who runs the app can see the database and does not share it), that voice recordings stay on the device, which other services the app talks to (GitHub Pages, Google's sign-in library, moedict.tw, jsDelivr), and how to export and delete. It was checked against the code: the app has no analytics and uploads no audio. It needs a contact address before launch.
- **App Check.** For a static site it needs a reCAPTCHA Enterprise key (score-based, for the site's domain) registered in the console, and one call at start-up, which `acBoot` makes when given the key ([Firebase: App Check for web](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)). Three cautions. *Enforcing* it locks out every copy of the app that does not send tokens, so it comes after all devices have updated, never before. A project without billing gets 10,000 reCAPTCHA assessments a month and errors beyond that ([reCAPTCHA billing](https://cloud.google.com/recaptcha/docs/billing-information)); each token refresh is one, so set the token's life to the maximum, seven days. And enforcing it on Authentication itself needs a paid upgrade: enforce on the database only.
- **Abuse limits** are in the rules: every field typed and sized, every record closed, unknown branches refused, one join request per user. What they cannot do is in firebase/README.md.

## Plugging in

Written against the restructured layout (`origin/next`: `js/core.js`, `js/sync.js`, `js/settings.js`, `js/boot.js`). On `main` the same functions are layers inside `index.html`. Nothing below is done.

| When | Where | What |
|---|---|---|
| The page loads | `index.html`: `<script src="js/account.js">` after `js/sync.js`, before `js/settings.js`; then `node tools/stamp.mjs` | Nothing runs: the file only defines `ac*` names. (`tools/check.mjs` on `next` fails for a file under `js/` the page does not name, so the tag arrives with the file.) |
| The SDK is imported | `fbLoad()` in `js/sync.js`: the import list and `window.__fbSDK` | Add what `acSdkSource()` lists. From `firebase-app.js`: `getApp, getApps, deleteApp`. From `firebase-database.js`: `update, remove`. From `firebase-auth.js`: `initializeAuth, inMemoryPersistence, linkWithCredential, EmailAuthProvider, GoogleAuthProvider, signInWithEmailAndPassword, signInWithCredential, reauthenticateWithCredential, sendEmailVerification, sendPasswordResetEmail, reload, signOut, deleteUser`. (`acBoot()` can load the SDK by itself instead; one loader is better than two.) |
| **Start-up: who is this device** | `fbBoot()` in `js/sync.js` | Replace the `sdk.onAuthStateChanged(…)` line with `acOn('root', onRoot); acStart(acFirebaseAdapter(SYNC.fb), hooks);` and **delete the line `await sdk.signInAnonymously(auth);`**. `js/account.js` signs in anonymously only when nobody is signed in; the unconditional call would throw an email account's session away at every start. |
| **The device's tree is known or has changed** — this is also sign-in and sign-out | `onRoot(e)`, new, beside `fbBoot`; `e = {root: 'users/<uid>', prev, why}` | Always: `SYNC.uid = acState().uid`. While this device still uses a room (it has a code and has not moved): `fbStart()` and return — the old sync runs as today. Otherwise start the engine on `e.root.slice(6)`: `why` `start` → `syStart(SY, {uid})`, and if that returns `false`, again with `join: 'merge'`; `join`, `signin` → `join: localEmpty() ? 'cloud' : 'merge'`; `leave`, `revoked`, `signout`, `delete` → `join: 'merge'` (the tree is this device's own and new); `reset` → the online copy was removed but the device stayed who it was: make the engine forget what it has sent (`syReset(SY)` and remove its stored shadow) and start with `join: 'merge'`. For an approved device the uid is the **owner's**. |
| Hooks handed to `acStart` | the `hooks` object | `deviceName: () => DEVICE.name`, `ownerName: () => S.settings.userName`, `deckSummary: () => ({started: …cards with a state…})`, `flush: () => syFlush(SY, true).then(() => !syStatus(SY).pending)`, `stopSync: () => syStop(SY)`, `importRoom: r => { syImport(SY, r); return syFlush(SY, true).then(() => { const st = syStatus(SY); return st.state === 'ok' && !st.pending && !st.parked; }); }`, and `wipeLocal`: remove the deck from this device — the deck under its storage key, the rolling backups, the engine's shadow (`SY_STORE`), the room code — then reload. `wipeLocal` does not exist yet. |
| The engine is refused | the `onStatus` passed to `syCreate` | `if (st.state === 'error' && /permission\|denied/i.test(st.err)) acDenied();` — a removed device finds out here. |
| The app comes to the front | the `visibilitychange` handler in `js/boot.js` that calls `checkForUpdate()` | `acCheckGrant();` |
| **The Settings screen** | `renderSet()` in `js/settings.js`, the line that inserts `syncPanel()` | Insert `acPanelHtml()` before it. The panel repaints itself (`acRender()` replaces `#acCard`); its buttons call `acOpen(…)`, which uses `shHost()` for the sheet and adds its few styles (`acCss()`) once. |
| **A link opens the app** | `linkFromHash` in `bootStart()`, `js/boot.js`, before it looks for `#sync=` | `if (/[#&](join\|id_token)=/.test(location.hash)) { const h = location.hash; history.replaceState(null, '', location.pathname + location.search); acHandleLink(h); return; }` — `#join=<code>` opens the approve sheet with the code filled in; `#id_token=…` finishes a Google sign-in. |
| **The sync code and its QR link** | `syncPanel()`, `syncLink()`, `fbCopyLink()`, `fbSetCode()`, `fbNewCode()` in `js/sync.js`; `ipadPanel()` in `js/settings.js` | Unchanged while a device uses a room. Once it has moved, they are not shown: *Add a device* and *Join with a code* in the Account panel replace the code, the QR link and the iPad steps. A `#sync=<code>` link opened on a moved device should say so and point at *Join with a code* rather than call `fbSetCode`. `qrSvg()` is reused by the join sheet. |
| The move out of a room | a row in the Account panel or a card on Today, new; shown only to a device that has a room code and no finished move | `acMigrateRoom({code: SYNC.code, local: {at: SYNC.at, dirty: SYNC.dirty}})`; on `ok`, stop the room listener (`SYNC.unsub()`), store a *retired* mark that `fbStart` respects, and call `onRoot` again so the engine starts. |
| Release | `tools/check.mjs`, `docs/releasing.md`, the layout table in `CLAUDE.md` | Add `node --test tools/test/*.test.mjs` and `node firebase/build-rules.mjs --check` to the release check; name `js/account.js`, `firebase/` and `tools/test/` in the notes. |

Device-local state: `js/account.js` keeps `zika_account` (whose deck this device uses) and `zika_ac_nonce` in `localStorage`. Neither is part of the deck, and neither may sync.

## Before launch: a checklist for a person

Console steps. None has been done. Not before the exam.

- [ ] **Authentication → Sign-in method:** enable *Email/Password* (leave *Email link* off). *Anonymous* stays on.
- [ ] **Authentication → Settings → Authorised domains:** the site's `github.io` address is listed.
- [ ] **Authentication → Settings → User actions:** *Email enumeration protection* is on.
- [ ] **Authentication → Templates:** the sender name and the wording of the *confirm your address* and *reset your password* emails.
- [ ] **Realtime Database → Rules:** save the current text; compare its `rooms` branch with `firebase/database.rules.json`; try the three writes in the Rules Playground; publish; open the live app and see it sync ([firebase/README.md](../firebase/README.md#publishing-a-person-does-this-not-a-script)).
- [ ] **Realtime Database → Usage**, after the first real sync by record: the browser console shows no "unspecified index" warning for `m`.
- [ ] **App Check:** in the Google Cloud console create a reCAPTCHA Enterprise key (website, score-based) for the site's domain; in Firebase register the web app with it and set the token's life to seven days; give the key to `acBoot`. Leave it **unenforced**. When the request graph shows nearly everything verified and all three devices are updated, enforce it for Realtime Database only.
- [ ] **A real iPhone, with the app installed to the Home Screen:** create an account; close and reopen — still signed in; join a second device by code; remove it; sign out; delete.
- [ ] **The privacy note:** add a contact address.
- [ ] **Later, for Google:** an OAuth web client whose redirect address is exactly the app's address; that client id allowed in Firebase's Google provider; the provider enabled; the id given to `acStart` as `googleClientId`; then the same iPhone test, through Google.

## Rights questions that remain

Before inviting anyone outside a private circle:

- **The word lists.** Books 1–3 follow *A Course in Contemporary Chinese*. Ask NTNU MTC / Linking Publishing, or ship the app with *My words* and shared decks only and let each learner import their own book.
- **The bundled voices.** 曉臻 and 雲哲 come from Microsoft's read-aloud service, which gives no licence to redistribute. Rebuild the packs with a licensed service (Azure Speech has the same voices) or an open model.
- **The dictionary** (CC-CEDICT, CC BY-SA 4.0) is credited in the app; keep the credit.
- **A cloned personal voice** stays on its owner's devices. Storing one online would need Cloud Storage, which is no longer on the free plan ([Firebase Storage changes](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)), and a rule as strict as the deck's.

## The steps, and where each is

1. **A clean first run.** One function, `freshInstall()`, that sets every migration flag without running the migrations, then asks three things: name, book and lesson, and "which lessons do you already know". Decks with history skip it. Remove the rule that names an unnamed deck "Thorne". *Not built.*
2. **Accounts.** *Built, not wired* (this file).
3. **Storage per person.** *Rules built, not published.*
4. **Sync by record.** *Built on `users-sync`, not wired.*
5. **Personal things become personal.** Notion links move into settings (empty by default). A cloned voice stays on the device. *Not built.*
6. **Content and voice rights.** Above. *Open.*
7. **Account basics.** Delete, export, sign-out and the privacy note are built; App Check is a console step.
8. **Later, if it becomes a class tool.** A class is a shared `curLesson` and exam date that members follow; a teacher sets them once.

## What is not built, and what was not verified

- Nothing is loaded by `index.html`; no version was bumped.
- `acFirebaseAdapter()` and `acBoot()` — the forty lines that call the real SDK — have never run. Every test uses a fake.
- The panel and sheets were never seen in a browser (this work was done without one). `node tools/test/account-preview.mjs` writes a page that shows every state inside the app's stylesheet, for the first person who can look.
- The official emulator was not run (no Java here); `tools/test/rules-emulator.mjs` is unrun.
- The Google trip is unverified on any device, and is off.
- `wipeLocal`, the *Move the deck* button, and the retired mark for a room are the app's to write.
- There is no screen for changing a password or an email (reset by email works), and no "sign out everywhere".
- Deleting a room is not built, and should stay a thing a person does.

## Decisions a reviewer might dispute

- **Email and password first, not Google or Apple.** Chosen on what can be shown to work on a static site inside an installed iPhone app. Cost: a password to remember.
- **An approved device is not an account.** It is an anonymous sign-in the owner vouches for. Lose the owner's device with no account, and no one can manage the list (the way out is above).
- **The new device shows the code and the owner types it**, not the other way round, and typing rather than scanning is the main path.
- **Approved devices can write and delete records but not approve others.** A household of equals was simpler and was rejected: one stolen device could then lock the rest out.
- **Signing in on a device deletes that device's own anonymous online copy** (after the password has been checked on the side); the deck stays on the device and is merged. Otherwise every sign-in would leave an orphan deck in the database.
- **Only a guest may join by code.** An account signs out first; a deck with devices on it removes them first.
- **The move leaves the room completely untouched** — not even a note saying the deck has moved — so the other devices are told by the app's own screen, not by the database.
- **No per-account storage cap,** because the rules language cannot count; and a 100,000-character limit on one record that is generous on purpose, since a refused record stops syncing for that record.
- **`meta/v` can only go up,** which the engine did not ask for.
- **The rules are generated** by a script rather than typed, and tested by an evaluator written for this project, cross-checked with a second one, because the official emulator could not run here.
- **App Check unenforced at launch.**

## What v44 already did toward this

- The learner's name and course position are settings, shown in the greeting and the *Where you are* sheet, instead of text in the page.
- *My words* gives every learner a deck that does not depend on the textbook's content.
- New code lives in its own files with its own prefixes (`sh*`, `my*`, `ac*`, `sy*`), not in another wrapper layer.

# Running costs

Every cost the app has or would have, written here as it appears and before it is switched on ([master-plan.md](master-plan.md#toward-a-real-product-added-21-november-later-the-same-evening)). Thorne reads this before any of them starts. A figure marked *to check* has not been read off the provider's own price list on the date given; check it when the step comes.

**Today the app costs nothing a month.** Nothing below is switched on.

| Service | What it pays for | A month | When it would start | State |
|---|---|---|---|---|
| GitHub Pages | Serving the app from the public repository | 0 | running | free |
| Firebase (Spark plan) | The room-code sync, until v70 removes it | 0 | running | free |
| Supabase, project `zika-dev` | The test database: tables, sign-in, the pushed signal | 0 | running since 16 November 2026 | free plan; pauses after about a week idle and is restored by hand |
| Supabase, the real project | Thorne's deck from the move (backend step 10) on | 0 on the free plan | before v69 | not made yet. The free plan has no automatic backups: the devices and the export files are the backup |
| Supabase, a paid plan for the real project | A project that does not pause, with automatic backups | about $25 (*to check*: the figure an earlier session reported on 16 November) | before anyone outside (step 12) | not started; Thorne's yes needed |
| A mail service | The confirmation and password-reset emails; Supabase's built-in sender is for testing only | *to check* | before anyone outside (step 12) | not chosen |
| Azure Speech | Licensed voice clips, if the Voice V1 test picks it: a one-off cost for building the packs, not a monthly one. The paid tier's terms allow the audio to be used in an app others use | one-off, about **$3.86** for one voice with every syllable pinned (8,633 clips; $7.71 for two voices; $1.33 a voice as plain text). $15 a million characters, read on Microsoft's price list on 21 November 2026 ([voice.md](voice.md#v1--side-by-side)) | Voice V1 (under $1 for the 62 test words), then V2 | no account yet; needs Thorne's Azure account with a Speech resource on the paid tier, and his yes |
| ElevenLabs | The Voice V1 test through the connector, on Thorne's existing account; a full pack only if V1 picks it. Only a paid plan's audio may be used in an app others use | the test: free plan, 15 credits used for 9 words on 21 November, 106 more for the other 53. The full set: **$22**, one month of the Creator plan (44,320 credits a voice) | V1 now; V2 only on his yes | 9 of 62 test words made; the free queue refused the rest |
| A domain, another host | An address of the app's own; a private repository (Pages from one needs a paid GitHub plan) | *to check* | not before v69, and only after a rehearsal: the address rule | not decided; his decision |

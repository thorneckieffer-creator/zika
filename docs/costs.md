# Running costs

Every cost the app has or would have, written here as it appears and before it is switched on ([master-plan.md](master-plan.md#toward-a-real-product-added-21-november-later-the-same-evening)). Thorne reads this before any of them starts. A figure marked *to check* has not been read off the provider's own price list on the date given; check it when the step comes.

**Today the app costs nothing a month.** Nothing below is switched on.

| Service | What it pays for | A month | When it would start | State |
|---|---|---|---|---|
| GitHub Pages | Serving the app from the public repository | 0 | running | free |
| Firebase (Spark plan) | The room-code sync, until v69 removes it | 0 | running | free |
| Supabase, project `zika-dev` | The test database: tables, sign-in, the pushed signal | 0 | running since 16 November 2026 | free plan; pauses after about a week idle and is restored by hand |
| Supabase, the real project | Thorne's deck from the move (backend step 10) on | 0 on the free plan | before v68 | not made yet. The free plan has no automatic backups: the devices and the export files are the backup |
| Supabase, a paid plan for the real project | A project that does not pause, with automatic backups | about $25 (*to check*: the figure an earlier session reported on 16 November) | before anyone outside (step 12) | not started; Thorne's yes needed |
| A mail service | The confirmation and password-reset emails; Supabase's built-in sender is for testing only | *to check* | before anyone outside (step 12) | not chosen |
| Azure Speech | Licensed voice clips, if the Voice V1 test picks it: a one-off cost for building the packs, not a monthly one | *to check*; V1 reports the cost of the full set | Voice V2 | no account yet; Thorne's yes needed |
| ElevenLabs | The Voice V1 test of about 60 words through the connector, on Thorne's existing account; a full pack only if V1 picks it | the test uses his account's credits; the full set's cost comes with V1's report | V1 now; V2 only on his yes | test only |
| A domain, another host | An address of the app's own; a private repository (Pages from one needs a paid GitHub plan) | *to check* | not before v68, and only after a rehearsal: the address rule | not decided; his decision |

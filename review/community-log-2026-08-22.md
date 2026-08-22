# Community & moderation log — 2026-08-22

## Run 09:37 UTC

**Shipping route: (c), the project inbox.** `git push` refused as documented; GitHub REST is 403
for this repo unauthenticated as well as with the session token; no `mcp__remote-devices__*` tool
exists in this session at all. That last point is not a bridge outage — this run was started by
the scheduler, and scheduled runs in this environment are given no device bridge, so route (b) was
never available to it. The `requires_local_device: true` fix recorded in the status doc does not
appear to have changed that for this task. See "For Eve" below; that is now the one thing standing
between this session and shipping its own work.

## Pulse outage 09:50–10:00 UTC — resolved by the operator before this run could ship; one durable fix kept

Found at 09:51 while verifying this run's patch against a fresh clone: `main` would not build.
Commit `d133a5a` had committed a **merge-conflict marker into
`data/cases/alex-murdaugh-retrial/case.json`** — an autodeploy applied a stash without resolving
it. The file is JSON, so the damage was total rather than cosmetic:

- `poll.js` reads that case **first** (alphabetical) and died on `JSON.parse` before polling a
  single feed — no tickers, no verdict watch, **no verdict publishing, for all five cases**
- the workflow's first step is `node scripts/poll.js`, so commit/build/deploy never ran
- the pulse is what rewrites these files, so it could not heal itself

**It is already fixed and this run did not fix it.** Commit `1854ac1` (Eve's machine, 10:00 UTC)
resolved the conflict — keeping the same caption I had — cleared the same markers from `STYLE.md`,
and hardened `autodeploy.bat` to refuse to commit a conflicted tree at all. The 10:00:30 pulse ran
clean and the site is healthy. Recording it because a ten-minute verdict-publishing outage on the
week of a verdict is worth a line in the record even when someone else closed it, and because the
detail below is what the next session needs.

**What this run contributes that the autodeploy guard does not.** The guard stops one *cause* —
conflict markers. It does not stop a malformed case file arriving any other way, and the failure
mode was disproportionate: one bad caption took down verdict publishing for four healthy cases.
So the patch isolates it. Each case now polls in its own try/catch: a bad file is skipped loudly,
every healthy case still polls, any verdict still gets its chance to publish, and the state is
written to a committed `data/queue/health.json` so the next session reads the degradation on its
first look instead of inferring it from silence.

The pulse deliberately still exits **0** in that state. The commit step runs *after* it, so a red
exit would discard the data every healthy case just polled — punishing four cases for the fifth.

Verified by simulation rather than reasoning: corrupted a case file in a scratch copy and ran the
real pulse. `CASE FAILED (skipped, pulse continues): alex-murdaugh-retrial` → the other four
polled → `pulse complete` → `PULSE DEGRADED` → `health.json` written → exit 0.

**Standing note for any session:** read `data/queue/health.json` early. It is the cheapest signal
that the pulse is degraded, and it exists because nothing else said so for ten minutes.

## Moderation

### Queue state
`data/queue/issues.json`: one open item. `data/cases/*/community.json`: **0 nodes, 0 edges across
all five cases.** `data/cases/*/threads.json`: **0 comments across all five cases.** Nothing has
been auto-published by the pulse since the last run, so the fast-lane sweep had nothing live to
sweep. Recording that explicitly, because an empty log and a skipped log look identical.

### Action: issue #1 fails the rubric — held, and the site will stop seeding a thread from it

> **#1 — "Discussion: The voice she says commanded her"** (`<!--node:f-voice case:lindsay-clancy-->`)
> Body, in full: *"Could it have been her husband at the time?"*

**Rule failed: EDITORIAL.md §5** (accusations of crimes against people not charged) and the review
rubric's legal test. Lindsay Clancy's husband is a living private individual who has not been
charged with anything and who buried three children. The question proposes that he verbally
directed their killing. Run the standing test: this would publish as *"a reader asks whether X"*,
so it has to be safe **even if X is false** — and if it is false it is about as damaging as a
sentence can be. It is also the exact grammar EDITORIAL.md rejects by name: implication by
question. "Just asking questions" fails.

**Reader-visible exposure right now: none.** Verified rather than assumed — `syncThreads()` renders
only *comments*, never an issue body, and the board never exposes the issue URL. So the sentence is
not on ourgavel.com. What it *is* doing is sitting at the top of a discussion page attached to a
record node, framing the question that replies would answer.

**What I could do about it:** not close it — no GitHub write from this session. What I did instead
is remove the mechanism: a thread seed whose body fails the screen no longer opens a discussion
page (see below). Under the patch, `f-voice` stops being a thread on the next pulse. Readers lose
nothing — the node still shows "Start the discussion."

**Still needs Eve:** close or delete issue #1 on GitHub. The issue is authored by `evesloan`, so
this reads like a deliberate probe of the screen. It found something.

### The gap it found — and this is the substantive finding of the run

The name screen was tested against real text rather than trusted. It catches proper nouns and is
blind to every other way English points at a person. Verbatim output, run against the live
`personMentions()` and the Clancy case's own name sets:

```
AUTO-PUB  "Could it have been her husband at the time?"
AUTO-PUB  "the husband knew what was coming and did nothing"
AUTO-PUB  "the father was never properly investigated"
AUTO-PUB  "What about P.C.? He was the one who left the house."
AUTO-PUB  "Why has nobody asked the neighbour what he saw that night?"
AUTO-PUB  "you know who I mean, the one who went to the pharmacy"
HELD      "Patrick Clancy should be looked at"        hits=Patrick Clancy|Patrick
HELD      "Dr. Zeizel contradicted himself on cross"  hits=Zeizel
```

Six of eight accusations against uncharged people would have gone onto a public board inside
fifteen minutes, unseen. The screen holds you only if you are careless enough to type a surname.

**Second gap, worse, found while checking the first: thread comments were not screened at all.**
`syncThreads()` took every GitHub comment, ran the PII regexes over it, and rendered it. No name
screen, no hold, no editor. So a theory saying *"it was the husband"* was held for review while the
identical sentence posted as a **comment on the same node** published itself. The composer already
promised readers *"Replies appear on this card once reviewed"* — which was not true.

### Process failure, mine, stated plainly

I found the gap, built the fix, verified it — and only then read
`claude/ourgavel-inbox-community-2026-08-22.md`, which shows **an earlier session had already
found the same gap and written the same fix**, and that its patch has been sitting unapplied.
I should have read the pending inbox before writing a line of code. Recording it because the
next session will be tempted to do exactly what I did: the inbox is not an outbox, and an
unapplied handoff is live state.

**Reconciled rather than duplicated.** Handing Eve two patches that both create `scripts/screen.js`
is a good way to have neither land. The earlier patch also **cannot be applied any more** — it
predates the `question` submission kind, and its `ensureLabels()` would silently revert it. So
this run's patch **supersedes** it, and carries over the things the earlier draft got right that
mine had missed:

- **jurors (EDITORIAL.md §10)** — I had no juror rule at all. "Juror 7", "the foreman", "jury
  members" now hold in every lane. That was a real hole in my version.
- **possessives** — "Clancy's brother" identifies as precisely as "the brother".
- **`cleared[]`** — the mechanism that makes hold genuinely reversible: an editor adds a comment
  id and the next pulse renders it. Without it "held" quietly means "deleted".
- **`escalate`** — insinuation framing co-occurring with a person reference, so the queue is
  worked worst-first. It never changes *whether* something is held, only the reading order.
- **acronym handling** — a federal case is full of `U.S.`, `D.A.`, `F.B.I.`, and they must not
  fill the queue. Their list is better than mine and I took it. Verified both directions:
  `"The U.S. Attorney declined to comment"` passes, `"The U.S. Attorney knew, and so did P.C."`
  holds. An acronym earlier in a sentence must not shield real initials later.

**Apply this patch, not that block.**

### Fix shipped (patch in the inbox, all tests green)

- **`scripts/screen.js`** — screens the other ways of naming someone: relationship nouns fixed to
  one person by a determiner or possessive ("the husband" and "Clancy's brother" are people;
  "husbands" is a category), coded references, initials, jurors (§10), and the interrogative
  form of an accusation. Institutions and conduct are
  deliberately absent from the vocabulary — §5 declares those open season, and a screen that eats
  "the judge should not have admitted that" is broken, not cautious.
- **fast lane** — submissions run the new screen alongside the name screen; a hit routes to
  `needs-review` with a reason the submitter can read.
- **thread comments** — now screened before they render. Held replies are **counted in the open**
  on the card ("1 reply is held for editor review") rather than silently vanishing, and written to
  `data/queue/held-comments.json` so this session can actually adjudicate them.
- **thread seeds** — an issue body that fails the screen no longer opens a discussion page.
- **`scripts/screen.test.js`** — 61 assertions: 27 must-hold, **19 must-publish**, 7 direct,
  8 wiring. The must-publish corpus matters as much as the other: it is what stops the screen
  turning the queue into noise, and an editor who is rubber-stamping is not moderating. The wiring
  assertions were mutation-tested — removing the fast-lane call makes them fail.

Known false positive, accepted: "the mother of three" holds, and in this case that is the
defendant. An editor reads one extra sentence. The other direction is a bereaved father reading on
a public website that a stranger thinks he told his wife to kill their children. Those costs are
not comparable and the screen is tuned accordingly.

### Record check: the named proposed witness (borderline, verified, kept)

`days.json` day 16 names **Emily Thorndike** in the witness index — the former McLean social worker
who posted a TikTok disputing the prosecution's characterisation of McLean and whom the defence
tried to call. ABC7 describes her as *"a Brooklyn woman with no connection to Lindsay Clancy."* A
private individual with no connection to the case is exactly the profile §5 protects, so this was
checked rather than waved through:

- **Sourced?** Yes. ABC7, already cited on the day-16 entry, names her outright. Not our name to
  give, and we did not give it.
- **Fabricated quotes?** No. Judge Sullivan's *"I find this witness credible...but that's not
  always the whole finding"* and the *"limited materiality"* ruling both verified in ABC7.
- **Accusation?** None. She is described doing a public act, in a public hearing, and the ruling
  recorded is favourable to her credibility.

**Kept**, under §5's public-record carve-out. Flagging it anyway because it is close to the line
and the next session should not have to re-derive the reasoning.

*Handoff to the dev lane (not actioned here — board.json is that lane's file):* board node
`r-mclean` carries the "found her credible" and "limited materiality" claims but cites only NBC
Boston, which is the weaker of the two sources. ABC7 is what actually supports those words and
should be added.

## Growth

**Nothing was posted anywhere, and that is the honest result rather than a shortfall to dress up.**
This session has no accounts on any platform, and the one route that does not need accounts —
inventing a persona — is the thing the mandate forbids outright. Real outreach needs Eve's real
name on a real account. What this run produced instead is the groundwork and one guardrail that
was not obvious before today.

**Guardrail found, and it is a real one: the Clancy case is in an outreach blackout until the
verdict lands.** Closings are expected Monday or Tuesday and the jury goes out immediately after.
Two facts make promotion around that case actively dangerous right now: creators covering this
trial are demonstrably *inside* it — Emily Thorndike watched the livestream, posted, and ended up
questioned in court as a proposed defence witness — and a sitting jury is about to deliberate.
"Never post in a way that pressures a sitting juror or reaches trial participants" is not abstract
here; the pathway exists and has already been walked once. **Emily Thorndike is off-limits for
outreach permanently** — she is a trial participant, not a channel.

**Where the effort should go instead, and why:** the other four cases have no such problem and
better timing. Lil Durk opens Monday with a jury just seated; Tupac is in week two; Bridegan is in
the state's case. A board built *before* the coverage wave is useful to someone covering it; a
board pitched during deliberations is a liability.

**What the channel layer actually looks like, checked rather than assumed:** daily coverage of
these trials is dominated by Court TV and Law&Crime, which are newsrooms with their own research
desks and no need for ours. The indie creator layer that would actually want a free live board is
real but is not reachable through web search — it needs platform-side browsing, which this session
does not have, and an account, which it also does not have. Stating that plainly rather than
padding the log with a list of channel names I could not verify.

**Standing ask that unblocks all of it:** the creator offer needs one durable page to point at —
a free embeddable live board, verdict alerts, a board built to a creator's schedule — and the
embed needs the submission relay deployed. That is item 3 on Eve's list and it gates the growth
lane far more than any tactic does.

## Verification
`node scripts/build.js` plus every test in `scripts/`, checked for new arrivals rather than
assumed from a list: `screen.test.js` (new), `verdict.test.js`, `verdict.live-check.js`,
`media.test.js`, `media.viewer-test.js`, `composer.test.js`, `media-fetch.test.js`,
`submit.test.js`, `audit.js`. **10/10 green**, before and after the patch. The patch was then
applied to a *fresh clone of `main`* and the whole suite re-run there, so what is in the inbox is
verified against the tree Eve will apply it to, not against my working copy.

## For Eve
1. **Close or delete issue #1.** No GitHub write from here. Details above.
2. **Apply the patch** in `claude/ourgavel-inbox.md` (one command, self-verifying, refuses to
   commit if anything fails).
3. **The device bridge still is not reaching scheduled runs.** `requires_local_device: true` did
   not produce one for this task. Until that is resolved every session's work needs your hands.

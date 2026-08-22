# GavelBoard

**gavelboard.com — The record. The rumors. The line between.**

A structured, continuously re-verified record of high-attention court cases: day-by-day testimony,
witness indexes, plain-English legal standards, a live attributed wire, and a community evidence
board where theories are labeled, tested, and — when the facts land — publicly retired.

## How it works

- `data/cases/<slug>/` — the record for one case: `case.json` (metadata, feeds, legal standard),
  `days.json` (day-by-day, fully cited), `board.json` (the evidence board), `community.json`
  (reviewed community nodes), `ticker.json` (attributed wire items).
- `scripts/build.js` — dependency-free static site generator → `public/`.
- `scripts/poll.js` — the 15-minute pulse (GitHub Actions): polls outlet feeds, updates tickers,
  syncs community submissions and traction, opens verdict-watch alerts.
- `AGENT.md` — operating manual for the hourly review session that does the judgment work.
- `EDITORIAL.md` — the publishing rules. Fixed. The review session cannot edit them.

## Contribute

Post a theory, propose a connection, or submit evidence via the issue forms:
[New submission](../../issues/new/choose). Everything is reviewed before it appears — usually
within the hour. House rules are on the [Contribute page](https://gavelboard.com/submit/) and in
EDITORIAL.md.

## Corrections

Open an issue. Errors are corrected visibly, with a dated note.

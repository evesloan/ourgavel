# OurGavel — Style Guide

**This document is binding.** Every session, human or agent, follows it. Where code and this
file disagree, this file is right and the code is a bug. Changes to this file are RED LANE
(operator approval required) — see AGENT.md.

---

## 1. The idea

OurGavel looks like a **colonial American courtroom**: parchment, oak, brass, iron-gall ink.
Square joinery, double rules, small caps, serif prose. It should feel like a well-kept public
record — a room where things are written down properly — not like a news app or a true-crime
thumbnail.

The look does editorial work. A site whose whole promise is "every fact is traceable" has to
*look* like it keeps records. Nothing here is decoration for its own sake.

**Never:** neon, glassmorphism, gradient hero blobs, drop-shadowed emoji headlines, dark-mode-first
"tech startup" styling, stock photography of gavels, AI-generated imagery of any kind.

---

## 2. Pip, Clerk of the Board

Our mascot is **Pip** — a mouse in a powdered wig and jabot. He is the clerk: he keeps the record,
he shows people where to sit, and he does not gossip.

**Character:** cute, but *politely curt*. Courteous and brief. Never chatty, never cutesy, never
sarcastic, never emotional. He is the calmest thing on a page about a murder trial, and that is
exactly why he works.

**His voice** — short declaratives, courtroom register, one idea per line:

> "Order, please. Tap a card to see its sources."
> "Noted. Sources, or it stays amber."
> "The Board has been amended."
> "View reset. Thank you."
> "No reader theories yet. Yours would be first."

**Never in his voice:** "Oops!", "Hey there!", "Let's dive in", exclamation marks (one, ever, and
only if something is genuinely wrong), emoji, first-person plural about opinions, any joke about
the case itself. He is never funny about a death. His humour, such as it is, is dryness.

**Drawing him:** always `pip(size)` in `scripts/build.js`. Never hand-draw a variant. His colours
are fixed hexes, not theme tokens — he is the same creature on parchment and at night:
fur `#a4907a`, ear `#c99f97`, wig/jabot `#f7f2e6` with `#e2d9c6` shade, eye `#2b2119`,
nose `#8d4f4a`, gavel `#7a5a2e`/`#9a7440`.
Below 34px he sheds whiskers, jabot pleats and eye highlights automatically — never override that.

**Where he appears:** masthead (38px), toasts (22px), the empty reader-theory zone, the favicon.
That is the whole list. He does not appear next to case facts, on the record pages, or anywhere
near a victim's name.

---

## 3. Palette — binding

Parchment is the default; dark is *chambers at night*, not a separate brand.

| Token | Parchment | Night | Use |
|---|---|---|---|
| `--bg` | `#f2ecdd` | `#15110d` | page ground |
| `--panel` | `#fbf7ec` | `#1e1811` | cards, board, masthead |
| `--panel2` | `#e9e0cb` | `#2a2118` | insets, aged paper |
| `--ink` | `#221a12` | `#f0e6d2` | body text |
| `--mut` | `#6a5a44` | `#a4917a` | secondary text |
| `--line` | `#c8b795` | `#3f3223` | rules, borders |
| `--acc` | `#8a6410` | `#c9a227` | **brass** — actions, brand |
| `--acc2` | `#28456e` | `#9dbadf` | indigo — links |
| `--green` | `#2c6444` | `#68a982` | supports |
| `--red` | `#8d2b25` | `#cf7a6c` | disputes, live |
| `--amber` | `#96681a` | `#d9a544` | unverified / reader |
| `--violet` | `#4f3f7a` | `#a993d8` | open questions |

**Semantic colour is law.** Green only ever means *supports*. Red only ever means *disputes* or
*live*. Amber only ever means *unverified / reader-submitted*. Violet only ever means *an open
question*. Never use one of these colours decoratively — on this site a colour is a claim.

---

## 4. Typography

- **Prose and headings: serif** (`--serif`). The record reads like a document.
- **Interface: sans** (`--sans`) — nav, badges, buttons, tabs, table headers, Pip's toasts.
- Body 17px / 1.62. Never below 14.5px for anything a reader must actually read.
- H1 34px (24px on phones), H2 23px with a **3px double rule** beneath.
- Labels, badges, nav, buttons: UPPERCASE, 10.5–13px, letter-spacing 0.8–1.4px.
- No external font hosts. System stacks only — a third-party font request is a third-party
  request, and this site does not make those.

---

## 5. Joinery

Colonial furniture is square. So is this.

- Radius **2px** for interface (buttons, chips, badges, toggles, panels); **3px** for cards and
  the board. Never a pill, never a circle, except Pip and the connection dots.
- Rules over shadows. Section breaks are `3px double var(--line)`.
- Cards carry a wainscot hairline: `inset 0 0 0 1px rgba(255,255,255,.35)` on parchment,
  `rgba(255,240,210,.045)` at night. One hairline, not a stack of shadows.
- The board is ruled paper, not a dot grid.
- Touch targets ≥ 42px. Non-negotiable.

---

## 6. Mobile is the default

The site is designed at 390px and adapted upward, not the reverse.

- **The product comes first on the page.** On a case board, chrome above the canvas must stay
  under ~240px. Explanation goes *below* the thing it explains.
- The masthead collapses on phones: tagline hidden, logo 22px, nav inline.
- The detail panel is a **bottom sheet** on phones (72% max height, grab handle, tap-outside and
  Escape both close) and a side panel on desktop. Same content, same code path.
- A graph shrunk to fit a phone is unreadable, so the board **opens centred on the case's central
  question at reading scale**, with pinch-zoom and pan from there — and List view always available
  as the read-everything fallback.
- Desktop parity is a requirement, not a bonus: every mobile capability exists on desktop and
  vice versa.

---

## 7. Motion

Motion explains, or it does not ship.

- Cards fade in staggered (38ms apart); edges draw along their path. This shows the argument
  assembling itself.
- Selecting a card lights its connections and dims everything else. This is the single most
  useful interaction on the site — it is how a layman reads an argument.
- 180–450ms, ease. Nothing bounces. Nothing loops. Nothing autoplays.
- `prefers-reduced-motion: reduce` disables all of it, including the entrance and Pip's hover.

---

## 8. Writing

- Plain English for a smart non-lawyer. Every legal term translated in the same breath.
- Card titles read like a sharp friend explaining the case: *"Her phone tells two stories"*,
  *"The confession he says he invented"*. Never headnotes, never "Defendant asserts…".
- Quotes verbatim and attributed. Facts carry sources inline; no source, no sentence.
- Never assert guilt. Report what is alleged, argued, and decided.
- Cover the proceeding, not the grief. No autopsy detail beyond the legal facts of the charge.
- Never name minors, and never name private individuals as suspects. See EDITORIAL.md §5.

---

## 9. The voice test — no AI-speak

Readers of true-crime coverage are unusually good at spotting generated text, and one whiff of it
undoes the sourcing work. Every line on this site must sound like a person who knows the case
wrote it. Before publishing any prose, check it against this list.

**Banned constructions:**

- The em-dash sandwich: *"The big cases, kept straight — every fact linked to its source — and a
  board where you test theories."* One idea per sentence. Full stops are free.
- *"It's not just X, it's Y."* / *"This isn't about X. It's about Y."*
- Triads of nouns or adjectives used for rhythm: *"clear, sourced, and current."* Two is plenty.
- *"In a world where…"*, *"At its core…"*, *"More than ever…"*, *"Let's dive in"*, *"Here's the
  thing"*, *"That's the point."* as a standalone paragraph.
- Sentences that restate the previous sentence with more emphasis.
- Abstract nouns doing the work of concrete ones: *"transparency", "clarity", "accountability",
  "empowerment"*. Say the actual thing that happens instead.
- Hedging stacks: *"may potentially help to"*.
- Headings that are a noun phrase with no verb where a plain question would do.

**What to do instead:** name the specific thing. *"Come back on day 15 and you're scrolling forty
screens to find out who testified on Tuesday"* beats any sentence containing the word
"transparency". Concrete detail is the thing generated prose cannot fake, and it is also just
better writing.

**Length:** if a paragraph can lose 30% and keep its meaning, it was 30% too long.

**On automation, be direct.** The About page says plainly that the monitoring is automated and
that a person signs off on verdicts, plea changes and anything naming an uncharged individual.
Never soften this into "a small team" or "our editorial process". Vagueness is what reads as a
cover-up; specificity is what reads as true — and here it happens to be true.

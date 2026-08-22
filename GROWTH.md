# OurGavel — Growth & Revenue Plan

Written 2026-08-22. Honest numbers, in order of what I'd actually do.

---

## Part 1 — The TikTok comment plan, and why I'd change it

The instinct is right: the audience is on TikTok, they arrive already wanting to sleuth, and a
free tool that hands them sourced facts is genuinely welcome there. That is the correct read.

The **execution as described — posting a templated comment en masse across videos — will lose us
more than it gains**, for three reasons:

1. **It's spam under TikTok's own rules.** Repetitive templated comments at volume are classed as
   inauthentic engagement. The realistic outcome is the account restricted and the domain
   soft-blocked in comments, which costs us the channel permanently rather than temporarily.
2. **This community has unusually good spam radar.** True-crime comment sections are full of
   people who spend their leisure hours noticing when something doesn't add up. Getting labelled
   "the AI site farming our comments" once is a wound that doesn't heal, and it lands directly on
   the one asset the site actually sells: being trustworthy.
3. **The proposed script undersells us and isn't quite true.** "I don't have much regarding this
   case yet" — we have an 18-day sourced trial record with 61 witnesses indexed. Leading with
   false modesty to bait replies is exactly the register that reads as a grift. Our actual pitch
   is far stronger and it is simply true.

### What I'd do instead — same channel, same energy, no spam

**Be genuinely, specifically useful in public.** Not templated. When a comment section is arguing
about something the record answers, answer it *with the specific fact and the specific link*:

> "Both experts were asked this. Resnick said command hallucinations, Mack said major depression,
> no psychosis — both on day 18. Full day-by-day with sources: [link]"

That is not marketing; it is the product demonstrated. It converts far better than a pitch, it
cannot be classed as spam because every instance is a real answer to a real question, and it
scales to as many threads as there are genuine questions. It is slower. It compounds.

**Then go after creators, not viewers.** This is the highest-leverage move available and the
embed feature was built for it:

- True-crime creators need accurate, current facts and hate doing the sourcing. We are the
  sourcing layer.
- Offer them, free: a **live embeddable board** for their case that updates itself, early
  verdict-watch alerts, and a custom board built for their upload schedule.
- Every embed is a permanent backlink on a high-traffic page with their audience already primed.
  One mid-size creator embedding a board is worth thousands of comments.
- Ask for one thing in return: a link in the description. That's it.

**Reddit, where links are welcome.** r/TrueCrimeDiscussion, case-specific subs, and the
courtwatcher communities actively reward sourced timelines. Same rule: answer real questions.

**Own the verdict moment.** When a verdict lands, everyone publishes the same headline within
minutes. Nobody publishes *the structured record of how it got there* — the witness index, the
day the case turned, the exact instruction the jury got. That is the artifact people share in the
days after, and it's what we're uniquely built to have ready.

---

## Part 2 — Honest revenue math

**Costs today: $0.** GitHub Pages, GitHub Actions on a public repo, no dependencies, no servers.
Only the domain (~$10/yr). Profitability is therefore not the hard part — *scale* is.

### Display advertising

Thresholds, verified today ([source](https://bloggingguide.com/display-ad-traffic-requirements/)):

| Network | Minimum | Notes |
|---|---|---|
| AdSense | none | approval-based, lowest rates |
| Ezoic | none | good early option |
| Media.net / Monumetric | 10k pageviews/mo | Monumetric charges a setup fee |
| Mediavine | 50k sessions/mo | materially better rates |
| Raptive | 100k pageviews/mo | best rates |

**The honest caveat: this niche is restricted inventory.** Google's own program policies limit ads
against shocking content and content depicting violence
([AdSense policies](https://support.google.com/adsense/answer/48182?hl=en)). Pages about the deaths
of three children will attract fewer and cheaper advertisers than pages about the legal standard,
the witness index, or a rap-lyrics evidence fight. Expect page-level restrictions on the darkest
pages, not a site-level ban.

**So plan for a blended $5–10 RPM, not the $15+ figures you'll see quoted for lifestyle sites.**

| Monthly pageviews | Realistic display revenue |
|---|---|
| 10,000 | $50–100 |
| 50,000 | $250–500 |
| 100,000 | $500–1,000 |
| 500,000 | $2,500–5,000 |

A verdict week on a national case can do 100k+ pageviews by itself. Between verdicts it collapses
— which is exactly why the roster runs 5 cases and why case scouting is automated. Breadth is what
turns spikes into a floor.

### The better revenue lines (later — everything is free right now)

Nothing on the site is paid today, and the creators page says so plainly. Pricing a room nobody is
in yet costs more in adoption than it earns. When there is an audience worth serving:

1. **Creator/newsroom tooling — highest margin, best fit.** The record stays free and open
   forever; what professionals would pay for is tooling around it — bulk exports, private working
   boards, an API, same-day case onboarding. Podcast and YouTube operations already pay
   researchers; this is cheaper and never sleeps. Not exposed to ad-policy risk at all.
2. **Sponsorship of the wire, not the record.** One clearly-labelled sponsor slot on the ticker and
   case hubs. Never inside a board card, never on a victim's page. Legal-adjacent advertisers
   (CLE providers, legal software, court reporting) pay well and are on-topic.
3. **Affiliate, narrowly.** Books and documentaries about the cases we cover, plus the streaming
   services that carry gavel-to-gavel coverage — those links already exist on every case hub and
   the renderer labels any of them as affiliate the moment they become one.

### Sequence

- **Now → verdict:** no ads. Build the record, prove accuracy, get the Clancy verdict right.
  Turning on ads before the site has a reputation trades a large future asset for pocket change.
- **At ~10k pageviews/mo:** Ezoic or Media.net, ads confined to hub/record pages. Keep every
  creator feature free — adoption is worth more than early revenue, and creators are the
  distribution channel, not the customer.
- **At 50k sessions/mo:** apply to Mediavine. Introduce the sponsor slot.
- **At 100k pageviews/mo:** Raptive. Only here does paid tooling for professionals make sense, and
  only as an addition — the record itself never goes behind anything.

### The number that actually matters

Not pageviews — **embeds placed**. Each one is a backlink, a referral stream, and a creator
relationship, and it compounds while ad revenue does not. If I could optimise one metric for the
next ninety days, it would be that.

---

## Part 3 — Before any ad code ships

An ad network is a third-party script, and this site currently ships a `default-src 'none'` CSP
with hash-pinned scripts and no external requests at all. Turning ads on means deliberately
relaxing that. Read SECURITY.md §"Rules that must not be relaxed" first, budget the ad domains
explicitly rather than opening the policy up, and never let ad code run on a board page where it
could sit beside a community claim and look like an endorsement.

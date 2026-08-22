# The handoff queue — one Worker paste, then the loop closes

**What this fixes.** Three lanes (SEO, community, development) run unattended in the cloud every
few hours and finish real work. None of them can write the repository: `git push` is refused by the
proxy and a scheduled run has no bridge to your PC. So their work has been landing in project docs
and waiting for someone to apply it by hand. Four attempts at a scheduled "shipper" failed for the
same reason — **nothing that runs on a schedule has repository credentials.**

**What does have them: the pulse.** It runs `scripts/poll.js` in GitHub Actions every fifteen
minutes with `contents: write`, and the step immediately after pushes whatever that script
committed. `poll.js` is ours to change, so the applier lives there — always on, no PC required, and
no edit to the protected workflow file.

The only missing piece is a way for a cloud lane to hand work to it. That is this change: one
authenticated route on the relay Worker you already deployed.

```
lane (cloud)  --POST /handoff, bearer-------->  relay Worker  --files a labelled issue-->  GitHub
                                                                                             |
GitHub Pages  <--deploy--  pulse (Actions)  <--reads `handoff` issues, applies, gates--------+
```

## What you do — two steps, then you are out of the loop

**1. Redeploy the Worker.** Paste the current `scripts/worker/ourgavel-submit.js` over the existing
code and Deploy. Nothing about reader submissions changes; this only adds a route.

**2. Add one secret, with a value you generate.**
In the Worker's **Settings → Variables and Secrets**, add a **Secret** (not a plaintext variable):

- Name: `QUEUE_TOKEN`
- Value: 40+ random characters from a password manager. **Do not send it to me or paste it in chat.**

Then put that same value, on its own, as the only line of a project doc called
`claude/ourgavel-queue-token.md`. The lanes read it from there to authenticate. I do not open that
doc, and no lane may quote it in a log, a report or an issue.

That is everything. No GitHub secret, no workflow file, no scheduled task, no PC.

## Why this route needs a token when the reader path does not

The Worker's existing origin check — `if (origin && origin !== allowed)` — is exactly right for a
browser and useless against anything else, because **`origin` is simply absent on a server-side
request**. Anyone with `curl` can already post a reader theory. That is acceptable: a bad theory is
a moderation problem, it is labelled as a reader's claim, and the hourly sweep catches it.

A handoff is not that. It is an apply-plan that the pulse executes and commits. Unauthenticated, it
would let a stranger put content on a court record under our own byline, having passed every test we
own — because no test suite can catch a plausible lie. So this is the one route with a shared
secret, and it **fails closed**: with `QUEUE_TOKEN` unset the route returns 404 and there is no
half-open state.

It returns **404 rather than 403** on a bad token, deliberately. A 403 confirms the route exists and
tells an attacker they have found something worth grinding at.

## What still stands between a queued handoff and the site

Authentication is the first gate, not the only one. `scripts/poll.js` will:

- accept only issues carrying the `handoff` label, which the public path cannot mint — `KINDS` has
  no `handoff` entry, and `scripts/queue.test.js` fails if anyone adds one
- run the apply-plan with **no credentials in its environment**
- refuse any plan that writes outside an allowlist — never `.github/`, `EDITORIAL.md`, `AGENT.md`,
  `STYLE.md`, `SECURITY.md`, `CNAME` or `SUBMIT_ENDPOINT`
- run `preflight`, `build`, and **every** test script before committing anything
- commit publicly, so every applied handoff is one `git revert` away from gone

## If the token ever leaks

Change the secret in Cloudflare and change the project doc. Both are one edit. Anything queued with
the old token stops working immediately, and anything already applied is in the git history where
you can see it.

## Verifying it works

`node scripts/queue.test.js` — 46 assertions, run against the real Worker code with a stubbed
`fetch`. The first block is the one that matters: for eight different ways of getting the bearer
wrong, it asserts that **no issue is filed at all**, not merely that an error came back.
Mutation-tested five ways; four were caught, and the fifth (deleting the fail-closed guard) turned
out to be an equivalent mutation — `safeEqual` already refuses an unset or empty token, so the guard
is redundant belt-and-braces rather than the thing holding the door.

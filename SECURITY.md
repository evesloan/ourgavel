# OurGavel — Security

Audited 2026-08-22. This file records the threat model, what was found, what was fixed, and the
controls that must stay in place. Changes here are RED LANE (operator approval).

## Threat model

The site is static HTML on GitHub Pages. There is no server, no database, no user accounts, no
session, no payment, and no PII collected by us. That removes most of the usual attack surface —
and concentrates the remaining risk in exactly two places:

1. **Untrusted text** — community submissions and news headlines flow into pages we generate.
2. **The automation** — a workflow with write access runs unattended every 15 minutes.

Everything below follows from those two.

## Findings and fixes

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Community text interpolated into HTML and into a `<script>` JSON blob | High | **Fixed** — server-side `esc()` on every field before it reaches `innerHTML`; `jsonScript()` neutralises `<`, `>`, `&`, U+2028/9 so no value can break out of the script block |
| 2 | Submitted URLs could carry `javascript:` / `data:` schemes | High | **Fixed** — `safeUrl()` allows `http(s)` only; anything else renders as `#` |
| 3 | No Content-Security-Policy | High | **Fixed** — see below |
| 4 | `window.open()` left `window.opener` live on the opened tab (reverse tabnabbing) | Medium | **Fixed** — `noopener,noreferrer` |
| 5 | Inline `onclick` attribute forced a weaker CSP | Medium | **Fixed** — removed; `script-src-attr 'none'` now forbids inline handlers outright |
| 6 | Submissions are committed to a **public** repo, so any personal detail in one becomes permanent and indexable | Medium | **Fixed** — `redact()` in `poll.js` strips emails, phone numbers, ID numbers, street addresses and long digit strings *before* anything is written to disk |
| 7 | Posts naming private individuals | Medium (legal) | **Controlled** — name heuristic + PII screen routes them to editor review; auto-publish only for person-free posts; hourly human-standard sweep with removal power |
| 8 | Submission spam / flooding | Low | **Controlled** — 3 posts per author per 24h, enforced in the pulse |
| 9 | Referrer leakage to outlets we cite | Low | **Fixed** — `referrer: strict-origin-when-cross-origin` |

## Content-Security-Policy

Every page carries a meta CSP whose `script-src` and `style-src` are **SHA-256 hashes of the exact
inline blocks we generated**. Consequences:

- Injected `<script>` cannot execute even if escaping were bypassed — its hash is not on the list.
- `script-src-attr 'none'` forbids inline event handlers entirely.
- `default-src 'none'` means no external resource of any kind loads: no fonts, no analytics
  beacons, no images from other hosts, no XHR anywhere but our own origin.
- `style-src-attr 'unsafe-inline'` is the one relaxation, allowing `style=""` attributes. Style
  attributes cannot execute script, and no attacker-controlled text ever reaches an attribute
  position — it is escaped before it reaches the page.

`frame-ancestors` is not honoured in a meta CSP. Framing is **intentional**: `/board/embed/` exists
to be embedded. There is nothing to clickjack — no logins, no destructive actions, no state.

### Photographs (2026-08-22)

`img-src` is `'self' data:` and nothing else. It used to collect the origin of every media entry
on a case, which meant a statute host and a court's PDF library were both permitted to serve
images to a reader's page — thirteen domains in total, none of which ever served one. Documents
render as links; they never needed the permission.

Photographs are now **copied onto our own origin** by `scripts/media-fetch.js` before they are
shown, so a case page still makes zero external requests with a full gallery on it. This is the
reason the answer to "can we embed tweets or TikToks?" is no by default: an embed is a live
third-party script plus a frame plus a tracking call, on pages about people facing prison. If
that is ever revisited, it is a change to this section first.

The download path refuses anything that is not demonstrably an image: content-type must be
`image/*`, the leading bytes must match a real format signature, and the file must be between
1KB and 3MB. A `.gov` page returning an HTML error page cannot become an `<img>`.

## Automation

- The workflow's `GITHUB_TOKEN` is scoped to `contents`, `pages`, `id-token`, `issues` — no more.
- No `pull_request_target`, and no untrusted value is ever interpolated into a `run:` block, so
  workflow script injection is not reachable.
- Zero npm dependencies in the build or the pulse. Nothing to supply-chain.
- The pulse never publishes a verdict. Two or more independent credentialed outlets *plus*
  operator approval, per EDITORIAL.md. This is a correctness control, and the most important one
  on the site.

## Public by design

- The repository, the record, and `/board/*/data.json` are public — that is the product.
- Contributor GitHub handles appear on their own theories. They are already public on the issue
  itself; contributing is a public act, and the submit page says so.

## Rules that must not be relaxed

1. No user content reaches `innerHTML` without `esc()` at the point it is put into `DATA`.
2. No URL reaches an `href` without `safeUrl()`.
3. No inline event handlers. Bind in the script block.
4. No third-party scripts, fonts, or trackers without re-deriving the CSP hashes and updating
   this file. **An ad network is a third-party script** — turning ads on means revisiting this
   document first, not after. **A social embed is also a third-party script**, and additionally a
   frame and a beacon; see Photographs above.
4b. No host is added to `img-src`. If a picture is worth showing, it is worth holding the bytes.
   `IMG_HOSTS` in `scripts/build.js` is frozen empty on purpose.
5. No secrets in the repo, ever. The build and the pulse need none beyond `GITHUB_TOKEN`.
6. Re-run the checks below before any release that touches templates.

## Verification

```
node scripts/build.js                       # must build cleanly
node scripts/media.test.js                  # rights logic — a failure means we may republish someone else's photo
node scripts/media-fetch.test.js            # the gate — a failure means a stranger's face could reach a case page
node scripts/media.viewer-test.js           # the viewer, in a real browser, desktop and mobile
grep -o 'onclick="[^"]*"' public/**/*.html  # must return nothing
grep -o "img-src[^;]*" public/index.html    # must read exactly: img-src 'self' data:
```
Then load a board page over HTTP and confirm: zero CSP violations in the console, the detail panel
opens, connection highlighting works. A CSP violation after a template change means the hashes
went stale — rebuild, do not relax the policy.

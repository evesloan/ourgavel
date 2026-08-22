# One-time setup: the submission relay

The site is static, so it cannot hold the secret needed to file a submission. Without this relay
the board composer still works — it just hands off to GitHub for the final click. With it, "Post
to the board" actually posts.

Ten minutes, once. You already have a Cloudflare account from the domain.

## 1. A token that can do almost nothing

GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new.

- Repository access: **Only select repositories** → `evesloan/ourgavel`
- Permissions: **Issues → Read and write**. Nothing else. Not contents, not workflows.
- Expiry: 1 year, and put a reminder in your calendar.

If this token ever leaked, the worst anyone could do is open issues — which an editor reviews
anyway. That is the entire point of scoping it this narrowly.

## 2. The Worker

Cloudflare dashboard → **Workers & Pages** → Create → Worker. Name it `ourgavel-submit`.
Replace the starter code with `scripts/worker/ourgavel-submit.js` from this repo, then Deploy.

Settings → Variables:

| Name | Type | Value |
|---|---|---|
| `GH_TOKEN` | **Secret** | the token from step 1 |
| `REPO` | Text | `evesloan/ourgavel` |
| `ORIGIN` | Text | `https://ourgavel.com` |

Optional but worth it — rate limiting: Storage → KV → create a namespace `RATE`, then bind it to
the Worker under Settings → Bindings with the variable name `RATE`. Without it the Worker still
runs, just uncapped, and the editor sweep remains the backstop.

## 3. Point the site at it

Copy the Worker's URL (it looks like `https://ourgavel-submit.<your-subdomain>.workers.dev`) and
put it in a file called `SUBMIT_ENDPOINT` at the root of the repo, exactly like `CNAME`:

```
https://ourgavel-submit.yoursubdomain.workers.dev
```

That single file switches the composer from hand-off to direct posting, and the build adds the
Worker's origin to the site's Content-Security-Policy automatically. Nothing else changes.

## What it does and does not do

It creates a GitHub issue with the same labels the pulse already reads, so every submission goes
through the identical review path as before — the automated screen, the fast lane, the hourly
editor sweep. It strips emails, phone numbers, addresses and ID numbers before the text ever
leaves Cloudflare. It rejects requests from any origin but ours.

It does not authenticate anyone. Display names are unverified and shown as such. Anonymous
posting is deliberate: making people create an account to contribute a fact is how you end up
with no facts.

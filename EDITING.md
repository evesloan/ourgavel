# Editing OurGavel by hand — the owner's guide

You don't need any of the machinery to change the site's words. Edit a file in this folder,
save it, and the site updates itself: your PC pushes the change within 5 minutes and the
site rebuilds — **live in roughly 10–20 minutes**, no build steps, nothing to run.

## The file that's yours: `data\copy.md`

Open it in Notepad (or anything). It holds the site copy in plain text, in named sections:

```
# tagline

The record. The rumors. The line between.

# about-intro

Liveblogs are built for the minute they're posted. ...
```

- **`# tagline`** — the line under the logo on every page. One line.
- **`# about-intro`** — the opening paragraph of the About page.
- **`# about-hard-questions`** — the About section on questions about uncharged people.
- **`# about-who-runs-this`** — the "Who runs this" section. Blank line = new paragraph.

Formatting that works inside a section: a blank line starts a new paragraph,
`[link text](/cases/)` makes a link, `**bold**` makes bold. Everything else appears exactly
as typed.

**You cannot break the site with this file.** If a section is emptied or the file is
deleted, the site quietly uses its built-in version of that section. Scripts pasted in
won't run — the site's security policy blocks them.

## What's deliberately NOT in that file

The About page's **"The rules"** and **"How this site is made"** cards state enforceable
promises — "verdicts wait for three newsrooms", the correction policy, what automation does
and doesn't decide. The test suite holds those words to the actual code, so the page can
never claim something the machinery doesn't do. If you want those changed, tell me in chat
and I'll change the words and the checks together.

## Case content (the record itself)

Everything on a case page lives in `data\cases\<case>\` — `case.json` (the status chips),
`days.json` (the day-by-day), `board.json` (the evidence board). You *can* edit these
directly, but every factual line needs a source and the tests enforce the structure, so the
easy path is to tell me what should change — me or the agents will ship it sourced and
tested. Same for anything visual or structural.

## Two cautions

- **Don't hand-edit `scripts\build.js`.** The agents update it by matching exact text;
  a hand edit there can silently collide with queued agent work.
- **If your change hasn't appeared in ~30 minutes:** look for a `DEPLOY-BLOCKED.txt` file
  in this folder (it explains itself), or just ask me — I can see exactly what happened.

And for anything at all: saying it in chat is always enough. "Change the tagline to X" works
just as well as editing the file yourself — this file exists so you never have to wait for me.

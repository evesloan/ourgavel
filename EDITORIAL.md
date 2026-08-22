# EDITORIAL.md — the rules OurGavel publishes under

These rules exist because this site covers real people in the worst moments of their lives, under
the operator's real name. They are not aspirations; they are constraints. The review session may
not edit this file.

## 1. Attribution is the product
Every factual sentence on the site carries a named source with a working link: a credentialed news
organization's own reporting, or a primary legal source (statute, opinion, filing, official
release). No source, no sentence. Where credible outlets conflict, we print the conflict
("outlets differ") rather than resolving it by preference.

## 2. Fair report, always
We report what was alleged, testified, argued, ruled, and decided — attributed to who said it,
where. The site's own voice never asserts a defendant's guilt before a verdict, never asserts
that contested testimony is true, and never converts an allegation into a fact by paraphrase.
"Prosecutors argued X" and "Dr. Y testified Z" are our grammar.

## 3. Presumption of innocence
Every case page carries it. A defendant convicted at trial is "convicted"; until then, "accused"
or "charged." An acquitted defendant's acquittal is stated wherever the accusation appears — the
record page does not leave accusations standing bare after resolution.

## 3b. Verdicts, pleas and sentences — published autonomously (authorised 2026-08-22)

The operator authorised the site to publish verdicts without a human in the loop. Removing the
person does not lower the bar; it raises it, because the evidence now has to carry the weight the
person used to. Three gates, all of which must pass, enforced in `scripts/verdict.js`:

1. **Indicative language.** The report must state an outcome that has already happened. Anything
   conditional, predictive, procedural or advocatory proves nothing — "jury begins deliberating",
   "if found guilty", "faces a guilty verdict", "prosecutors say he is guilty", "what a mistrial
   would mean". Every one of those is in the test suite as a must-not-publish case.
2. **Independent consensus.** At least three separate newsrooms must report the *same* outcome.
   One newsroom filing three times is one source. Aggregators (Bing, Google News) are never
   sources. If any credentialed outlet reports a *different* outcome, nothing publishes at all —
   the split escalates to a human immediately.
3. **A settling cycle.** The consensus must survive a second poll. A wire error retracted within
   fifteen minutes never reaches the site.

When all three pass, the site publishes the verdict, states on the page how many independent
newsrooms confirmed it, and lists every one of them inline. The reader gets the evidence, not
just the claim.

If later reporting contradicts a published verdict, the case is flagged as disputed and a
correction issue opens at once. Corrections are made in public, in place, with a note.

**What is still never automated:** attributing a verdict to a single outlet; publishing a
sentence as if it were a verdict; asserting guilt in the site's own voice beyond reporting what
the jury found; and anything about jurors themselves. `scripts/verdict.test.js` must pass before
any change to this machinery ships — a failing suite means verdict publishing is disabled, not
that the tests get edited.

## 4. The rumor/record wall
Community content is labeled UNVERIFIED, amber, at every point of display. It cannot cross into
the record by popularity, traction, age, or repetition — only by the promotion standard: two or
more independent credentialed sources (or the court record itself) verifying the substance, plus
operator approval. Disproven items remain visible, marked DISPROVEN, with the disproving source —
the site's memory of what got ruled out is part of its value.

Publishing flow: theories that discuss the case without naming people publish automatically within
minutes after a deterministic screen (rate limits, no personal information, no unlisted names);
anything that discusses a specific person is held for editor review first, and everything —
fast-lane included — is swept by an editor within the hour, with removal power. Speed is a
courtesy; the labels and the wall are the contract.

## 5. What we will not host
Accusations of crimes against people not charged. Identification of, or personal information
about, private individuals — including jurors, witnesses' families, and submitters' targets.
Graphic detail about victims beyond the legal facts of the charges. Content aimed at contacting,
harassing, or "investigating" any real person. Fabricated or misattributed sourcing. These are
removed on sight, whatever their traction, and repeat submitters are blocked.

What IS open season: conduct and institutions. The prosecution's choices, the defense's strategy,
an agency's failures, a hospital system's gaps, rulings, procedure — question all of it, hard.
And where scrutiny of a person is already part of the public record — cross-examination, a filing,
published reporting — it enters the Board as sourced evidence under fair report. The line is not
"no hard questions"; it is that questions travel on facts, not on names.

## 6. Verdicts
See §3b — verdicts and mistrials publish autonomously once all three gates pass. Sentences and
plea changes are NOT covered by that machinery: they are separate events, are never inferred from
a verdict, and enter the record by the ordinary two-source rule. Being second and right beats
being first and wrong, every single time, forever — which is exactly why the automated path
demands three independent newsrooms and a settling cycle rather than two and a hunch.

## 7. Corrections
Errors are corrected in place, visibly, with a dated note. The correction log is public in the
repository. We do not silently rewrite.

## 8. Dignity
Three real children died in the case this site launched with. Their names appear as legal facts,
not content. No autopsy detail beyond cause of death as charged. No 911 audio embeds. No
victim-photo galleries. The proceeding is the story.

## 9. Money, when it exists
Monetization never touches the record: no affiliate link inside a day entry, witness index, or
legal explainer; no sponsor influence on coverage; no ads styled to look like record content.
Affiliate links, when enabled, are labeled as such where they appear. If an advertiser or
affiliate program conditions payment on coverage, we drop the program.

## 10. The jury
No juror identification, no deliberation speculation presented as reporting, nothing that could
plausibly reach a sitting juror as pressure. Coverage of jury questions and notes follows outlets'
reporting, attributed.

---
author: "eddie-freeman"
relatedPosts: []
publishDate: "2026-07-27T09:00:00Z"
heroImage:
  url: "/blog-post.webp"
  alt: "Shipped is not served"
title: "Shipped is not served"
blurb: "I spent a weekend rebuilding this site, and it broke in a way I didn't expect."
tags: ["astro", "cloudflare", "testing", "deployment"]
draft: true
---

I spent a weekend rebuilding this site, and it broke in a way I didn't expect.

Not loudly. Loud would have been a kindness. It broke with every check green — a wall of passing builds and cheerful little checkmarks — while quietly showing strangers things I never meant them to see.

Here's where we're headed:

- the day a perfect build served nothing at all
- two places this site told on itself
- the deploy that went red for being *right*
- what I changed, and what this site is turning into

Before any of that, the distinction I now build around:

*Shipped is what your pipeline says it did. Served is what a stranger's browser actually receives. They are not the same thing, and only one of them matters.*

---

## A perfect build, serving nothing

The rebuild itself went well. New framework version, new styling engine, a newer runtime underneath — the kind of upgrade you put off for a year and then do in an afternoon once you finally start.

Every check passed. The deploy reported success. Every single page returned a 404.

I went looking for the mistake in my own code for longer than I'd like to admit. There wasn't one. The adapter I'd upgraded had quietly stopped supporting the hosting product I was deploying to, and what it produces now is a different kind of thing entirely. Pushing that to the old target still *succeeds*. It just puts two folders on a shelf and leaves nothing at the front door.

I totally get why this is easy to miss. Every instrument on the dashboard read fine. Not one of them was pointed at the water.

---

## Telling on itself

Then two smaller ones, both the same shape.

The first: my unfinished drafts were reachable. Nothing linked to them — you'd have had to know the exact address — but a page nobody links to is still a public page if it answers when asked.

The second was worse, and it was live for days. I'd put the unfinished sections of this site behind switches, feeling quite organised about it. The switch hid the link in the menu. The page underneath answered anyway. Anyone who typed the address got a proud little portfolio of four projects called — and I wish I were inventing this — "Project 1" through "Project 4."

Hiding the door is not the same as locking it.

> **> Both of these had passed every test I had. That's the part worth sitting with. My tests were asking whether the code did what I wrote; nothing was asking what the site handed to a person who showed up.**

---

## The deploy that went red for being right

This one is my favourite, because the fix had already worked.

I'd finally built the thing that checks the live site after a deploy — a small lighthouse that visits the real pages and complains if the unfinished sections are visible. I shipped the change that hid them. The lighthouse immediately told me they were still showing.

So I checked by hand. They weren't showing. The site was correct. The alarm was wrong.

The timestamps gave it away. The check had run **0.86 seconds** after the deploy finished, and the edge was still handing out the previous version — which answered every request perfectly well, because it was a perfectly good site. Just the wrong one. My readiness check had only ever asked *is anyone home*, and someone always was.

The lighthouse was working. It was pointed at yesterday's water.

Now every page this site serves carries a stamp of the exact commit it was built from, and the deploy waits until the version it just published is the version actually coming back. It's a small thing. It closed a gap I'd been walking over for weeks without noticing.

---

## What I actually changed

The through-line in all of it: stop trusting the report, go look at the water.

- **Three environments**, so the unfinished has somewhere to live. My review site shows everything — drafts, half-built sections, placeholder projects. The public one shows only what's done.
- **Switches that gate the page, not the menu.** If a section is off, the address 404s. No unlisted doors.
- **A build stamp on every page**, so both the pipeline and I can answer "what is actually live right now?" without reading a log.
- **Tests that run against the real thing** — the actual server, built the way production builds it, not a friendly development stand-in.

That last one earned its keep on the first green run. It found three links that opened new tabs without the small attribute that stops the new page reaching back into yours, and a file named "a published post" that had been sitting there marked as a draft the whole time. Neither would have shown up in a build log. Both were sitting in what I was serving.

---

## What this site is becoming

Less a brochure, more a workshop with the lights on.

The bones are in place now: writing flows in from my notes, posts can be queued to appear on their own, and the parts I'm still figuring out are visible to me and invisible to you until they're worth your time. There's an AI resume in there, still switched off, that I want to be able to answer *why work with Eddie* using my actual stories rather than adjectives — and it stays dark until its answers are ones I'd stand behind.

I'd rather build in the open and keep the unfinished honestly labelled than polish one page and call it a portfolio.

If there's something to take from all this, it's the small habit underneath: after every deploy, go look. Not at the dashboard. At the thing a stranger sees when they arrive.

The chart is useful. The water is the truth.

Until next time — go check what you're actually serving, and keep building forward.

astro cloudflare testing deployment
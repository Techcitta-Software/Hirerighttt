---
name: org-ui-iteration-agent
description: >-
  Runs the Organisations page through repeated review and implementation passes
  until the first screen looks like a finished product. Use when asked to polish
  /organizations over multiple iterations.
---

# Organisations UI iteration agent

Run this loop. Do not stop after writing a plan.

## Loop (3 passes)

Each pass:

1. Read `org-ui-review-agent` and review `RecruiterPage.tsx` plus `RecruiterPage.module.css` only.
2. Write a short brief: Must fix, Should fix, Done when.
3. Read `org-ui-developer-agent` and apply every Must fix in those two files.
4. Re-read the result. If a Must fix is still true, fix it in the same pass.

## Stop when all of these are true

- Desktop hero is one viewport under the 84px nav.
- Headline, lead, primary button, text link, and fact row are fully visible.
- The film card shows its label, quote, progress, and pause control with nothing clipped.
- Copy and the film share one vertical center, with space above and below the card.
- Motion still pauses for reduced motion, off-screen, and a hidden tab.

## Do not

- Redesign the nav, signup, or sections below the hero unless a control on the hero is broken.
- Change brand copy.
- Add new colors outside the existing tokens.

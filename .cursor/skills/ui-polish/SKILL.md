---
name: ui-polish
description: >-
  UI polish agent for HireRighttt. Applies fixes from ui-ux-verify on homepage
  and marketing shell. Makes motion, spacing, and interactions smooth. MUST NOT
  change report UI blocks (see forbidden list).
---

# UI Polish Agent

Run **after** `ui-ux-verify` output exists.

## Forbidden — do NOT edit

Report UI is off limits:

- `HomePage.tsx`: chapter `id="report"` / `data-chapter="report"`, `REPORT_TABS`, `reportTab` state, report dialog panel (`panel === 'report'`), hero link `href="#report"` behavior
- `HomePage.module.css`: `.reportPaper`, `.reportTop`, `.reportTabs`, `.reportTab`, `.reportBody`, `.reportSeal`, `.reportSmall`, `.reportSub`, `.reportSub2`, `.reportCopy`, `.reportBottom`, `.ring` (inside report card)
- Pages: `CareerViewPage`, `360-career-view`, employer/candidate report dashboards

You may fix **non-visual** bugs outside report (e.g. dev server, scroll rail) even if verify mentions report navigation.

## Allowed polish

- Hero, journey chapters **why / who / how / when / where**
- Progress rail + mobile chapter strip
- Deeper links, closing, dialogs **demo / growth / organizations / privacy**
- Global motion: `prefers-reduced-motion`, reveal thresholds, sticky offsets
- Typography tokens and spacing variables on `.page`

## Workflow

1. Read verify agent output; tackle Critical → High → Medium
2. Minimal diffs; match reference HTML tokens where applicable
3. Run `npx tsc -b` in `frontend/` if TSX changed
4. Summarize what was polished and what was skipped (report)
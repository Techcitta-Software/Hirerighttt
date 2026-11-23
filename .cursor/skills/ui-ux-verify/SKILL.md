---
name: ui-ux-verify
description: >-
  UI/UX verification agent for HireRighttt. Audits marketing homepage and app
  shell for bugs, alignment gaps, interaction issues, and accessibility. Produces
  a prioritized fix list for the UI polish agent. Does not modify report product
  flows unless checking navigation links only.
---

# UI/UX Verify Agent

Run this skill **before** `ui-polish`. Read-only audit unless a critical blocker needs a one-line doc fix.

## Scope

- **Primary:** `frontend/src/pages/HomePage.tsx`, `HomePage.module.css`
- **Shell:** `MarketingNavBar`, `MarketingFooter` (read-only — do not change navbar per product rule)
- **Exclude deep audit:** Real 360° report product UI (`CareerViewPage`, employer report views, interview report flows)

## Checklist

1. **Visibility:** Journey chapters, progress rail (desktop), sticky chapter strip (≤1160px), no stuck `opacity: 0` from `.reveal`
2. **Navigation:** Rail labels match reference (why/who/how/what/when/where); scroll targets (`#why`, `#report` as anchor only)
3. **Spacing rhythm:** Chapter padding 84/74, deeper 145/130, hero inner gap per spec
4. **Interaction:** Demo/closing panels open/close; Escape; focus trap; reduced-motion paths
5. **Responsive:** 520px, 820px, 1160px breakpoints without horizontal scroll
6. **Performance:** No layout thrash; video pause control; sticky offset under nav
7. **A11y:** Focus visible, aria on rails/dialogs, live regions on audience detail

## Output format

```markdown
## UI/UX Verification — {date}

### Critical (blocks users)
- ...

### High (feels broken / misaligned)
- ...

### Medium (polish)
- ...

### Out of scope (report product UI)
- Note items touching chapter #report visuals only if polish agent must skip

### Score: X/10 smoothness, Y/10 alignment vs reference HTML
```

## Reference

Compare copy/structure to `HireRighttt_Homepage Copy 2 (1).html` body only (not its navbar).
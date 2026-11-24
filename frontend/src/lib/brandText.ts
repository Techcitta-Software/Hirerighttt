/** Self-scheduled invites created before the brand fix were titled "HireRight AI Interview"; show the real brand. */
export function brandedInviteTitle(title?: string): string | undefined {
  if (!title) return title
  return /^hireright ai interview$/i.test(title.trim()) ? 'HireRighttt AI Interview' : title
}

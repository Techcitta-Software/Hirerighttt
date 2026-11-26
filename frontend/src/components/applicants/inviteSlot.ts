/** Date / time slot helpers for the row / profile invite dialog. */

/** `YYYY-MM-DDTHH:mm` in local time for <input type="datetime-local">. */
export function toLocalInputValue(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The first whole hour at least an hour away: a sensible first slot. */
export function defaultSlot(now: number): string {
  const d = new Date(now + 60 * 60 * 1000)
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return toLocalInputValue(d.getTime())
}

/** Why a picked slot cannot be used, or '' when it can. */
export function slotError(value: string, now: number): string {
  if (!value) return 'Choose a date and time.'
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) return 'Choose a date and time.'
  if (t < now + 15 * 60 * 1000) return 'Pick a time at least 15 minutes from now.'
  if (t > now + 60 * 24 * 60 * 60 * 1000) return 'Pick a time within the next 60 days.'
  return ''
}

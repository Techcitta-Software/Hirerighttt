/**
 * Up to three highlight lines from a job description for the expanded job card. A line that only repeats the
 * "about" paragraph shown just above it is dropped: a one-paragraph JD used to appear twice (paragraph + bullet).
 */
export function jobDescriptionBullets(jd: string, aboutText: string): string[] {
  const norm = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()
  const about = norm(aboutText)
  return jd
    .split(/\n/)
    .map((line) => line.replace(/^[\s•\-*]+/, '').trim())
    .filter((line) => line.length > 20)
    .filter((line) => {
      const n = norm(line)
      return !(about && (about === n || about.startsWith(n) || n.startsWith(about)))
    })
    .slice(0, 3)
}

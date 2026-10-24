import { addNotification, getUser } from './store'

const BASELINE_SUFFIX = 'hireright.jobNotifyBaseline'
const NOTIFIED_IDS_SUFFIX = 'hireright.notifiedJobIds'

function baselineKey(email: string) {
  return `${BASELINE_SUFFIX}.${email}`
}

function notifiedIdsKey(email: string) {
  return `${NOTIFIED_IDS_SUFFIX}.${email}`
}

export type JobAlertPayload = {
  id: string
  title: string
  company: string
}

/** Notify the signed-in candidate about newly posted roles that match their profile. */
export function syncJobMatchNotifications(jobs: JobAlertPayload[]) {
  const email = getUser()?.email?.toLowerCase()
  if (!email || getUser()?.role === 'employer') return

  let notified: Set<string>
  try {
    notified = new Set(JSON.parse(localStorage.getItem(notifiedIdsKey(email)) || '[]') as string[])
  } catch {
    notified = new Set()
  }

  if (!localStorage.getItem(baselineKey(email))) {
    for (const job of jobs) {
      if (job.id) notified.add(job.id)
    }
    localStorage.setItem(notifiedIdsKey(email), JSON.stringify([...notified].slice(-300)))
    localStorage.setItem(baselineKey(email), new Date().toISOString())
    return
  }

  let added = false
  for (const job of jobs) {
    if (!job.id || notified.has(job.id)) continue
    notified.add(job.id)
    added = true
    addNotification(
      {
        kind: 'job_match',
        jobId: job.id,
        title: 'New role for you',
        body: `${job.title} at ${job.company} matches your profile.`,
        href: `/jobs?job=${encodeURIComponent(job.id)}`,
      },
      email,
    )
  }

  if (added) {
    localStorage.setItem(notifiedIdsKey(email), JSON.stringify([...notified].slice(-300)))
  }
}

/** Ensure dismissed job-match alerts are not recreated on the next poll. */
export function rememberNotifiedJobIds(jobIds: string[]) {
  const email = getUser()?.email?.toLowerCase()
  if (!email || !jobIds.length) return
  let notified: Set<string>
  try {
    notified = new Set(JSON.parse(localStorage.getItem(notifiedIdsKey(email)) || '[]') as string[])
  } catch {
    notified = new Set()
  }
  for (const id of jobIds) {
    if (id) notified.add(id)
  }
  localStorage.setItem(notifiedIdsKey(email), JSON.stringify([...notified].slice(-300)))
  if (!localStorage.getItem(baselineKey(email))) {
    localStorage.setItem(baselineKey(email), new Date().toISOString())
  }
}

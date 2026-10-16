import { buildApplyUrl } from './jobLink'
import type { EmployerJob } from './store'

export function jobApplyUrl(job: Pick<EmployerJob, 'company' | 'shareableCode'>): string {
  return buildApplyUrl(job.company, job.shareableCode)
}

export function jobInviteShareText(job: Pick<EmployerJob, 'title' | 'company' | 'shareableCode'>): {
  subject: string
  body: string
  shortText: string
} {
  const url = jobApplyUrl(job)
  const subject = `Apply: ${job.title} at ${job.company || 'HireRight'}`
  const body = [
    `Hello,`,
    ``,
    `You are invited to apply for ${job.title}${job.company ? ` at ${job.company}` : ''}.`,
    `Upload your resume, complete your profile, and take the AI interview using this private link:`,
    ``,
    url,
    ``,
    `— Sent via HireRight Employer Portal`,
  ].join('\n')
  const shortText = `Apply for ${job.title}: ${url}`
  return { subject, body, shortText }
}

export type JobShareChannel = {
  id: string
  label: string
  href: string
  external?: boolean
}

export function buildJobShareChannels(
  job: Pick<EmployerJob, 'title' | 'company' | 'shareableCode'>,
): JobShareChannel[] {
  const url = jobApplyUrl(job)
  const { subject, body, shortText } = jobInviteShareText(job)
  const encSubject = encodeURIComponent(subject)
  const encBody = encodeURIComponent(body)
  const encShort = encodeURIComponent(shortText)
  const encUrl = encodeURIComponent(url)

  return [
    {
      id: 'gmail',
      label: 'Gmail',
      href: `https://mail.google.com/mail/?view=cm&fs=1&su=${encSubject}&body=${encBody}`,
      external: true,
    },
    {
      id: 'outlook',
      label: 'Outlook',
      href: `https://outlook.office.com/mail/deeplink/compose?subject=${encSubject}&body=${encBody}`,
      external: true,
    },
    {
      id: 'outlook-live',
      label: 'Outlook.com',
      href: `https://outlook.live.com/mail/0/deeplink/compose?subject=${encSubject}&body=${encBody}`,
      external: true,
    },
    {
      id: 'mailto',
      label: 'Default mail app',
      href: `mailto:?subject=${encSubject}&body=${encBody}`,
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      href: `https://wa.me/?text=${encShort}`,
      external: true,
    },
    {
      id: 'telegram',
      label: 'Telegram',
      href: `https://t.me/share/url?url=${encUrl}&text=${encodeURIComponent(subject)}`,
      external: true,
    },
    {
      id: 'linkedin',
      label: 'LinkedIn',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encUrl}`,
      external: true,
    },
  ]
}

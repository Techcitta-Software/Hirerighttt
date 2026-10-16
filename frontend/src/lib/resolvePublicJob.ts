import { fetchPublicJob, type VendorJob } from './vendorApi'
import { companySlugMatches } from './jobLink'

export async function resolvePublicJob(
  code: string,
  companySlug?: string,
): Promise<{ job: VendorJob | null; error: string }> {
  const trimmed = String(code || '').trim()
  if (!trimmed) {
    return { job: null, error: 'Missing job code in this link.' }
  }

  const attempts: (string | undefined)[] = companySlug
    ? [companySlug, undefined]
    : [undefined]

  let lastError = ''
  for (const slugTry of attempts) {
    try {
      const { job: remote } = await fetchPublicJob(trimmed, slugTry)
      if (remote?.shareableCode) {
        return { job: remote, error: '' }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }

  return {
    job: null,
    error:
      lastError ||
      'This job link could not be found. Make sure the employer created the job while signed in and the API is running.',
  }
}

function validateJobForSlug(job: { company: string }, companySlug?: string) {
  return companySlugMatches(job.company, companySlug)
}

export { validateJobForSlug }

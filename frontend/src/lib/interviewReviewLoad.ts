import {
  fetchVendorCandidateRecordingDocument,
  fetchVendorInterviewReview,
  type VendorCandidateRecordingLink,
} from './vendorApi'

type InterviewReview = Awaited<ReturnType<typeof fetchVendorInterviewReview>>

/**
 * The recording link and the proctoring review of one interview, both optional. Each request settles on its own, so
 * a 404 ("Interview not found for this candidate." for an old or removed session) never escapes as an unhandled
 * rejection while the other request is in flight: the report then shows its "no recording" note instead.
 */
export async function loadRecordingAndReview(
  candidateEmail: string,
  sessionHint: string | null,
  api: {
    recording: typeof fetchVendorCandidateRecordingDocument
    review: typeof fetchVendorInterviewReview
  } = { recording: fetchVendorCandidateRecordingDocument, review: fetchVendorInterviewReview },
): Promise<{ rec: VendorCandidateRecordingLink | null; review: InterviewReview | null }> {
  const settle = <T,>(p: () => Promise<T>) => p().catch(() => null)
  const reviewPromise = sessionHint ? settle(() => api.review(sessionHint, candidateEmail)) : null
  const rec = await settle(() => api.recording(candidateEmail, sessionHint))
  const review = reviewPromise
    ? await reviewPromise
    : rec?.sessionId
      ? await settle(() => api.review(rec.sessionId as string, candidateEmail))
      : null
  return { rec, review }
}

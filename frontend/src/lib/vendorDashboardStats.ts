import { candidateScore, needsIntegrityReview } from "./candidateSearch";
import type { EmployerApplicant } from "./store";
import type { VendorJob } from "./vendorApi";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Every opening this person applied to (one row per person can carry several applications). */
function jobIdsOf(
  c: Pick<EmployerApplicant, "jobId" | "appliedJobIds">,
): string[] {
  if (c.appliedJobIds?.length) return c.appliedJobIds;
  return c.jobId ? [c.jobId] : [];
}

/** The employer dashboard's numbers. A person on several openings counts on each (same as the Jobs list). */
export function vendorDashboardStats(
  jobs: Pick<VendorJob, "id" | "title">[],
  candidates: EmployerApplicant[],
  now: number,
) {
  // A person who applied to several openings counts on each of them (same numbers as the Jobs list).
  const jobIdsWithApplicants = new Set(candidates.flatMap((c) => jobIdsOf(c)));
  const interviewed = candidates.filter((c) => Boolean(c.interviewResult));
  const scores = interviewed
    .map((c) => candidateScore(c))
    .filter((s): s is number => s !== null);
  const weekAgo = now - WEEK_MS;
  const byStatus: Record<string, number> = {};
  for (const c of candidates) {
    const key = c.status === "Interviewing" ? "In Review" : c.status;
    byStatus[key] = (byStatus[key] || 0) + 1;
  }
  const perJob = jobs
    .map((j) => ({
      id: j.id,
      title: j.title,
      count: candidates.filter((c) => jobIdsOf(c).includes(j.id)).length,
    }))
    .sort((a, b) => b.count - a.count);
  return {
    allJobs: jobs.length,
    activeJobs: jobs.filter((j) => jobIdsWithApplicants.has(j.id)).length,
    totalCandidates: candidates.length,
    interviewsCompleted: interviewed.length,
    averageScore: scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null,
    strong: scores.filter((s) => s >= 70).length,
    awaitingInterview: candidates.length - interviewed.length,
    integrityReview: candidates.filter((c) => needsIntegrityReview(c)).length,
    newThisWeek: candidates.filter(
      (c) => new Date(c.appliedAt).getTime() >= weekAgo,
    ).length,
    jobsWithoutApplicants: perJob.filter((j) => j.count === 0).length,
    byStatus,
    perJob,
  };
}

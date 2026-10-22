# Interview camera review

The interview frontend uses the existing MediaPipe Tasks Vision face detector. Face keypoints provide a heuristic head-turn signal; this is not gaze tracking or proof of cheating. No face embeddings or identity recognition are stored.

## Candidate flow

- The setup screen explains the checks and requires three seconds of one centered, well-lit face before camera-based entry. The existing camera-free option remains available; unavailable frames during that interview are recorded as unable to assess.
- Recording is opt-in. It requires a backend interview session and the existing private S3 recording infrastructure. Candidate pages do not expose recording playback or save new recordings in IndexedDB.
- Sustained absence and multiple faces require three seconds. Head turns require four seconds, allowing normal short glances. Unavailable, dark, overexposed, low-contrast, distant, stale, or low-confidence frames become unable-to-assess events after two seconds.
- Events use elapsed time from the recording start, an absolute timestamp, and a duration. Each contiguous event gets one ID; updates extend its duration.
- Events sync every five seconds and on completion. Failed saves are shown and completion can be retried. A failed recording upload retains the clip in memory for another Leave attempt; closing the tab loses that pending clip.
- The candidate dashboard lets candidates attach explanations to events without accessing video.

## Vendor report

The employer report loads `/api/vendor/interview-review?sessionId=…`. The API checks employer role, current organization membership, allowed reviewer role, active organization, and session tenant. The existing recording download endpoint now applies the same vendor restrictions; owning the candidate account does not grant playback access.

The playback scrubber is below the video. Red segments mark observations for review and gray segments mark inability to assess. Clicking Review clip plays the event with two seconds of context on either side. Clips are bounded playback of the original recording, not separately exported files. Legacy events without real offsets have no fabricated seek positions.

Recording URLs are expiring S3 bearer URLs. Keep the bucket private and do not share signed URLs. `controlsList="nodownload"` is a browser UI hint, not a way to prevent an authorized viewer copying a video.

## Deployment and validation

Use the existing `npm run db:init` recording tables, database connection, S3 bucket/region/credentials, and upload CORS configuration. Camera access needs HTTPS or localhost. MediaPipe currently loads pinned WASM and model assets from the existing external asset URLs, so those origins must be reachable and allowed by CSP.

`node --test backend/node/tests/interviewReview.test.mjs` covers temporal aggregation, uncertainty, idempotent persistence, and recording storage authorization. `npm run build` validates the frontend.

Before release, verify camera behavior with different lighting, glasses, devices and head positions; complete a recorded test interview; review playback as the owning vendor; confirm candidate and unrelated-vendor access is rejected; and test an expired playback URL and interrupted upload. Browser-derived telemetry can be incomplete or manipulated and must only support human review. No camera observations should affect competency scoring or automatically terminate an interview.

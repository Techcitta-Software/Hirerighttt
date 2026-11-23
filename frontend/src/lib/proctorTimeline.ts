/**
 * Proctoring deviations laid out on the interview-recording timeline (pure logic, no React).
 *
 * Inputs are the review events the server stored for the session (offsets are seconds from the start of the
 * recording) and, for older interviews, the proctor engine's flagged sections. Everything here is defensive: the
 * data originally came from the candidate's browser.
 */
import type { IntegrityLogEvent, InterviewFlagSection } from './store'

export type DeviationCategory =
  | 'gaze'
  | 'no_face'
  | 'multi_face'
  | 'movement'
  | 'phone'
  | 'tab'
  | 'camera'
  | 'copy'
  | 'ended'

export const CATEGORY_LABELS: Record<DeviationCategory, string> = {
  gaze: 'Looked away',
  no_face: 'No face',
  multi_face: 'Multiple faces',
  movement: 'Head movement',
  phone: 'Phone in view',
  tab: 'Left tab / window',
  camera: 'Camera unclear',
  copy: 'Copy / shortcuts',
  ended: 'Interview ended',
}

/** Legend order: camera-based signals first, then browser lockdown. */
export const CATEGORY_ORDER: DeviationCategory[] = [
  'gaze',
  'no_face',
  'multi_face',
  'movement',
  'phone',
  'tab',
  'camera',
  'copy',
  'ended',
]

export type TimelineMarker = {
  id: string
  category: DeviationCategory
  label: string
  startSec: number
  endSec: number
  /** Instant events (tab switch, copy attempt) render as a tick instead of a segment. */
  instant: boolean
  severity: 'high' | 'medium'
  message: string
}

export type PlacedMarker = TimelineMarker & {
  /** Position along the track, 0–100. */
  leftPct: number
  widthPct: number
  /** The event lies (partly) past the end of the video and was pulled back onto the track. */
  clamped: boolean
}

/** Shorter than this, a deviation is drawn as a tick. */
const INSTANT_SEC = 0.5
/** Segments never shrink below this share of the track, so a 1 s glance is still visible on an hour-long video. */
export const MIN_SEGMENT_PCT = 0.6
/** Same cap the server applies per session. */
export const MAX_TIMELINE_MARKERS = 1000

const EVENT_CATEGORY: Record<IntegrityLogEvent['eventType'], DeviationCategory> = {
  SIDE_GAZE_LOOKING_AWAY: 'gaze',
  NO_FACE_SEEN: 'no_face',
  MULTIPLE_FACES_DETECTED: 'multi_face',
  EXCESSIVE_MOVEMENT: 'movement',
  PHONE_DETECTED: 'phone',
  TAB_OR_WINDOW_LEFT: 'tab',
  FULLSCREEN_EXITED: 'tab',
  MULTIPLE_MONITORS: 'tab',
  UNABLE_TO_ASSESS: 'camera',
  VIRTUAL_CAMERA_SUSPECTED: 'camera',
  COPY_PASTE_ATTEMPT: 'copy',
  BLOCKED_SHORTCUT: 'copy',
  DEVTOOLS_SUSPECTED: 'copy',
  SCREENSHOT_ATTEMPT: 'copy',
  INTERVIEW_BANNED: 'ended',
}

const FLAG_CATEGORY: Record<InterviewFlagSection['type'], DeviationCategory> = {
  LOOKING_SIDE: 'gaze',
  NO_FACE: 'no_face',
  MULTI_FACE: 'multi_face',
}

function finite(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function categoryForEvent(e: IntegrityLogEvent): DeviationCategory | null {
  const category = EVENT_CATEGORY[e.eventType]
  if (!category) return null
  // The face tracker reports a hidden tab as "camera paused — keep this tab open": that is a tab switch.
  if (category === 'camera' && /tab/i.test(e.message || '')) return 'tab'
  return category
}

function eventStartSec(e: IntegrityLogEvent): number | null {
  const ms = finite(e.startOffsetMs)
  if (ms !== null) return ms / 1000
  return finite(e.startOffsetSec)
}

function eventEndSec(e: IntegrityLogEvent, start: number): number {
  const endMs = finite(e.endOffsetMs)
  if (endMs !== null) return Math.max(start, endMs / 1000)
  const duration = finite(e.durationSec)
  return start + Math.max(0, duration ?? 0)
}

function overlaps(a: TimelineMarker, b: TimelineMarker, slackSec = 1): boolean {
  return a.startSec <= b.endSec + slackSec && b.startSec <= a.endSec + slackSec
}

/**
 * One marker per deviation. Review events are the source of truth; flagged sections from the proctor engine are
 * added only where no review event of the same kind already covers that time (older interviews only have those).
 */
export function buildTimelineMarkers(
  events: readonly IntegrityLogEvent[] | null | undefined,
  flaggedSections: readonly InterviewFlagSection[] | null | undefined = [],
): TimelineMarker[] {
  const markers: TimelineMarker[] = []
  const seen = new Set<string>()
  for (const e of events ?? []) {
    if (!e || typeof e !== 'object') continue
    const category = categoryForEvent(e)
    const start = eventStartSec(e)
    if (!category || start === null || start < 0) continue
    const id = String(e.id || `ev-${markers.length}`)
    if (seen.has(id)) continue
    seen.add(id)
    const end = eventEndSec(e, start)
    markers.push({
      id,
      category,
      label: CATEGORY_LABELS[category],
      startSec: start,
      endSec: end,
      instant: end - start < INSTANT_SEC,
      severity: e.severity === 'block' || e.severity === 'ban' || category === 'multi_face' || category === 'phone' ? 'high' : 'medium',
      message: String(e.message || '').slice(0, 300),
    })
  }
  const fromEvents = markers.slice()
  for (const f of flaggedSections ?? []) {
    if (!f || typeof f !== 'object') continue
    const category = FLAG_CATEGORY[f.type]
    const start = finite(f.startSec)
    if (!category || start === null || start < 0) continue
    const end = Math.max(start, finite(f.endSec) ?? start + Math.max(0, finite(f.durationSec) ?? 0))
    const marker: TimelineMarker = {
      id: `flag-${f.id || markers.length}`,
      category,
      label: CATEGORY_LABELS[category],
      startSec: start,
      endSec: end,
      instant: end - start < INSTANT_SEC,
      severity: f.severity === 'high' || category === 'multi_face' ? 'high' : 'medium',
      message: String(f.reason || '').slice(0, 300),
    }
    if (fromEvents.some((m) => m.category === category && overlaps(m, marker))) continue
    markers.push(marker)
  }
  return markers.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec).slice(0, MAX_TIMELINE_MARKERS)
}

/**
 * The length of the track. Browsers report Infinity/NaN for MediaRecorder WebM files until they have scanned them,
 * so fall back to the duration stored with the recording, then to the last deviation.
 */
export function resolveTimelineDuration(
  videoDuration: number | null | undefined,
  durationHint: number | null | undefined,
  markers: readonly TimelineMarker[] = [],
): { durationSec: number; known: boolean } {
  const video = finite(videoDuration)
  if (video !== null && video > 0) return { durationSec: video, known: true }
  const hint = finite(durationHint)
  if (hint !== null && hint > 0) return { durationSec: hint, known: true }
  const last = markers.reduce((max, m) => Math.max(max, m.endSec), 0)
  return { durationSec: Math.max(1, last), known: false }
}

/** Percent positions on a track of `durationSec`; anything past the end of the video is clamped onto it. */
export function placeMarkers(markers: readonly TimelineMarker[], durationSec: number): PlacedMarker[] {
  const total = durationSec > 0 && Number.isFinite(durationSec) ? durationSec : 1
  return markers.map((m) => {
    const start = Math.min(Math.max(0, m.startSec), total)
    const end = Math.min(Math.max(start, m.endSec), total)
    const clamped = m.endSec > total || m.startSec > total
    const leftPct = (start / total) * 100
    let widthPct = m.instant ? 0 : ((end - start) / total) * 100
    if (!m.instant) {
      widthPct = Math.max(MIN_SEGMENT_PCT, widthPct)
      // Keep a minimum-width segment that starts near the end inside the track.
      if (leftPct + widthPct > 100) return { ...m, leftPct: 100 - widthPct, widthPct, clamped }
    }
    return { ...m, leftPct, widthPct, clamped }
  })
}

/** Where a click on a marker should take the video. */
export function seekTargetForMarker(marker: Pick<TimelineMarker, 'startSec'>, durationSec: number): number {
  const start = finite(marker.startSec) ?? 0
  const total = finite(durationSec) ?? 0
  return total > 0 ? Math.min(Math.max(0, start), total) : Math.max(0, start)
}

/** Where a click at `ratio` (0–1) of the track width should take the video. */
export function seekTargetForRatio(ratio: number, durationSec: number): number {
  const r = Math.min(1, Math.max(0, finite(ratio) ?? 0))
  return r * Math.max(0, finite(durationSec) ?? 0)
}

export function formatTimelineClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`
}

function formatSpan(sec: number): string {
  const s = Math.max(1, Math.round(sec))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rest = s % 60
  return rest ? `${m}m ${rest}s` : `${m}m`
}

/** "Looked away · 03:42 (6s)" — instant events have no duration part. */
export function markerTooltip(marker: Pick<TimelineMarker, 'label' | 'startSec' | 'endSec' | 'instant'>): string {
  const at = formatTimelineClock(marker.startSec)
  return marker.instant
    ? `${marker.label} · ${at}`
    : `${marker.label} · ${at} (${formatSpan(marker.endSec - marker.startSec)})`
}

export function countByCategory(
  markers: readonly TimelineMarker[],
): { category: DeviationCategory; label: string; count: number }[] {
  const counts = new Map<DeviationCategory, number>()
  for (const m of markers) counts.set(m.category, (counts.get(m.category) ?? 0) + 1)
  return CATEGORY_ORDER.filter((c) => counts.has(c)).map((c) => ({
    category: c,
    label: CATEGORY_LABELS[c],
    count: counts.get(c) ?? 0,
  }))
}

/** Index of the marker to focus when stepping with the arrow keys from `from` (wraps at both ends). */
export function stepMarkerIndex(count: number, from: number, key: string): number {
  if (count <= 0) return -1
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowRight' || key === 'ArrowDown') return (from + 1 + count) % count
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (from - 1 + count) % count
  return from
}

/** Index of the first marker at or after `timeSec` (for a sensible starting point when tabbing into the markers). */
export function markerIndexAtTime(markers: readonly TimelineMarker[], timeSec: number): number {
  if (!markers.length) return -1
  const i = markers.findIndex((m) => m.endSec >= timeSec)
  return i === -1 ? markers.length - 1 : i
}

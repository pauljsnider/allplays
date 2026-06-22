import { recordAppUxTiming } from './telemetry';

/**
 * Canonical span labels for the app-performance metric set (see
 * docs/app-performance-baseline.md). Using shared constants keeps lab
 * instrumentation and the production telemetry dashboard on the same names.
 */
export const UX_TIMING = {
  appStartup: 'app startup',
  firstMeaningfulRender: 'first meaningful render',
  homeMount: 'home mount load',
  scheduleMount: 'schedule mount load',
  messagesMount: 'messages mount load',
  rsvpTap: 'rsvp tap latency',
  chatSend: 'chat send latency'
} as const;

type ScreenMountRoute = 'home' | 'schedule' | 'messages';

const SCREEN_MOUNT_TIMING: Record<ScreenMountRoute, typeof UX_TIMING[keyof typeof UX_TIMING]> = {
  home: UX_TIMING.homeMount,
  schedule: UX_TIMING.scheduleMount,
  messages: UX_TIMING.messagesMount
};

export function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function startUxTimer(label: string, baseMeta: Record<string, unknown> = {}) {
  const startedAt = now();
  return {
    end(meta: Record<string, unknown> = {}) {
      recordUxTiming(label, startedAt, { ...baseMeta, ...meta });
    }
  };
}

/**
 * Times a top-level app screen load using stable labels and bounded metadata so
 * local logs and telemetry payloads can compare before/after screen work.
 */
export function startScreenMountTimer(route: ScreenMountRoute, baseMeta: Record<string, unknown> = {}) {
  return startUxTimer(SCREEN_MOUNT_TIMING[route], {
    category: 'screen_mount',
    route,
    ...baseMeta
  });
}

/**
 * Times a discrete user interaction (RSVP tap, chat send, …) so we can report
 * tap-to-confirmation latency percentiles alongside cold-start numbers.
 */
export function startInteractionTimer(label: string, baseMeta: Record<string, unknown> = {}) {
  return startUxTimer(label, { category: 'interaction', ...baseMeta });
}

export function recordUxTiming(label: string, startedAt: number, meta: Record<string, unknown> = {}) {
  const durationMs = Math.round(now() - startedAt);
  console.info(`[ux] ${label} ${JSON.stringify({ durationMs, ...meta })}`);
  recordAppUxTiming(label, startedAt, meta);
}

let firstMeaningfulRenderRecorded = false;

/**
 * Records app-start → first meaningful render exactly once per page load. The
 * "start" baseline is navigation start (performance.now() is measured from it),
 * so this captures the full cold-start cost the user actually feels — not just
 * React's initial mount.
 */
export function recordFirstMeaningfulRender(route: string, meta: Record<string, unknown> = {}) {
  if (firstMeaningfulRenderRecorded) return;
  if (typeof performance === 'undefined') return;
  firstMeaningfulRenderRecorded = true;
  // performance.now() is relative to navigation start, so passing 0 yields
  // "time since the page began loading".
  recordUxTiming(UX_TIMING.firstMeaningfulRender, 0, { route, ...meta });
}

export function hasRecordedFirstMeaningfulRender() {
  return firstMeaningfulRenderRecorded;
}

/** Test-only: reset the once-per-load guard. */
export function resetFirstMeaningfulRenderForTests() {
  firstMeaningfulRenderRecorded = false;
}

import { createLogger } from './logger';
import { recordAppUxTiming } from './telemetry';
import { diffNativeReadMetrics, snapshotNativeReadMetrics } from './nativeReadMetrics';
import { now, recordCompletedPerformanceSpan, startPerformanceSpan } from './performanceInstrumentation';

const logger = createLogger('ux');

/**
 * Canonical span labels for the app-performance metric set (see
 * docs/app-performance-baseline.md). Using shared constants keeps lab
 * instrumentation and the production telemetry dashboard on the same names.
 */
export const UX_TIMING = {
  appStartup: 'app startup',
  appStartToHomeRender: 'app start to home first meaningful render',
  firstMeaningfulRender: 'first meaningful render',
  warmResume: 'warm resume to interactive',
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

export function startUxTimer(label: string, baseMeta: Record<string, unknown> = {}) {
  const performanceSpan = startPerformanceSpan(label, {
    kind: 'ux',
    meta: baseMeta
  });
  const readsAtStart = snapshotNativeReadMetrics();
  return {
    end(meta: Record<string, unknown> = {}) {
      // Reads-per-mount: how many native Firestore requests this span fanned out
      // (and how many were avoided by dedup). Surfaces over-fetching on
      // multi-team accounts without per-call logging. Only attached when reads
      // actually occurred so zero-read spans keep their existing payload shape.
      const readDelta = diffNativeReadMetrics(readsAtStart, snapshotNativeReadMetrics());
      const readMeta = (readDelta.reads > 0 || readDelta.dedupHits > 0)
        ? { nativeReads: readDelta.reads, nativeDedupHits: readDelta.dedupHits }
        : {};
      const mergedMeta = { ...baseMeta, ...readMeta, ...meta };
      recordUxTiming(label, performanceSpan.startedAt, mergedMeta, { recordPerformance: false });
      performanceSpan.end(mergedMeta);
    }
  };
}

/**
 * Times the app-shell startup boundary. This keeps startup spans in uxTiming
 * while telemetry remains the transport layer.
 */
export function startAppStartupTimer(baseMeta: Record<string, unknown> = {}) {
  return startUxTimer(UX_TIMING.appStartup, {
    category: 'startup',
    stage: 'startup',
    ...baseMeta
  });
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

export function startWarmResumeTimer(baseMeta: Record<string, unknown> = {}) {
  return startUxTimer(UX_TIMING.warmResume, {
    category: 'resume',
    ...baseMeta
  });
}

export function recordUxTiming(
  label: string,
  startedAt: number,
  meta: Record<string, unknown> = {},
  options: { recordPerformance?: boolean } = {}
) {
  const durationMs = Math.round(now() - startedAt);
  logger.info(label, { durationMs, ...meta });
  recordAppUxTiming(label, startedAt, meta);
  if (options.recordPerformance !== false) {
    recordCompletedPerformanceSpan(label, startedAt, durationMs, {
      kind: 'ux',
      meta
    });
  }
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
  if (route === 'home') {
    recordUxTiming(UX_TIMING.appStartToHomeRender, 0, { category: 'startup', route, ...meta });
  }
  recordUxTiming(UX_TIMING.firstMeaningfulRender, 0, { route, ...meta });
}

export function hasRecordedFirstMeaningfulRender() {
  return firstMeaningfulRenderRecorded;
}

/** Test-only: reset the once-per-load guard. */
export function resetFirstMeaningfulRenderForTests() {
  firstMeaningfulRenderRecorded = false;
}

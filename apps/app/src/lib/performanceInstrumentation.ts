import { Capacitor } from '@capacitor/core';
import { createLogger } from './logger';

type PerformanceSpanKind = 'ux' | 'workflow' | 'initial_load';
type PerformanceMeta = Record<string, unknown>;

export type PerformanceSpanOptions = {
  kind: PerformanceSpanKind;
  meta?: PerformanceMeta;
};

export type StartedPerformanceSpan = {
  label: string;
  traceName: string;
  startedAt: number;
  end: (meta?: PerformanceMeta) => void;
};

type FirebasePerformanceRef = { api: FirebasePerformanceApi };
type FirebasePerformanceApi = typeof import('@capacitor-firebase/performance').FirebasePerformance;
type NativeTraceLease = {
  baseTraceName: string;
  lane: number;
  traceName: string;
};

const logger = createLogger('performance');
const MAX_FIREBASE_ATTRIBUTE_COUNT = 5;
const MAX_FIREBASE_METRIC_COUNT = 10;
const MAX_ATTRIBUTE_VALUE_LENGTH = 100;
const MAX_NATIVE_TRACE_LANES = 8;

let sequence = 0;
let firebasePerformancePromise: Promise<FirebasePerformanceRef | null> | null = null;
const activeNativeTraceLanes = new Map<string, Set<number>>();
const nativeTraceQueues = new Map<string, Promise<void>>();

export function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function startPerformanceSpan(label: string, options: PerformanceSpanOptions): StartedPerformanceSpan {
  const startedAt = now();
  const id = ++sequence;
  const traceName = buildPerformanceTraceName(label, options.kind);
  const startMark = `allplays:${traceName}:${id}:start`;
  const endMark = `allplays:${traceName}:${id}:end`;
  const platform = getPerformancePlatform();
  const nativeTraceLease = platform === 'web' ? null : acquireNativeTraceLease(traceName);
  let ended = false;

  mark(startMark);
  if (nativeTraceLease) {
    void startNativeFirebaseTrace(nativeTraceLease.traceName, options.meta);
  }

  return {
    label,
    traceName,
    startedAt,
    end(meta: PerformanceMeta = {}) {
      if (ended) return;
      ended = true;
      const durationMs = Math.max(0, Math.round(now() - startedAt));
      mark(endMark);
      measure(`allplays:${traceName}`, startMark, endMark);
      const mergedMeta = { ...options.meta, ...meta };
      if (platform === 'web') {
        void recordFirebaseTrace(traceName, getEpochStartTime(startedAt), durationMs, mergedMeta);
      } else if (nativeTraceLease) {
        void stopNativeFirebaseTrace(nativeTraceLease.traceName, mergedMeta, durationMs);
        releaseNativeTraceLease(nativeTraceLease);
      }
    }
  };
}

export function recordCompletedPerformanceSpan(label: string, startedAt: number, durationMs: number, options: PerformanceSpanOptions) {
  const traceName = buildPerformanceTraceName(label, options.kind);
  const startMark = `allplays:${traceName}:completed:${++sequence}:start`;
  const endMark = `allplays:${traceName}:completed:${sequence}:end`;

  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
    try {
      performance.mark(startMark, { startTime: Math.max(0, startedAt) });
      performance.mark(endMark, { startTime: Math.max(0, startedAt + durationMs) });
      measure(`allplays:${traceName}`, startMark, endMark);
      void recordFirebaseTrace(traceName, getEpochStartTime(startedAt), durationMs, options.meta);
      return;
    } catch (error) {
      logger.debug('Completed span mark failed.', { error, label });
    }
  }

  void recordFirebaseTrace(traceName, Date.now() - durationMs, durationMs, options.meta);
}

export function buildPerformanceTraceName(label: string, kind: PerformanceSpanKind) {
  const base = String(label || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 82) || 'unknown';
  return `ap_${kind}_${base}`.slice(0, 100);
}

export function getPerformancePlatform() {
  try {
    return Capacitor.getPlatform?.() || 'web';
  } catch {
    return 'web';
  }
}

function isPerformanceExportEnabled() {
  if (typeof window === 'undefined') return false;
  const runtime = window as typeof window & {
    __ALLPLAYS_CONFIG__?: Record<string, unknown>;
    ALLPLAYS_PERFORMANCE_ENABLED?: boolean;
  };
  if (runtime.ALLPLAYS_PERFORMANCE_ENABLED === false) return false;
  if (runtime.__ALLPLAYS_CONFIG__?.performanceMonitoringEnabled === false) return false;
  return true;
}

function mark(name: string) {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
  try {
    performance.mark(name);
  } catch (error) {
    logger.debug('Performance mark failed.', { error, name });
  }
}

function measure(name: string, startMark: string, endMark: string) {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return;
  try {
    performance.measure(name, startMark, endMark);
  } catch (error) {
    logger.debug('Performance measure failed.', { error, name });
  } finally {
    try {
      performance.clearMarks?.(startMark);
      performance.clearMarks?.(endMark);
    } catch (error) {
      logger.debug('Performance mark cleanup failed.', { error, name });
    }
  }
}

function getEpochStartTime(startedAt: number) {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    const timeOrigin = typeof performance.timeOrigin === 'number'
      ? performance.timeOrigin
      : Date.now() - now();
    return Math.round(timeOrigin + startedAt);
  }
  return Math.round(startedAt);
}

async function loadFirebasePerformance(): Promise<FirebasePerformanceRef | null> {
  if (!isPerformanceExportEnabled()) return null;
  if (!firebasePerformancePromise) {
    firebasePerformancePromise = (async () => {
      if (getPerformancePlatform() === 'web') {
        // The plugin's web implementation reads the npm firebase SDK's
        // '[DEFAULT]' app, but the app shell initializes the vendored legacy
        // SDK — a separate registry. Without this init every web trace call
        // fails with app/no-app.
        await ensureNpmFirebaseAppInitialized();
      }
      const module = await import('@capacitor-firebase/performance');
      return { api: module.FirebasePerformance };
    })().catch((error) => {
      logger.debug('Firebase Performance unavailable.', { error });
      return null;
    });
  }
  return firebasePerformancePromise;
}

async function ensureNpmFirebaseAppInitialized() {
  const [{ getApps, initializeApp }, { resolvePrimaryFirebaseConfig }] = await Promise.all([
    import('firebase/app'),
    import('./adapters/legacyFirebaseAuthSdk')
  ]);
  if (!getApps().length) {
    initializeApp(await resolvePrimaryFirebaseConfig());
  }
}

function acquireNativeTraceLease(baseTraceName: string): NativeTraceLease | null {
  const activeLanes = activeNativeTraceLanes.get(baseTraceName) || new Set<number>();
  for (let lane = 0; lane < MAX_NATIVE_TRACE_LANES; lane += 1) {
    if (activeLanes.has(lane)) continue;
    activeLanes.add(lane);
    activeNativeTraceLanes.set(baseTraceName, activeLanes);
    const suffix = lane === 0 ? '' : `_p${lane + 1}`;
    return {
      baseTraceName,
      lane,
      traceName: `${baseTraceName.slice(0, 100 - suffix.length)}${suffix}`
    };
  }
  logger.debug('Native Firebase trace concurrency limit reached.', { traceName: baseTraceName });
  return null;
}

function releaseNativeTraceLease(lease: NativeTraceLease) {
  const activeLanes = activeNativeTraceLanes.get(lease.baseTraceName);
  if (!activeLanes) return;
  activeLanes.delete(lease.lane);
  if (!activeLanes.size) {
    activeNativeTraceLanes.delete(lease.baseTraceName);
  }
}

function enqueueNativeTraceOp(traceName: string, operation: () => Promise<void>) {
  const previous = nativeTraceQueues.get(traceName) || Promise.resolve();
  const current = previous.then(operation, operation);
  const queued = current.catch(() => {});
  nativeTraceQueues.set(traceName, queued);
  return current.finally(() => {
    if (nativeTraceQueues.get(traceName) === queued) {
      nativeTraceQueues.delete(traceName);
    }
  });
}

async function startNativeFirebaseTrace(traceName: string, meta: PerformanceMeta = {}) {
  await enqueueNativeTraceOp(traceName, async () => {
    try {
      const firebasePerformance = await loadFirebasePerformance();
      if (!firebasePerformance) return;
      await firebasePerformance.api.startTrace({ traceName });
      await applyFirebaseAttributes(firebasePerformance.api, traceName, meta);
    } catch (error) {
      logger.debug('Firebase native trace start failed.', { error, traceName });
    }
  });
}

async function stopNativeFirebaseTrace(traceName: string, meta: PerformanceMeta = {}, durationMs = 0) {
  await enqueueNativeTraceOp(traceName, async () => {
    try {
      const firebasePerformance = await loadFirebasePerformance();
      if (!firebasePerformance) return;
      await applyFirebaseAttributes(firebasePerformance.api, traceName, meta);
      await applyFirebaseMetrics(firebasePerformance.api, traceName, meta, durationMs);
      await firebasePerformance.api.stopTrace({ traceName });
    } catch (error) {
      logger.debug('Firebase native trace stop failed.', { error, traceName });
    }
  });
}

async function recordFirebaseTrace(traceName: string, startTime: number, durationMs: number, meta: PerformanceMeta = {}) {
  if (getPerformancePlatform() !== 'web') return;
  try {
    const firebasePerformance = await loadFirebasePerformance();
    if (!firebasePerformance?.api.record) return;
    await firebasePerformance.api.record({
      traceName,
      startTime,
      duration: Math.max(0, Math.round(durationMs)),
      options: {
        attributes: buildFirebaseAttributes(meta),
        metrics: buildFirebaseMetrics(meta, durationMs)
      }
    });
  } catch (error) {
    logger.debug('Firebase trace record failed.', { error, traceName });
  }
}

async function applyFirebaseAttributes(firebasePerformance: FirebasePerformanceApi, traceName: string, meta: PerformanceMeta) {
  const attributes = buildFirebaseAttributes(meta);
  await Promise.all(Object.entries(attributes).map(([attribute, value]) => (
    firebasePerformance.putAttribute({ traceName, attribute, value }).catch((error) => {
      logger.debug('Firebase trace attribute failed.', { error, traceName, attribute });
    })
  )));
}

async function applyFirebaseMetrics(firebasePerformance: FirebasePerformanceApi, traceName: string, meta: PerformanceMeta, durationMs: number) {
  const metrics = buildFirebaseMetrics(meta, durationMs);
  await Promise.all(Object.entries(metrics).map(([metricName, num]) => (
    firebasePerformance.putMetric({ traceName, metricName, num }).catch((error) => {
      logger.debug('Firebase trace metric failed.', { error, traceName, metricName });
    })
  )));
}

function buildFirebaseAttributes(meta: PerformanceMeta = {}) {
  const attributes: Record<string, string> = {
    platform: sanitizeAttributeValue(getPerformancePlatform())
  };

  const preferredKeys = ['category', 'route', 'workflowName', 'outcome', 'source', 'mode', 'target', 'response', 'force'];
  for (const key of preferredKeys) {
    if (Object.keys(attributes).length >= MAX_FIREBASE_ATTRIBUTE_COUNT) break;
    const attribute = sanitizeAttributeKey(key);
    const value = sanitizeAttributeValue(meta[key]);
    if (attribute && value) {
      attributes[attribute] = value;
    }
  }

  return attributes;
}

function buildFirebaseMetrics(meta: PerformanceMeta = {}, durationMs = 0) {
  const metrics: Record<string, number> = {
    duration_ms: Math.max(0, Math.round(durationMs))
  };

  for (const [key, value] of Object.entries(meta)) {
    if (Object.keys(metrics).length >= MAX_FIREBASE_METRIC_COUNT) break;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const metricName = sanitizeMetricName(key);
    if (!metricName || metricName === 'duration_ms') continue;
    metrics[metricName] = Math.round(Number(value));
  }

  return metrics;
}

function sanitizeAttributeKey(key: string) {
  const normalized = key
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return normalized && !normalized.startsWith('_') ? normalized : '';
}

function sanitizeMetricName(key: string) {
  const normalized = key
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
  return normalized && !normalized.startsWith('_') ? normalized : '';
}

function sanitizeAttributeValue(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).replace(/\s+/g, ' ').trim().slice(0, MAX_ATTRIBUTE_VALUE_LENGTH);
  }
  return '';
}

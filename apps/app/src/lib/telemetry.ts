import type { ReactErrorBoundaryReport } from '../components/ErrorBoundary';

type TelemetryOptions = {
  flush?: boolean;
  keepalive?: boolean;
};

type TelemetryProperties = Record<string, unknown>;

type AppTelemetryApi = {
  capture?: (name: string, properties?: TelemetryProperties, options?: TelemetryOptions) => unknown;
  flush?: (keepalive?: boolean) => unknown;
};

declare global {
  interface Window {
    AllPlaysTelemetry?: AppTelemetryApi;
    __ALLPLAYS_REPORT_REACT_ERROR__?: (report: ReactErrorBoundaryReport) => void;
  }
}

let telemetryPromise: Promise<AppTelemetryApi | null> | null = null;

export function startAppStartupTimer() {
  return createAppTimer('app startup', { stage: 'startup' });
}

export function createAppTimer(label: string, baseMeta: TelemetryProperties = {}) {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    end(meta: TelemetryProperties = {}) {
      recordAppUxTiming(label, startedAt, { ...baseMeta, ...meta });
    }
  };
}

export function recordAppUxTiming(label: string, startedAt: number, meta: TelemetryProperties = {}) {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const durationMs = Math.max(0, Math.round(now - startedAt));
  const { error, ...context } = meta;
  const outcome = error ? 'error' : 'success';

  captureAppTelemetryEvent('app_ux_timing', {
    label,
    durationMs,
    outcome,
    ...context
  });

  if (error) {
    captureAppTelemetryError(label, error, {
      durationMs,
      ...context
    });
  }
}

export function captureAppTelemetryError(label: string, error: unknown, context: TelemetryProperties = {}) {
  captureAppTelemetryEvent('app_load_error', {
    label,
    ...context,
    ...summarizeError(error)
  }, { flush: true });
}

export function installReactErrorTelemetry() {
  if (typeof window === 'undefined') {
    return;
  }

  window.__ALLPLAYS_REPORT_REACT_ERROR__ = (report: ReactErrorBoundaryReport) => {
    captureAppTelemetryError('react render error', report.error, {
      boundaryName: report.boundaryName,
      location: report.location,
      componentStackPresent: Boolean(report.errorInfo.componentStack)
    });
  };

  void ensureTelemetryPipeline();
}

export function captureAppTelemetryEvent(name: string, properties: TelemetryProperties = {}, options: TelemetryOptions = {}) {
  void ensureTelemetryPipeline().then((api) => {
    try {
      api?.capture?.(name, properties, options);
    } catch (_error) {
      // Telemetry is best-effort and must never break the app.
    }
  });
}

export function ensureTelemetryPipeline(): Promise<AppTelemetryApi | null> {
  const existing = getTelemetryApi();
  if (existing) {
    return Promise.resolve(existing);
  }

  if (telemetryPromise) {
    return telemetryPromise;
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }

  telemetryPromise = import('../../../../js/telemetry.js')
    .catch(() => null)
    .then(() => getTelemetryApi());

  return telemetryPromise;
}

function getTelemetryApi(): AppTelemetryApi | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const capture = window.AllPlaysTelemetry?.capture;
  if (typeof capture !== 'function') {
    return null;
  }

  return window.AllPlaysTelemetry ?? null;
}

function summarizeError(error: unknown) {
  const message = getErrorMessage(error);
  const type = getErrorType(error, message);
  const summary: TelemetryProperties = {
    errorName: getErrorName(error),
    errorType: type
  };

  const status = getErrorStatus(error);
  if (typeof status === 'number') {
    summary.status = status;
  }

  if (message && typeof error !== 'object') {
    summary.errorHint = truncate(message, 120);
  }

  return summary;
}

function getErrorName(error: unknown) {
  if (error instanceof Error && error.name) {
    return error.name;
  }
  if (error && typeof error === 'object' && 'name' in error && typeof (error as { name?: unknown }).name === 'string') {
    return (error as { name: string }).name;
  }
  return 'UnknownError';
}

function getErrorMessage(error: unknown) {
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return error.message || '';
  }
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return '';
}

function getErrorStatus(error: unknown) {
  if (!error || typeof error !== 'object' || !('status' in error)) {
    return undefined;
  }
  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) ? status : undefined;
}

function getErrorType(error: unknown, message: string) {
  const lowered = message.toLowerCase();
  const explicitType = error && typeof error === 'object' && 'type' in error
    ? (error as { type?: unknown }).type
    : undefined;

  if (typeof explicitType === 'string' && explicitType.trim()) {
    return explicitType.trim();
  }
  if (/(network|offline|failed to fetch|timed out|timeout|unavailable|connection)/.test(lowered)) {
    return 'network';
  }
  if (/(permission|forbidden|unauthorized|denied)/.test(lowered)) {
    return 'permission';
  }
  if (/(not found|missing)/.test(lowered)) {
    return 'not_found';
  }
  if (/(invalid|required|unsupported)/.test(lowered)) {
    return 'validation';
  }
  return 'unknown';
}

function truncate(value: string, limit: number) {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit - 1)}…`;
}

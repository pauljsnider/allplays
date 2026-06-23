import * as Sentry from '@sentry/browser';
import type { ErrorEvent as SentryErrorEvent } from '@sentry/browser';
import type { ReactErrorBoundaryReport } from '../components/ErrorBoundary';
import { createLogger, isSensitiveLogKey, normalizeErrorForLogging, redactedValue, sanitizeForLogging } from './logger';

const logger = createLogger('error-tracking');

type TelemetryOptions = {
  flush?: boolean;
  keepalive?: boolean;
};

type TelemetryProperties = Record<string, unknown>;

type AppTelemetryApi = {
  capture?: (name: string, properties?: TelemetryProperties, options?: TelemetryOptions) => unknown;
  flush?: (keepalive?: boolean) => unknown;
};

type ErrorTrackingInitOptions = {
  isProduction?: boolean;
};

type RuntimeConfig = {
  errorTracking?: {
    dsn?: string;
    environment?: string;
    release?: string;
  };
  errorTrackingDsn?: string;
  errorTrackingEnvironment?: string;
  errorTrackingRelease?: string;
  sentryDsn?: string;
  sentryEnvironment?: string;
  sentryRelease?: string;
  environment?: string;
  release?: string;
};

declare global {
  interface Window {
    AllPlaysTelemetry?: AppTelemetryApi;
    __ALLPLAYS_CONFIG__?: RuntimeConfig;
    __ALLPLAYS_REPORT_REACT_ERROR__?: (report: ReactErrorBoundaryReport) => void;
    ALLPLAYS_ERROR_TRACKING_DSN?: string;
    ALLPLAYS_ERROR_TRACKING_ENVIRONMENT?: string;
    ALLPLAYS_ERROR_TRACKING_RELEASE?: string;
    ALLPLAYS_SENTRY_DSN?: string;
    ALLPLAYS_SENTRY_ENVIRONMENT?: string;
    ALLPLAYS_SENTRY_RELEASE?: string;
    ALLPLAYS_ENVIRONMENT?: string;
    ALLPLAYS_RELEASE?: string;
  }
}

let telemetryPromise: Promise<AppTelemetryApi | null> | null = null;
let errorTrackingInitialized = false;
let globalErrorHandlersInstalled = false;

export function startAppStartupTimer() {
  return createAppTimer('app startup', { stage: 'startup' });
}

export function startAppInitialLoadTimer(loadName: string, baseMeta: TelemetryProperties = {}) {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    end(meta: TelemetryProperties = {}) {
      recordAppInitialLoadTiming(loadName, startedAt, { ...baseMeta, ...meta });
    }
  };
}

export function createAppTimer(label: string, baseMeta: TelemetryProperties = {}) {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    end(meta: TelemetryProperties = {}) {
      recordAppUxTiming(label, startedAt, { ...baseMeta, ...meta });
    }
  };
}

export function recordAppInitialLoadTiming(loadName: string, startedAt: number, meta: TelemetryProperties = {}) {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const durationMs = Math.max(0, Math.round(now - startedAt));
  const { error, ...context } = meta;
  const outcome = error ? 'failure' : 'success';

  captureAppTelemetryEvent('app_initial_load', {
    loadName,
    durationMs,
    outcome,
    ...context
  });

  if (error) {
    captureHandledAppError(`${loadName} initial load`, error, {
      durationMs,
      ...context
    });
  }
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
    captureHandledAppError(label, error, {
      durationMs,
      ...context
    });
  }
}

export function captureAppStartupFailure(error: unknown, context: TelemetryProperties = {}) {
  captureAppTelemetryError('app startup failure', error, {
    stage: 'startup',
    ...context
  }, { handled: false });
}

export function captureHandledAppError(label: string, error: unknown, context: TelemetryProperties = {}) {
  captureAppTelemetryError(label, error, context, { handled: true });
}

export function captureAppTelemetryError(
  label: string,
  error: unknown,
  context: TelemetryProperties = {},
  options: { handled?: boolean } = {}
) {
  captureAppTelemetryEvent('app_load_error', {
    label,
    ...context,
    ...summarizeError(error)
  }, { flush: true });

  captureErrorTrackingException(label, error, context, options);
}

export function initializeAppErrorTracking(options: ErrorTrackingInitOptions = {}) {
  if (errorTrackingInitialized) {
    return true;
  }

  const config = resolveErrorTrackingConfig();
  if (!config?.dsn) {
    return false;
  }

  try {
    Sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release,
      beforeSend(event) {
        return sanitizeErrorTrackingEvent(event);
      }
    });
    errorTrackingInitialized = true;
    if (options.isProduction ?? import.meta.env.PROD) {
      installGlobalErrorTrackingHandlers();
    }
    return true;
  } catch (error) {
    logger.warn('Failed to initialize.', { error });
    return false;
  }
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
    }, { handled: true });
  };

  void ensureTelemetryPipeline();
}

export function captureAppTelemetryEvent(name: string, properties: TelemetryProperties = {}, options: TelemetryOptions = {}) {
  const sanitizedProperties = sanitizeTelemetryProperties(properties);
  void ensureTelemetryPipeline().then((api) => {
    try {
      api?.capture?.(name, sanitizedProperties, options);
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

  telemetryPromise = import('@legacy/telemetry.js')
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

function sanitizeTelemetryProperties(properties: TelemetryProperties): TelemetryProperties {
  const sanitized = sanitizeForLogging(properties);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as TelemetryProperties
    : {};
}

function resolveErrorTrackingConfig() {
  if (typeof window === 'undefined') {
    return null;
  }

  const config = window.__ALLPLAYS_CONFIG__ || {};
  const dsn = firstNonEmptyString(
    config.errorTracking?.dsn,
    config.errorTrackingDsn,
    config.sentryDsn,
    window.ALLPLAYS_ERROR_TRACKING_DSN,
    window.ALLPLAYS_SENTRY_DSN
  );

  if (!dsn) {
    return null;
  }

  return {
    dsn,
    environment: firstNonEmptyString(
      config.errorTracking?.environment,
      config.errorTrackingEnvironment,
      config.sentryEnvironment,
      config.environment,
      window.ALLPLAYS_ERROR_TRACKING_ENVIRONMENT,
      window.ALLPLAYS_SENTRY_ENVIRONMENT,
      window.ALLPLAYS_ENVIRONMENT
    ),
    release: firstNonEmptyString(
      config.errorTracking?.release,
      config.errorTrackingRelease,
      config.sentryRelease,
      config.release,
      window.ALLPLAYS_ERROR_TRACKING_RELEASE,
      window.ALLPLAYS_SENTRY_RELEASE,
      window.ALLPLAYS_RELEASE
    )
  };
}

function installGlobalErrorTrackingHandlers() {
  if (globalErrorHandlersInstalled || typeof window === 'undefined') {
    return;
  }

  globalErrorHandlersInstalled = true;

  window.addEventListener('error', (event) => {
    const error = event.error ?? new Error(event.message || 'Unhandled window error');
    captureErrorTrackingException('window error', error, {
      source: event.filename || '',
      line: event.lineno || 0,
      column: event.colno || 0
    }, { handled: false });
  });

  window.addEventListener('unhandledrejection', (event) => {
    captureErrorTrackingException('unhandled promise rejection', event.reason, {
      reason: sanitizeForTracking(event.reason)
    }, { handled: false });
  });
}

function captureErrorTrackingException(
  label: string,
  error: unknown,
  context: TelemetryProperties = {},
  options: { handled?: boolean } = {}
) {
  if (!errorTrackingInitialized) {
    return;
  }

  const normalizedError = normalizeError(error, label);
  const sanitizedContext = sanitizeForTracking({ label, ...context });

  Sentry.withScope((scope) => {
    scope.setTag('allplays_error_label', label);
    scope.setTag('allplays_error_handled', options.handled === false ? 'false' : 'true');
    if (sanitizedContext && typeof sanitizedContext === 'object' && !Array.isArray(sanitizedContext)) {
      scope.setContext('allplays', sanitizedContext as Record<string, unknown>);
    }
    Sentry.captureException(normalizedError);
  });
}

function sanitizeErrorTrackingEvent(event: SentryErrorEvent) {
  const sanitized = sanitizeForTracking(event);
  return (sanitized && typeof sanitized === 'object') ? sanitized as SentryErrorEvent : event;
}

function normalizeError(error: unknown, fallbackMessage: string) {
  if (error instanceof Error) {
    return error;
  }

  const normalizedLogError = normalizeErrorForLogging(error, fallbackMessage);
  const message = normalizedLogError.message || fallbackMessage;
  const normalized = new Error(message);
  normalized.name = normalizedLogError.name || 'Error';
  const sanitizedCause = sanitizeForTracking(error);
  if (sanitizedCause !== undefined) {
    (normalized as Error & { cause?: unknown }).cause = sanitizedCause;
  }
  return normalized;
}

function sanitizeForTracking(value: unknown, keyHint = '', seen = new WeakSet<object>(), depth = 0): unknown {
  if (value == null) {
    return value;
  }

  if (typeof value === 'string') {
    return shouldRedactKey(keyHint) ? redactedValue : redactSensitiveText(value);
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  if (depth >= 6 && keyHint !== 'frames') {
    return '[Truncated]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForTracking(entry, keyHint, seen, depth + 1));
  }

  if (value instanceof Error) {
    const sanitizedError: Record<string, unknown> = {
      name: sanitizeForTracking(value.name, 'name', seen, depth + 1),
      message: sanitizeForTracking(value.message, 'message', seen, depth + 1)
    };

    Object.entries(value as Error & Record<string, unknown>).forEach(([key, entry]) => {
      sanitizedError[key] = sanitizeForTracking(entry, key, seen, depth + 1);
    });

    return sanitizedError;
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, entry]) => {
    acc[key] = shouldRedactKey(key)
      ? '[REDACTED]'
      : sanitizeForTracking(entry, key, seen, depth + 1);
    return acc;
  }, {});
}

function shouldRedactKey(key: string) {
  return isSensitiveLogKey(key);
}

function redactSensitiveText(value: string) {
  const sanitized = sanitizeForLogging(value);
  return typeof sanitized === 'string' ? sanitized : value;
}

function summarizeError(error: unknown) {
  const normalizedLogError = normalizeErrorForLogging(error);
  const message = normalizedLogError.message;
  const type = getErrorType(error, message);
  const summary: TelemetryProperties = {
    errorName: normalizedLogError.name,
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

function firstNonEmptyString(...values: Array<string | undefined>) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

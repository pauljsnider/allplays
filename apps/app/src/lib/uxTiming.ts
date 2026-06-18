import { recordAppUxTiming } from './telemetry';

export function startUxTimer(label: string) {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    end(meta: Record<string, unknown> = {}) {
      recordUxTiming(label, startedAt, meta);
    }
  };
}

export function recordUxTiming(label: string, startedAt: number, meta: Record<string, unknown> = {}) {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const durationMs = Math.round(now - startedAt);
  if (typeof console !== 'undefined') {
    console.info(`[ux] ${label} ${JSON.stringify({ durationMs, ...meta })}`);
  }
  recordAppUxTiming(label, startedAt, meta);
}

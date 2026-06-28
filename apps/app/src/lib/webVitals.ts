import type { Metric } from 'web-vitals';
import { captureAppTelemetryEvent } from './telemetry';

let webVitalsInitialized = false;

export async function initializeWebVitalsMonitoring() {
  if (webVitalsInitialized || typeof window === 'undefined') return false;
  webVitalsInitialized = true;

  try {
    const { onCLS, onFCP, onINP, onLCP, onTTFB } = await import('web-vitals');
    const report = (metric: Metric) => recordWebVitalMetric(metric);
    onCLS(report);
    onFCP(report);
    onINP(report);
    onLCP(report);
    onTTFB(report);
    return true;
  } catch (_error) {
    return false;
  }
}

export function recordWebVitalMetric(metric: Metric) {
  captureAppTelemetryEvent('app_web_vital', {
    name: metric.name,
    value: roundMetricValue(metric.value),
    delta: roundMetricValue(metric.delta),
    id: metric.id,
    rating: metric.rating,
    navigationType: metric.navigationType,
    route: getCurrentRoute()
  });
}

/** Test-only: reset the once-per-load guard. */
export function resetWebVitalsMonitoringForTests() {
  webVitalsInitialized = false;
}

function getCurrentRoute() {
  if (typeof window === 'undefined') return '';
  return window.location.hash || window.location.pathname || '';
}

function roundMetricValue(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}


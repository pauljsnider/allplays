// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const capacitorMock = vi.hoisted(() => ({
  getPlatform: vi.fn(() => 'web')
}));

const firebasePerformanceMock = vi.hoisted(() => ({
  startTrace: vi.fn(() => Promise.resolve()),
  stopTrace: vi.fn(() => Promise.resolve()),
  putAttribute: vi.fn(() => Promise.resolve()),
  putMetric: vi.fn(() => Promise.resolve()),
  record: vi.fn(() => Promise.resolve())
}));

vi.mock('@capacitor/core', () => ({ Capacitor: capacitorMock }));
vi.mock('@capacitor-firebase/performance', () => ({ FirebasePerformance: firebasePerformanceMock }));

async function flushInstrumentation() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('performanceInstrumentation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete (window as typeof window & { ALLPLAYS_PERFORMANCE_ENABLED?: boolean }).ALLPLAYS_PERFORMANCE_ENABLED;
    delete window.__ALLPLAYS_CONFIG__;
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(175);
    vi.spyOn(performance, 'mark');
    vi.spyOn(performance, 'measure');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds Firebase-safe trace names with product prefixes', async () => {
    const { buildPerformanceTraceName } = await import('./performanceInstrumentation');

    expect(buildPerformanceTraceName('Schedule Create Game!', 'workflow')).toBe('ap_workflow_schedule_create_game');
    expect(buildPerformanceTraceName('___', 'ux')).toBe('ap_ux_unknown');
    expect(buildPerformanceTraceName('x'.repeat(160), 'initial_load')).toHaveLength(98);
  });

  it('exports started spans to User Timing and Firebase Performance', async () => {
    const { startPerformanceSpan } = await import('./performanceInstrumentation');

    const span = startPerformanceSpan('schedule import', {
      kind: 'workflow',
      meta: {
        category: 'workflow',
        route: 'schedule',
        rowCount: 4
      }
    });
    span.end({ outcome: 'success', importedCount: 4 });
    await flushInstrumentation();

    expect(performance.mark).toHaveBeenCalled();
    expect(performance.measure).toHaveBeenCalledWith(
      'allplays:ap_workflow_schedule_import',
      expect.stringContaining(':start'),
      expect.stringContaining(':end')
    );
    expect(firebasePerformanceMock.startTrace).toHaveBeenCalledWith({ traceName: 'ap_workflow_schedule_import' });
    expect(firebasePerformanceMock.putAttribute).toHaveBeenCalledWith(expect.objectContaining({
      traceName: 'ap_workflow_schedule_import',
      attribute: 'category',
      value: 'workflow'
    }));
    expect(firebasePerformanceMock.putMetric).toHaveBeenCalledWith(expect.objectContaining({
      traceName: 'ap_workflow_schedule_import',
      metricName: 'rowCount',
      num: 4
    }));
    expect(firebasePerformanceMock.stopTrace).toHaveBeenCalledWith({ traceName: 'ap_workflow_schedule_import' });
  });

  it('lets Vite resolve the Firebase Performance dynamic import', () => {
    const source = readFileSync('src/lib/performanceInstrumentation.ts', 'utf8');

    expect(source).toContain("import('@capacitor-firebase/performance')");
    expect(source).not.toContain('@vite-ignore');
  });

  it('records completed spans without requiring a live trace', async () => {
    const { recordCompletedPerformanceSpan } = await import('./performanceInstrumentation');

    recordCompletedPerformanceSpan('first meaningful render', 0, 225, {
      kind: 'ux',
      meta: {
        category: 'startup',
        route: 'home'
      }
    });
    await flushInstrumentation();

    expect(firebasePerformanceMock.record).toHaveBeenCalledWith(expect.objectContaining({
      traceName: 'ap_ux_first_meaningful_render',
      duration: 225,
      options: expect.objectContaining({
        attributes: expect.objectContaining({
          route: 'home'
        }),
        metrics: expect.objectContaining({
          duration_ms: 225
        })
      })
    }));
  });

  it('honors runtime performance opt out', async () => {
    (window as typeof window & { ALLPLAYS_PERFORMANCE_ENABLED?: boolean }).ALLPLAYS_PERFORMANCE_ENABLED = false;
    const { startPerformanceSpan } = await import('./performanceInstrumentation');

    const span = startPerformanceSpan('schedule import', { kind: 'workflow' });
    span.end();
    await flushInstrumentation();

    expect(firebasePerformanceMock.startTrace).not.toHaveBeenCalled();
    expect(firebasePerformanceMock.stopTrace).not.toHaveBeenCalled();
  });
});

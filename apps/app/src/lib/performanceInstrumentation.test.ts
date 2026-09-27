// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const capacitorMock = vi.hoisted(() => ({
  getPlatform: vi.fn(() => 'web')
}));

const firebasePerformanceMock = vi.hoisted(() => ({
  startTrace: vi.fn((_payload: { traceName: string }) => Promise.resolve()),
  stopTrace: vi.fn((_payload: { traceName: string }) => Promise.resolve()),
  putAttribute: vi.fn(() => Promise.resolve()),
  putMetric: vi.fn(() => Promise.resolve()),
  record: vi.fn((_payload: {
    traceName: string;
    startTime: number;
    duration: number;
    options: {
      attributes: Record<string, string>;
      metrics: Record<string, number>;
    };
  }) => Promise.resolve())
}));

const firebaseAppMock = vi.hoisted(() => ({
  getApps: vi.fn<() => Array<{ name: string }>>(() => []),
  initializeApp: vi.fn()
}));

const legacyFirebaseAuthSdkMock = vi.hoisted(() => ({
  resolvePrimaryFirebaseConfig: vi.fn(() => Promise.resolve({ projectId: 'test-project' }))
}));

vi.mock('@capacitor/core', () => ({ Capacitor: capacitorMock }));
vi.mock('@capacitor-firebase/performance', () => ({ FirebasePerformance: firebasePerformanceMock }));
vi.mock('firebase/app', () => firebaseAppMock);
vi.mock('./adapters/legacyFirebaseAuthSdk', () => legacyFirebaseAuthSdkMock);

async function flushInstrumentation() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('performanceInstrumentation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    capacitorMock.getPlatform.mockReturnValue('web');
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

  it('exports each completed span to User Timing and Firebase Performance', async () => {
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
    expect(firebasePerformanceMock.record).toHaveBeenCalledWith(expect.objectContaining({
      traceName: 'ap_workflow_schedule_import',
      duration: 75,
      options: expect.objectContaining({
        attributes: expect.objectContaining({
          category: 'workflow',
          outcome: 'success'
        }),
        metrics: expect.objectContaining({
          duration_ms: 75,
          rowCount: 4,
          importedCount: 4
        })
      })
    }));
    expect(firebasePerformanceMock.startTrace).not.toHaveBeenCalled();
    expect(firebasePerformanceMock.stopTrace).not.toHaveBeenCalled();
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

  it('initializes the npm Firebase app on web before exporting traces', async () => {
    // The plugin's web implementation reads the npm SDK's '[DEFAULT]' app,
    // which the app shell (vendored legacy SDK) never creates. Regression for
    // every web trace failing with app/no-app.
    const { startPerformanceSpan } = await import('./performanceInstrumentation');

    const span = startPerformanceSpan('home mount load', { kind: 'ux' });
    span.end();
    await flushInstrumentation();

    expect(legacyFirebaseAuthSdkMock.resolvePrimaryFirebaseConfig).toHaveBeenCalled();
    expect(firebaseAppMock.initializeApp).toHaveBeenCalledWith({ projectId: 'test-project' });
    expect(firebasePerformanceMock.record).toHaveBeenCalledWith(expect.objectContaining({ traceName: 'ap_ux_home_mount_load' }));
  });

  it('reuses an existing npm Firebase app on web', async () => {
    firebaseAppMock.getApps.mockReturnValue([{ name: '[DEFAULT]' }]);
    const { startPerformanceSpan } = await import('./performanceInstrumentation');

    const span = startPerformanceSpan('home mount load', { kind: 'ux' });
    span.end();
    await flushInstrumentation();

    expect(firebaseAppMock.initializeApp).not.toHaveBeenCalled();
    expect(firebasePerformanceMock.record).toHaveBeenCalledWith(expect.objectContaining({ traceName: 'ap_ux_home_mount_load' }));
  });

  it('records overlapping spans with the same label independently', async () => {
    vi.spyOn(performance, 'now')
      .mockReset()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(120)
      .mockReturnValueOnce(170)
      .mockReturnValueOnce(220);
    const { startPerformanceSpan } = await import('./performanceInstrumentation');

    const first = startPerformanceSpan('home today load', { kind: 'ux', meta: { source: 'first' } });
    const second = startPerformanceSpan('home today load', { kind: 'ux', meta: { source: 'second' } });
    first.end();
    second.end();
    await flushInstrumentation();

    expect(firebasePerformanceMock.record).toHaveBeenCalledTimes(2);
    expect(firebasePerformanceMock.record.mock.calls.map(([payload]) => payload.duration)).toEqual([70, 100]);
    expect(firebasePerformanceMock.record.mock.calls.map(([payload]) => payload.options.attributes.source)).toEqual(['first', 'second']);
  });

  it('uses start and stop traces on native platforms instead of the web-only record API', async () => {
    capacitorMock.getPlatform.mockReturnValue('ios');
    const { startPerformanceSpan } = await import('./performanceInstrumentation');

    const span = startPerformanceSpan('schedule import', {
      kind: 'workflow',
      meta: { category: 'workflow', rowCount: 4 }
    });
    span.end({ outcome: 'success', importedCount: 4 });
    await flushInstrumentation();

    expect(firebasePerformanceMock.record).not.toHaveBeenCalled();
    expect(firebaseAppMock.initializeApp).not.toHaveBeenCalled();
    expect(firebasePerformanceMock.startTrace).toHaveBeenCalledWith({ traceName: 'ap_workflow_schedule_import' });
    expect(firebasePerformanceMock.putAttribute).toHaveBeenCalledWith(expect.objectContaining({
      traceName: 'ap_workflow_schedule_import',
      attribute: 'platform',
      value: 'ios'
    }));
    expect(firebasePerformanceMock.putMetric).toHaveBeenCalledWith(expect.objectContaining({
      traceName: 'ap_workflow_schedule_import',
      metricName: 'duration_ms',
      num: 75
    }));
    expect(firebasePerformanceMock.stopTrace).toHaveBeenCalledWith({ traceName: 'ap_workflow_schedule_import' });
  });

  it('assigns bounded native lanes so overlapping same-label traces do not overwrite each other', async () => {
    capacitorMock.getPlatform.mockReturnValue('android');
    vi.spyOn(performance, 'now')
      .mockReset()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(120)
      .mockReturnValueOnce(170)
      .mockReturnValueOnce(220);
    const { startPerformanceSpan } = await import('./performanceInstrumentation');

    const first = startPerformanceSpan('home today load', { kind: 'ux' });
    const second = startPerformanceSpan('home today load', { kind: 'ux' });
    first.end();
    second.end();
    await flushInstrumentation();

    expect(firebasePerformanceMock.record).not.toHaveBeenCalled();
    expect(firebasePerformanceMock.startTrace.mock.calls.map(([payload]) => payload.traceName)).toEqual([
      'ap_ux_home_today_load',
      'ap_ux_home_today_load_p2'
    ]);
    expect(firebasePerformanceMock.stopTrace.mock.calls.map(([payload]) => payload.traceName)).toEqual([
      'ap_ux_home_today_load',
      'ap_ux_home_today_load_p2'
    ]);
  });

  it('ends a span only once when competing cleanup paths fire', async () => {
    const { startPerformanceSpan } = await import('./performanceInstrumentation');

    const span = startPerformanceSpan('messages mount load', { kind: 'ux' });
    span.end({ outcome: 'success' });
    span.end({ outcome: 'abandoned' });
    await flushInstrumentation();

    expect(firebasePerformanceMock.record).toHaveBeenCalledTimes(1);
    expect(firebasePerformanceMock.record).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        attributes: expect.objectContaining({ outcome: 'success' })
      })
    }));
  });

  it('honors runtime performance opt out', async () => {
    (window as typeof window & { ALLPLAYS_PERFORMANCE_ENABLED?: boolean }).ALLPLAYS_PERFORMANCE_ENABLED = false;
    const { startPerformanceSpan } = await import('./performanceInstrumentation');

    const span = startPerformanceSpan('schedule import', { kind: 'workflow' });
    span.end();
    await flushInstrumentation();

    expect(firebasePerformanceMock.record).not.toHaveBeenCalled();
  });
});

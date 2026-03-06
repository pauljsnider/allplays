import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DEFAULT_FLAKE_RATE_LIMIT,
  QUARANTINE_TAG,
  buildReporters,
  formatRate,
  isFlakeRateWithinBudget,
  resolveGrepInvert,
  shouldIncludeQuarantine,
  summarizeReport
} = require('../../config/playwright-reliability.cjs');

function buildReport(tests) {
  return {
    suites: [
      {
        title: 'chromium',
        file: '',
        line: 0,
        column: 0,
        specs: [],
        suites: [
          {
            title: 'tests/critical/auth.spec.js',
            file: 'tests/critical/auth.spec.js',
            line: 1,
            column: 1,
            specs: tests.map((test, index) => ({
              title: test.title,
              file: test.file || 'tests/critical/auth.spec.js',
              line: index + 1,
              column: 1,
              tests: [
                {
                  projectName: test.projectName || 'chromium',
                  status: test.status,
                  results: test.results || []
                }
              ]
            }))
          }
        ]
      }
    ]
  };
}

describe('playwright reliability helpers', () => {
  it('defaults quarantine runs off', () => {
    expect(shouldIncludeQuarantine({})).toBe(false);
  });

  it('recognizes truthy quarantine opt-in values', () => {
    expect(shouldIncludeQuarantine({ PLAYWRIGHT_INCLUDE_QUARANTINE: 'true' })).toBe(true);
    expect(shouldIncludeQuarantine({ PLAYWRIGHT_INCLUDE_QUARANTINE: '1' })).toBe(true);
    expect(shouldIncludeQuarantine({ PLAYWRIGHT_INCLUDE_QUARANTINE: 'yes' })).toBe(true);
  });

  it('excludes @quarantine by default', () => {
    const pattern = resolveGrepInvert({});
    expect(pattern).toBeInstanceOf(RegExp);
    expect(pattern.test(QUARANTINE_TAG)).toBe(true);
  });

  it('disables the quarantine exclusion when explicitly requested', () => {
    expect(resolveGrepInvert({ PLAYWRIGHT_INCLUDE_QUARANTINE: 'on' })).toBeUndefined();
  });

  it('uses list reporter locally and only adds json when requested', () => {
    expect(buildReporters({})).toEqual([['list'], ['html', { open: 'never' }]]);
    expect(buildReporters({ PLAYWRIGHT_JSON_OUTPUT_FILE: 'tmp/report.json' })).toEqual([
      ['list'],
      ['html', { open: 'never' }],
      ['json', { outputFile: 'tmp/report.json' }]
    ]);
  });

  it('uses github reporter in CI and appends json output when configured', () => {
    expect(buildReporters({ CI: '1', PLAYWRIGHT_JSON_OUTPUT_FILE: 'test-results/nightly.json' })).toEqual([
      ['github'],
      ['html', { open: 'never' }],
      ['json', { outputFile: 'test-results/nightly.json' }]
    ]);
  });

  it('summarizes executed, skipped, and flaky tests from nested suites', () => {
    const summary = summarizeReport(buildReport([
      { title: 'passes', status: 'expected', results: [{ retry: 0 }] },
      { title: 'flakes', status: 'flaky', results: [{ retry: 0 }, { retry: 1 }] },
      { title: 'skips', status: 'skipped', results: [] }
    ]));

    expect(summary).toMatchObject({
      total: 3,
      executed: 2,
      expected: 1,
      flaky: 1,
      skipped: 1,
      retried: 1,
      retryAttempts: 1
    });
  });

  it('counts unexpected tests separately', () => {
    const summary = summarizeReport(buildReport([
      { title: 'fails', status: 'unexpected', results: [{ retry: 0 }, { retry: 1 }] }
    ]));

    expect(summary.unexpected).toBe(1);
    expect(summary.flaky).toBe(0);
    expect(summary.retryAttempts).toBe(1);
  });

  it('collects flaky test identifiers for triage output', () => {
    const summary = summarizeReport(buildReport([
      {
        title: 'parent packet completion @extended',
        file: 'tests/extended/practice-parent-workflow.spec.js',
        status: 'flaky',
        projectName: 'mobile-chromium',
        results: [{ retry: 0 }, { retry: 1 }]
      }
    ]));

    expect(summary.flakyTests).toEqual([
      {
        file: 'tests/extended/practice-parent-workflow.spec.js',
        title: 'parent packet completion @extended',
        projectName: 'mobile-chromium'
      }
    ]);
  });

  it('returns zero flake rate when nothing executed', () => {
    const summary = summarizeReport(buildReport([
      { title: 'skips', status: 'skipped', results: [] }
    ]));

    expect(summary.executed).toBe(0);
    expect(summary.flakeRate).toBe(0);
  });

  it('formats percentage values with two decimals', () => {
    expect(formatRate(0)).toBe('0.00%');
    expect(formatRate(0.015)).toBe('1.50%');
  });

  it('uses the default flake budget when limit input is invalid', () => {
    const summary = { flakeRate: DEFAULT_FLAKE_RATE_LIMIT };
    expect(isFlakeRateWithinBudget(summary, 'not-a-number')).toBe(true);
    expect(isFlakeRateWithinBudget({ flakeRate: DEFAULT_FLAKE_RATE_LIMIT + 0.001 }, undefined)).toBe(false);
  });

  it('passes only when the flake rate stays at or below the budget', () => {
    expect(isFlakeRateWithinBudget({ flakeRate: 0.019 }, 0.02)).toBe(true);
    expect(isFlakeRateWithinBudget({ flakeRate: 0.021 }, 0.02)).toBe(false);
  });
});

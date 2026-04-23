import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DEFAULT_RUNTIME_TARGETS_MS,
  formatDuration,
  isRuntimeWithinBudget,
  parseRuntimeTargetMs,
  resolveRuntimeLabel,
  resolveRuntimeTargetMs,
  summarizeRuntime
} = require('../../config/playwright-runtime-targets.cjs');

function buildReport(overrides = {}) {
  return {
    stats: overrides.stats,
    suites: overrides.suites ?? [
      {
        title: 'tests/critical/auth.spec.js',
        file: 'tests/critical/auth.spec.js',
        line: 1,
        column: 1,
        specs: [
          {
            title: 'logs in @critical',
            file: 'tests/critical/auth.spec.js',
            line: 1,
            column: 1,
            tests: [
              {
                status: 'expected',
                results: [{ retry: 0, duration: 15_000 }]
              }
            ]
          }
        ]
      }
    ]
  };
}

describe('playwright runtime target helpers', () => {
  it('parses non-negative integer runtime budgets', () => {
    expect(parseRuntimeTargetMs('600000')).toBe(600000);
  });

  it('rejects invalid runtime budget values', () => {
    expect(parseRuntimeTargetMs('')).toBeNull();
    expect(parseRuntimeTargetMs('-1')).toBeNull();
    expect(parseRuntimeTargetMs('not-a-number')).toBeNull();
  });

  it('uses an explicit runtime target when provided', () => {
    expect(resolveRuntimeTargetMs({ PLAYWRIGHT_RUNTIME_TARGET_MS: '1234', PLAYWRIGHT_SUITE: 'critical' })).toBe(1234);
  });

  it('defaults smoke runs to a two-minute budget', () => {
    expect(resolveRuntimeTargetMs({ PLAYWRIGHT_SUITE: 'smoke' })).toBe(DEFAULT_RUNTIME_TARGETS_MS.smoke);
  });

  it('defaults critical runs to a ten-minute budget', () => {
    expect(resolveRuntimeTargetMs({ PLAYWRIGHT_SUITE: 'critical' })).toBe(DEFAULT_RUNTIME_TARGETS_MS.critical);
  });

  it('defaults all-suite runs to a thirty-minute budget when the suite is missing', () => {
    expect(resolveRuntimeTargetMs({})).toBe(DEFAULT_RUNTIME_TARGETS_MS.all);
  });

  it('prefers report stats.duration when present', () => {
    expect(summarizeRuntime(buildReport({ stats: { duration: 45_000 } }))).toEqual({
      duration: 45_000,
      source: 'stats.duration'
    });
  });

  it('falls back to summing result durations when stats.duration is unavailable', () => {
    expect(summarizeRuntime(buildReport({ stats: {} }))).toEqual({
      duration: 15_000,
      source: 'results.duration'
    });
  });

  it('treats missing durations as zero in the fallback path', () => {
    const summary = summarizeRuntime({
      suites: [
        {
          title: 'tests/example.spec.js',
          file: 'tests/example.spec.js',
          line: 1,
          column: 1,
          specs: [
            {
              title: 'missing durations',
              file: 'tests/example.spec.js',
              line: 1,
              column: 1,
              tests: [{ results: [{ retry: 0 }, { retry: 1, duration: -1 }] }]
            }
          ]
        }
      ]
    });

    expect(summary).toEqual({
      duration: 0,
      source: 'results.duration'
    });
  });

  it('formats short and long durations for summary output', () => {
    expect(formatDuration(59_000)).toBe('59s');
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatDuration(3_723_000)).toBe('1h 2m 3s');
  });

  it('passes runtime budgets at the boundary and fails above them', () => {
    expect(isRuntimeWithinBudget({ duration: 600_000 }, 600_000)).toBe(true);
    expect(isRuntimeWithinBudget({ duration: 600_001 }, 600_000)).toBe(false);
  });

  it('resolves human-readable runtime labels from env', () => {
    expect(resolveRuntimeLabel({ PLAYWRIGHT_SUITE: 'critical' })).toBe('Playwright critical suite');
    expect(resolveRuntimeLabel({ PLAYWRIGHT_RUNTIME_LABEL: 'Nightly extended shard 1/2' })).toBe('Nightly extended shard 1/2');
  });
});

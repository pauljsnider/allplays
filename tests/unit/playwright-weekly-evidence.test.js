import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DEFAULT_WEEKLY_RUNTIME_BUDGETS_MS,
  aggregateEntries,
  buildRunUrl,
  buildWeeklyEvidenceMarkdown,
  getRuntimeBudgetMs,
  normalizeReportEntry,
  parseArtifactMetadata
} = require('../../config/playwright-weekly-evidence.cjs');

function buildReport(tests, stats = {}) {
  return {
    stats,
    suites: [
      {
        title: 'chromium',
        file: '',
        line: 0,
        column: 0,
        specs: [],
        suites: [
          {
            title: 'tests/example.spec.js',
            file: 'tests/example.spec.js',
            line: 1,
            column: 1,
            specs: tests.map((test, index) => ({
              title: test.title,
              file: test.file || 'tests/example.spec.js',
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

describe('playwright weekly evidence helpers', () => {
  it('parses critical full artifact metadata', () => {
    expect(parseArtifactMetadata('playwright-critical-full.json')).toEqual({
      suite: 'critical',
      shard: 'full',
      label: 'critical'
    });
  });

  it('parses extended shard artifact metadata', () => {
    expect(parseArtifactMetadata('/tmp/playwright-extended-2-of-2.json')).toEqual({
      suite: 'extended',
      shard: '2/2',
      label: 'extended shard 2/2'
    });
  });

  it('falls back gracefully for unknown artifact names', () => {
    expect(parseArtifactMetadata('custom-report.json')).toEqual({
      suite: 'all',
      shard: 'full',
      label: 'custom-report'
    });
  });

  it('uses weekly runtime budgets for covered suites', () => {
    expect(getRuntimeBudgetMs('critical')).toBe(DEFAULT_WEEKLY_RUNTIME_BUDGETS_MS.critical);
    expect(getRuntimeBudgetMs('extended')).toBe(DEFAULT_WEEKLY_RUNTIME_BUDGETS_MS.extended);
  });

  it('falls back to the global budget for unknown suites', () => {
    expect(getRuntimeBudgetMs('all')).toBeGreaterThan(DEFAULT_WEEKLY_RUNTIME_BUDGETS_MS.extended);
  });

  it('normalizes report entries with runtime and flake gates', () => {
    const entry = normalizeReportEntry('playwright-critical-full.json', buildReport([
      { title: 'passes', status: 'expected', results: [{ retry: 0, duration: 15_000 }] },
      { title: 'flakes', status: 'flaky', results: [{ retry: 0, duration: 5_000 }, { retry: 1, duration: 5_000 }] }
    ], { duration: 25_000 }));

    expect(entry.label).toBe('critical');
    expect(entry.reliability.executed).toBe(2);
    expect(entry.runtime.duration).toBe(25_000);
    expect(entry.runtimeWithinBudget).toBe(true);
    expect(entry.flakeRateWithinBudget).toBe(false);
  });

  it('aggregates totals across entries', () => {
    const totals = aggregateEntries([
      normalizeReportEntry('playwright-critical-full.json', buildReport([
        { title: 'passes', status: 'expected', results: [{ retry: 0, duration: 10_000 }] }
      ], { duration: 10_000 })),
      normalizeReportEntry('playwright-extended-1-of-2.json', buildReport([
        { title: 'fails', status: 'unexpected', results: [{ retry: 0, duration: 20_000 }] }
      ], { duration: 20_000 }))
    ]);

    expect(totals).toMatchObject({
      executed: 2,
      expected: 1,
      unexpected: 1,
      flaky: 0,
      duration: 30_000
    });
  });

  it('collects flaky spec detail during aggregation', () => {
    const totals = aggregateEntries([
      normalizeReportEntry('playwright-extended-1-of-2.json', buildReport([
        {
          title: 'parent packet flow @extended',
          file: 'tests/extended/practice-parent-workflow.spec.js',
          projectName: 'mobile-chromium',
          status: 'flaky',
          results: [{ retry: 0, duration: 1_000 }, { retry: 1, duration: 1_000 }]
        }
      ], { duration: 2_000 }))
    ]);

    expect(totals.flakyTests).toEqual([
      {
        suite: 'extended shard 1/2',
        file: 'tests/extended/practice-parent-workflow.spec.js',
        title: 'parent packet flow @extended',
        projectName: 'mobile-chromium'
      }
    ]);
  });

  it('builds a GitHub Actions run url when repository and run id are present', () => {
    expect(buildRunUrl({ repository: 'pauljsnider/allplays', runId: '12345' })).toBe(
      'https://github.com/pauljsnider/allplays/actions/runs/12345'
    );
  });

  it('omits the run url when required metadata is missing', () => {
    expect(buildRunUrl({ repository: 'pauljsnider/allplays' })).toBe('');
  });

  it('renders a passing weekly markdown report', () => {
    const markdown = buildWeeklyEvidenceMarkdown([
      normalizeReportEntry('playwright-critical-full.json', buildReport([
        { title: 'passes', status: 'expected', results: [{ retry: 0, duration: 15_000 }] }
      ], { duration: 15_000 }))
    ], {
      generatedAt: '2026-03-08T09:00:00.000Z',
      repository: 'pauljsnider/allplays',
      runId: '12345',
      commitSha: 'abcdef1234567890'
    });

    expect(markdown).toContain('# Playwright Weekly Evidence Report');
    expect(markdown).toContain('Workflow run: https://github.com/pauljsnider/allplays/actions/runs/12345');
    expect(markdown).toContain('| critical | 1 | 0 | 0 | 0.00% | 15s | 10m 0s | pass | pass |');
    expect(markdown).toContain('Weekly evidence run stayed within the current failure, flake, and runtime budgets.');
  });

  it('renders failing sections when failures and budget overruns are present', () => {
    const markdown = buildWeeklyEvidenceMarkdown([
      normalizeReportEntry('playwright-extended-2-of-2.json', buildReport([
        {
          title: 'flakes @extended',
          file: 'tests/extended/security-isolation-negative.spec.js',
          status: 'flaky',
          results: [{ retry: 0, duration: 10_000 }, { retry: 1, duration: 10_000 }]
        },
        {
          title: 'fails @extended',
          file: 'tests/extended/security-isolation-negative.spec.js',
          status: 'unexpected',
          results: [{ retry: 0, duration: 10_000 }]
        }
      ], { duration: 20 * 60 * 1000 }))
    ], {
      generatedAt: '2026-03-08T09:00:00.000Z'
    });

    expect(markdown).toContain('- Unexpected failures detected: 1.');
    expect(markdown).toContain('- Runtime budget exceeded: extended shard 2/2.');
    expect(markdown).toContain('- Flake budget exceeded: extended shard 2/2.');
    expect(markdown).toContain('tests/extended/security-isolation-negative.spec.js :: flakes @extended');
  });
});

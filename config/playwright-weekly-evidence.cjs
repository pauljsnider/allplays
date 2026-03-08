const path = require('node:path');

const { DEFAULT_FLAKE_RATE_LIMIT, formatRate, summarizeReport } = require('./playwright-reliability.cjs');
const {
  DEFAULT_RUNTIME_TARGETS_MS,
  formatDuration,
  summarizeRuntime
} = require('./playwright-runtime-targets.cjs');

const DEFAULT_WEEKLY_RUNTIME_BUDGETS_MS = Object.freeze({
  critical: DEFAULT_RUNTIME_TARGETS_MS.critical,
  extended: DEFAULT_RUNTIME_TARGETS_MS.extended
});

function normalizeArtifactToken(rawValue) {
  return String(rawValue ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.json$/i, '')
    .replace(/^playwright-/, '');
}

function parseArtifactMetadata(filePath) {
  const token = normalizeArtifactToken(path.basename(filePath));
  const match = token.match(/^(critical|extended)-(full|\d+-of-\d+)$/);
  if (!match) {
    return {
      suite: 'all',
      shard: 'full',
      label: token || 'unknown'
    };
  }

  const [, suite, shardToken] = match;
  const shard = shardToken === 'full' ? 'full' : shardToken.replace(/-of-/g, '/');
  const label = shard === 'full' ? suite : `${suite} shard ${shard}`;

  return { suite, shard, label };
}

function getRuntimeBudgetMs(suite) {
  return DEFAULT_WEEKLY_RUNTIME_BUDGETS_MS[suite] ?? DEFAULT_RUNTIME_TARGETS_MS.all;
}

function normalizeReportEntry(filePath, report) {
  const metadata = parseArtifactMetadata(filePath);
  const reliability = summarizeReport(report);
  const runtime = summarizeRuntime(report);
  const runtimeBudgetMs = getRuntimeBudgetMs(metadata.suite);

  return {
    filePath,
    suite: metadata.suite,
    shard: metadata.shard,
    label: metadata.label,
    reliability,
    runtime,
    runtimeBudgetMs,
    runtimeWithinBudget: runtime.duration <= runtimeBudgetMs,
    flakeRateWithinBudget: reliability.flakeRate <= DEFAULT_FLAKE_RATE_LIMIT
  };
}

function aggregateEntries(entries) {
  const totals = entries.reduce((summary, entry) => {
    summary.executed += entry.reliability.executed;
    summary.expected += entry.reliability.expected;
    summary.unexpected += entry.reliability.unexpected;
    summary.flaky += entry.reliability.flaky;
    summary.skipped += entry.reliability.skipped;
    summary.retried += entry.reliability.retried;
    summary.retryAttempts += entry.reliability.retryAttempts;
    summary.duration += entry.runtime.duration;
    summary.runtimeBudgetMs += entry.runtimeBudgetMs;
    entry.reliability.flakyTests.forEach((test) => {
      summary.flakyTests.push({
        suite: entry.label,
        file: test.file,
        title: test.title,
        projectName: test.projectName
      });
    });
    return summary;
  }, {
    executed: 0,
    expected: 0,
    unexpected: 0,
    flaky: 0,
    skipped: 0,
    retried: 0,
    retryAttempts: 0,
    duration: 0,
    runtimeBudgetMs: 0,
    flakyTests: []
  });

  totals.flakeRate = totals.executed > 0 ? totals.flaky / totals.executed : 0;
  return totals;
}

function buildRunUrl(options = {}) {
  const repository = String(options.repository ?? '').trim();
  const runId = String(options.runId ?? '').trim();
  if (!repository || !runId) {
    return '';
  }

  return `https://github.com/${repository}/actions/runs/${runId}`;
}

function buildHeaderLines(options = {}) {
  const generatedAt = String(options.generatedAt ?? '').trim() || new Date().toISOString();
  const lines = [
    '# Playwright Weekly Evidence Report',
    '',
    `Generated: ${generatedAt}`
  ];

  const runUrl = buildRunUrl(options);
  if (runUrl) {
    lines.push(`Workflow run: ${runUrl}`);
  }

  const commitSha = String(options.commitSha ?? '').trim();
  if (commitSha) {
    lines.push(`Commit: \`${commitSha}\``);
  }

  lines.push('');
  return lines;
}

function buildTotalsTable(totals) {
  return [
    '## Weekly Snapshot',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Executed tests | ${totals.executed} |`,
    `| Expected passes | ${totals.expected} |`,
    `| Unexpected failures | ${totals.unexpected} |`,
    `| Flaky tests | ${totals.flaky} |`,
    `| Flake rate | ${formatRate(totals.flakeRate)} |`,
    `| Skipped tests | ${totals.skipped} |`,
    `| Tests with retries | ${totals.retried} |`,
    `| Retry attempts | ${totals.retryAttempts} |`,
    `| Aggregate runtime | ${formatDuration(totals.duration)} |`,
    `| Aggregate runtime budget | ${formatDuration(totals.runtimeBudgetMs)} |`,
    ''
  ];
}

function buildEntryTable(entries) {
  const lines = [
    '## Shard Detail',
    '',
    '| Suite | Executed | Failures | Flakes | Flake Rate | Runtime | Budget | Runtime Gate | Flake Gate |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  ];

  entries.forEach((entry) => {
    lines.push(
      `| ${entry.label} | ${entry.reliability.executed} | ${entry.reliability.unexpected} | ${entry.reliability.flaky} | ${formatRate(entry.reliability.flakeRate)} | ${formatDuration(entry.runtime.duration)} | ${formatDuration(entry.runtimeBudgetMs)} | ${entry.runtimeWithinBudget ? 'pass' : 'fail'} | ${entry.flakeRateWithinBudget ? 'pass' : 'fail'} |`
    );
  });

  lines.push('');
  return lines;
}

function buildFlakySection(totals) {
  const lines = ['## Flaky Spec Detail', ''];
  if (totals.flakyTests.length === 0) {
    lines.push('No flaky specs detected in this weekly run.', '');
    return lines;
  }

  totals.flakyTests.forEach((test) => {
    const project = test.projectName ? ` (${test.projectName})` : '';
    lines.push(`- ${test.suite}: ${test.file} :: ${test.title}${project}`);
  });
  lines.push('');
  return lines;
}

function buildOutcomeLines(entries, totals) {
  const failingRuntime = entries.filter((entry) => !entry.runtimeWithinBudget).map((entry) => entry.label);
  const failingFlake = entries.filter((entry) => !entry.flakeRateWithinBudget).map((entry) => entry.label);
  const lines = ['## Outcome', ''];

  if (totals.unexpected === 0 && failingRuntime.length === 0 && failingFlake.length === 0) {
    lines.push('- Weekly evidence run stayed within the current failure, flake, and runtime budgets.', '');
    return lines;
  }

  if (totals.unexpected > 0) {
    lines.push(`- Unexpected failures detected: ${totals.unexpected}.`);
  }

  if (failingRuntime.length > 0) {
    lines.push(`- Runtime budget exceeded: ${failingRuntime.join(', ')}.`);
  }

  if (failingFlake.length > 0) {
    lines.push(`- Flake budget exceeded: ${failingFlake.join(', ')}.`);
  }

  lines.push('');
  return lines;
}

function buildWeeklyEvidenceMarkdown(entries, options = {}) {
  const sortedEntries = [...entries].sort((left, right) => left.label.localeCompare(right.label));
  const totals = aggregateEntries(sortedEntries);
  return [
    ...buildHeaderLines(options),
    ...buildTotalsTable(totals),
    ...buildEntryTable(sortedEntries),
    ...buildFlakySection(totals),
    ...buildOutcomeLines(sortedEntries, totals)
  ].join('\n').trimEnd() + '\n';
}

module.exports = {
  DEFAULT_WEEKLY_RUNTIME_BUDGETS_MS,
  aggregateEntries,
  buildRunUrl,
  buildWeeklyEvidenceMarkdown,
  getRuntimeBudgetMs,
  normalizeReportEntry,
  parseArtifactMetadata
};

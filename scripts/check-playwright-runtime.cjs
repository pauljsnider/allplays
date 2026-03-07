#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {
  formatDuration,
  isRuntimeWithinBudget,
  resolveRuntimeLabel,
  resolveRuntimeTargetMs,
  summarizeRuntime
} = require('../config/playwright-runtime-targets.cjs');

function getReportPath(argv, rawEnv = process.env) {
  const explicitArg = typeof argv[2] === 'string' ? argv[2].trim() : '';
  if (explicitArg) {
    return explicitArg;
  }

  const envPath = typeof rawEnv.PLAYWRIGHT_JSON_OUTPUT_FILE === 'string'
    ? rawEnv.PLAYWRIGHT_JSON_OUTPUT_FILE.trim()
    : '';

  return envPath || 'test-results/playwright-nightly-report.json';
}

function loadReport(reportPath) {
  const contents = fs.readFileSync(reportPath, 'utf8');
  return JSON.parse(contents);
}

function buildSummaryLines(label, summary, limit) {
  return [
    `${label} runtime ${formatDuration(summary.duration)} (budget ${formatDuration(limit)}).`,
    `Runtime source: ${summary.source}.`
  ];
}

function appendGithubSummary(lines, rawEnv = process.env) {
  const summaryPath = typeof rawEnv.GITHUB_STEP_SUMMARY === 'string' ? rawEnv.GITHUB_STEP_SUMMARY.trim() : '';
  if (!summaryPath) {
    return;
  }

  fs.appendFileSync(summaryPath, `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  const reportPath = getReportPath(process.argv, process.env);
  const absoluteReportPath = path.resolve(reportPath);
  const label = resolveRuntimeLabel(process.env);
  const limit = resolveRuntimeTargetMs(process.env);
  const summary = summarizeRuntime(loadReport(absoluteReportPath));
  const lines = buildSummaryLines(label, summary, limit);

  lines.forEach((line) => console.log(line));
  appendGithubSummary(lines, process.env);

  if (!isRuntimeWithinBudget(summary, limit)) {
    console.error(`Runtime budget exceeded: ${formatDuration(summary.duration)} > ${formatDuration(limit)}.`);
    process.exit(1);
  }
}

main();

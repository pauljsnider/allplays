#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_FLAKE_RATE_LIMIT,
  formatRate,
  isFlakeRateWithinBudget,
  summarizeReport
} = require('../config/playwright-reliability.cjs');

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

function getFlakeRateLimit(rawEnv = process.env) {
  const value = Number.parseFloat(String(rawEnv.PLAYWRIGHT_FLAKE_RATE_LIMIT ?? ''));
  if (!Number.isFinite(value) || value < 0) {
    return DEFAULT_FLAKE_RATE_LIMIT;
  }

  return value;
}

function loadReport(reportPath) {
  const contents = fs.readFileSync(reportPath, 'utf8');
  return JSON.parse(contents);
}

function buildSummaryLines(summary, limit) {
  const firstLine = `Playwright flake rate ${formatRate(summary.flakeRate)} (${summary.flaky}/${summary.executed} executed tests; budget ${formatRate(limit)}).`;
  const secondLine = `Retries touched ${summary.retried} tests across ${summary.retryAttempts} retry attempt(s); unexpected failures ${summary.unexpected}.`;
  const flakyDetails = summary.flakyTests.length
    ? `Flaky specs: ${summary.flakyTests.map((test) => `${test.file} :: ${test.title}`).join('; ')}`
    : 'Flaky specs: none.';

  return [firstLine, secondLine, flakyDetails];
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
  const limit = getFlakeRateLimit(process.env);
  const summary = summarizeReport(loadReport(absoluteReportPath));
  const lines = buildSummaryLines(summary, limit);

  lines.forEach((line) => console.log(line));
  appendGithubSummary(lines, process.env);

  if (!isFlakeRateWithinBudget(summary, limit)) {
    console.error(`Flake budget exceeded: ${formatRate(summary.flakeRate)} > ${formatRate(limit)}.`);
    process.exit(1);
  }
}

main();

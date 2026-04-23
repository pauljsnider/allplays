#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const {
  buildWeeklyEvidenceMarkdown,
  normalizeReportEntry
} = require('../config/playwright-weekly-evidence.cjs');

function parseArgs(argv) {
  const values = {
    inputDir: 'test-results/weekly-json',
    outputFile: ''
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--output') {
      values.outputFile = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (!token.startsWith('--') && !values.inputDirSet) {
      values.inputDir = token;
      values.inputDirSet = true;
    }
  }

  delete values.inputDirSet;
  return values;
}

function readReportEntries(inputDir) {
  const absoluteDir = path.resolve(inputDir);
  const fileNames = fs.readdirSync(absoluteDir)
    .filter((name) => name.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));

  if (fileNames.length === 0) {
    throw new Error(`No Playwright JSON reports found in ${absoluteDir}.`);
  }

  return fileNames.map((fileName) => {
    const absolutePath = path.join(absoluteDir, fileName);
    const report = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    return normalizeReportEntry(fileName, report);
  });
}

function writeOutput(markdown, outputFile) {
  if (!outputFile) {
    return;
  }

  const absolutePath = path.resolve(outputFile);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, markdown, 'utf8');
}

function appendGithubSummary(markdown, rawEnv = process.env) {
  const summaryPath = typeof rawEnv.GITHUB_STEP_SUMMARY === 'string' ? rawEnv.GITHUB_STEP_SUMMARY.trim() : '';
  if (!summaryPath) {
    return;
  }

  fs.appendFileSync(summaryPath, `${markdown}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv);
  const entries = readReportEntries(args.inputDir);
  const markdown = buildWeeklyEvidenceMarkdown(entries, {
    generatedAt: process.env.PLAYWRIGHT_WEEKLY_EVIDENCE_DATE || new Date().toISOString(),
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    commitSha: process.env.GITHUB_SHA
  });

  process.stdout.write(markdown);
  writeOutput(markdown, args.outputFile);
  appendGithubSummary(markdown, process.env);
}

main();

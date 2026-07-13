import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const REQUIRED_PROFILES = [
  'desktop-web',
  'throttled-4g-web',
  'mid-range-android',
  'iphone'
];

export const REQUIRED_PHASES = ['before', 'after'];

export const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
export const MAX_RUNS_PER_PHASE = 100;

export const REQUIRED_FIXTURE_FIELDS = [
  'testAccount',
  'teamOrOrganization',
  'homeTeamCount',
  'scheduleEventCount',
  'messageThreadCount'
];

export const REQUIRED_ENVIRONMENT_FIELDS = [
  'hardware',
  'os',
  'runtime',
  'browserOrWebView',
  'network',
  'cpu'
];

export const REQUIRED_METRICS = [
  { key: 'coldStartHomeTtiMs', label: 'Cold-start TTI Home', min: 1 },
  { key: 'warmResumeMs', label: 'Warm resume', min: 1 },
  { key: 'readsHomeMount', label: 'Reads / Home mount', min: 0, integer: true },
  { key: 'readsScheduleMount', label: 'Reads / Schedule mount', min: 0, integer: true },
  { key: 'readsMessagesMount', label: 'Reads / Messages mount', min: 0, integer: true },
  { key: 'entryChunkGzipBytes', label: 'Entry chunk gzip', min: 1, integer: true },
  { key: 'rsvpTapLatencyMs', label: 'RSVP tap latency', min: 1 },
  { key: 'chatSendLatencyMs', label: 'Chat send latency', min: 1 }
];

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const PLACEHOLDER_EVIDENCE_PATTERN = /^[\s_<>{}\[\]()*`'".\-:]*?(?:tbd|todo|placeholder|pending|unknown|n\s*\/?\s*a|not[\s_-]*available|to[\s_-]*be[\s_-]*determined|fill[\s_-]*(?:me|in))(?=$|[\s_\W])/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const SENSITIVE_FIELD_NAME_PATTERN = /(?:^|_)(?:password|passcode|secret|token|credential|credentials|api_key|access_key|private_key)(?:$|_)/;

export async function readMeasurementArtifact(filePath) {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) {
    throw new Error(`${filePath} must be a regular JSON file.`);
  }
  if (fileStats.size > MAX_ARTIFACT_BYTES) {
    throw new Error(`${filePath} exceeds the ${MAX_ARTIFACT_BYTES}-byte performance evidence limit.`);
  }

  const raw = await readFile(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Unable to parse ${filePath} as JSON: ${error.message}`);
  }
}

export function validateMeasurementArtifact(artifact) {
  const errors = [];
  const normalized = normalizeArtifact(artifact);

  if (normalized !== artifact) {
    errors.push('artifact must be a JSON object.');
  }
  if (containsSensitiveField(normalized)) {
    errors.push('artifact must not include password, secret, token, credential, or private-key fields.');
  }

  if (normalized.issue !== 2050) {
    errors.push('issue must be 2050.');
  }

  validateSha(normalized.baselineSha, 'baselineSha', errors);
  validateSha(normalized.afterSha, 'afterSha', errors);
  if (shaValuesOverlap(normalized.baselineSha, normalized.afterSha)) {
    errors.push('baselineSha and afterSha must identify different commits.');
  }
  validateFixture(normalized.fixture, errors);
  validateProfiles(normalized.profiles, normalized, errors);

  return {
    errors,
    summary: errors.length === 0 ? buildSummary(normalized) : null
  };
}

export function buildMarkdownSummary(summary) {
  const lines = [
    '| Profile | Phase | Cold-start TTI Home | Warm resume | Reads / Home | Reads / Schedule | Reads / Messages | Entry gzip | RSVP tap | Chat send |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  ];

  for (const profile of summary.profiles) {
    for (const phase of REQUIRED_PHASES) {
      const medians = profile.phases[phase].medians;
      lines.push([
        formatMarkdownCell(profile.label),
        phase,
        formatMs(medians.coldStartHomeTtiMs),
        formatMs(medians.warmResumeMs),
        formatCount(medians.readsHomeMount),
        formatCount(medians.readsScheduleMount),
        formatCount(medians.readsMessagesMount),
        formatBytes(medians.entryChunkGzipBytes),
        formatMs(medians.rsvpTapLatencyMs),
        formatMs(medians.chatSendLatencyMs)
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }

  return lines.join('\n');
}

function normalizeArtifact(artifact) {
  return artifact && typeof artifact === 'object' && !Array.isArray(artifact) ? artifact : {};
}

function containsSensitiveField(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);

  return Object.entries(value).some(([key, nestedValue]) => {
    const normalizedKey = key
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[^a-z0-9]+/gi, '_')
      .toLowerCase();
    return SENSITIVE_FIELD_NAME_PATTERN.test(normalizedKey) || containsSensitiveField(nestedValue, seen);
  });
}

function validateFixture(fixture, errors) {
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) {
    errors.push('fixture must describe the shared account/team/data volume.');
    return;
  }

  for (const field of REQUIRED_FIXTURE_FIELDS) {
    const value = fixture[field];
    const isCountField = field.endsWith('Count');
    if (isCountField) {
      if (!Number.isSafeInteger(value) || value < 1) {
        errors.push(`fixture.${field} must be a positive safe integer.`);
      }
    } else {
      validateEvidenceString(value, `fixture.${field}`, errors);
    }
  }
}

function validateProfiles(profiles, artifact, errors) {
  if (!Array.isArray(profiles)) {
    errors.push('profiles must be an array.');
    return;
  }

  if (profiles.length !== REQUIRED_PROFILES.length) {
    errors.push(`profiles must contain exactly ${REQUIRED_PROFILES.length} entries.`);
  }
  if (profiles.length > REQUIRED_PROFILES.length) {
    return;
  }

  const profileIds = profiles.map((profile) => profile?.id);
  for (const requiredProfile of REQUIRED_PROFILES) {
    if (!profileIds.includes(requiredProfile)) {
      errors.push(`profiles must include ${requiredProfile}.`);
    }
  }

  const duplicateProfiles = profileIds.filter((id, index) => id && profileIds.indexOf(id) !== index);
  for (const duplicateProfile of new Set(duplicateProfiles)) {
    errors.push(`profiles contains duplicate id ${duplicateProfile}.`);
  }

  for (const profile of profiles) {
    validateProfile(profile, artifact, errors);
  }
}

function validateProfile(profile, artifact, errors) {
  const id = profile?.id || '<missing>';
  if (!REQUIRED_PROFILES.includes(id)) {
    errors.push(`profile ${id} must use one of: ${REQUIRED_PROFILES.join(', ')}.`);
  }
  validateEvidenceString(profile?.label, `profile ${id} label`, errors);

  validateEnvironment(profile?.environment, id, errors);

  for (const phase of REQUIRED_PHASES) {
    validatePhase(profile?.[phase], profile, phase, artifact, errors);
  }
}

function validateEnvironment(environment, profileId, errors) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    errors.push(`profile ${profileId} environment must describe the capture environment.`);
    return;
  }

  for (const field of REQUIRED_ENVIRONMENT_FIELDS) {
    validateEvidenceString(environment[field], `profile ${profileId} environment.${field}`, errors);
  }
}

function validatePhase(phaseData, profile, phase, artifact, errors) {
  const profileId = profile?.id || '<missing>';
  const context = `profile ${profileId} ${phase}`;
  if (!phaseData || typeof phaseData !== 'object' || Array.isArray(phaseData)) {
    errors.push(`${context} must include sha, capturedAt, and runs.`);
    return;
  }

  validateSha(phaseData.sha, `${context}.sha`, errors);
  const expectedSha = phase === 'before' ? artifact.baselineSha : artifact.afterSha;
  if (normalizeSha(expectedSha) && normalizeSha(phaseData.sha) !== normalizeSha(expectedSha)) {
    errors.push(`${context}.sha must match ${phase === 'before' ? 'baselineSha' : 'afterSha'}.`);
  }

  if (!isValidIsoTimestamp(phaseData.capturedAt)) {
    errors.push(`${context}.capturedAt must be a valid ISO timestamp with a timezone.`);
  }

  if (!Array.isArray(phaseData.runs)) {
    errors.push(`${context}.runs must be an array.`);
    return;
  }
  if (phaseData.runs.length < 3) {
    errors.push(`${context}.runs must include at least 3 clean runs.`);
  }
  if (phaseData.runs.length > MAX_RUNS_PER_PHASE) {
    errors.push(`${context}.runs must not exceed ${MAX_RUNS_PER_PHASE} runs.`);
    return;
  }

  const runNumbers = new Set();
  phaseData.runs.forEach((run, index) => {
    validateRun(run, `${context}.runs[${index}]`, errors);
    if (Number.isInteger(run?.run)) {
      if (runNumbers.has(run.run)) {
        errors.push(`${context}.runs contains duplicate run ${run.run}.`);
      }
      runNumbers.add(run.run);
    }
  });
}

function validateRun(run, context, errors) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    errors.push(`${context} must be an object.`);
    return;
  }
  if (!Number.isSafeInteger(run.run) || run.run <= 0) {
    errors.push(`${context}.run must be a positive safe integer.`);
  }

  for (const metric of REQUIRED_METRICS) {
    const value = run[metric.key];
    if (!Number.isFinite(value) || value < metric.min) {
      errors.push(`${context}.${metric.key} must be a number >= ${metric.min}.`);
      continue;
    }
    if (metric.integer && !Number.isSafeInteger(value)) {
      errors.push(`${context}.${metric.key} must be a safe integer.`);
    }
  }
}

function buildSummary(artifact) {
  return {
    issue: artifact.issue,
    baselineSha: artifact.baselineSha,
    afterSha: artifact.afterSha,
    profileCount: artifact.profiles.length,
    runCount: artifact.profiles.reduce((total, profile) => (
      total + REQUIRED_PHASES.reduce((phaseTotal, phase) => phaseTotal + profile[phase].runs.length, 0)
    ), 0),
    profiles: artifact.profiles.map((profile) => ({
      id: profile.id,
      label: profile.label,
      phases: Object.fromEntries(REQUIRED_PHASES.map((phase) => [
        phase,
        {
          sha: profile[phase].sha,
          capturedAt: profile[phase].capturedAt,
          runCount: profile[phase].runs.length,
          medians: calculateMedians(profile[phase].runs)
        }
      ]))
    }))
  };
}

function calculateMedians(runs) {
  return Object.fromEntries(REQUIRED_METRICS.map((metric) => [
    metric.key,
    median(runs.map((run) => run[metric.key]))
  ]));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function validateSha(value, field, errors) {
  if (!isNonEmptyString(value) || !SHA_PATTERN.test(value)) {
    errors.push(`${field} must be a 7-40 character hex SHA.`);
  }
}

function normalizeSha(value) {
  return isNonEmptyString(value) && SHA_PATTERN.test(value)
    ? value.toLowerCase()
    : '';
}

function shaValuesOverlap(left, right) {
  const normalizedLeft = normalizeSha(left);
  const normalizedRight = normalizeSha(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft);
}

function isValidIsoTimestamp(value) {
  if (!isNonEmptyString(value)) return false;
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match || Number.isNaN(Date.parse(value))) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const daysInMonth = month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;

  return day >= 1 && day <= daysInMonth &&
    hour <= 23 && minute <= 59 && second <= 59 &&
    offsetHour <= 23 && offsetMinute <= 59;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateEvidenceString(value, field, errors) {
  if (!isNonEmptyString(value)) {
    errors.push(`${field} must be a non-empty string.`);
  } else if (PLACEHOLDER_EVIDENCE_PATTERN.test(value.trim())) {
    errors.push(`${field} must be real evidence, not a placeholder.`);
  } else if (CONTROL_CHARACTER_PATTERN.test(value)) {
    errors.push(`${field} must be a single-line string without control characters.`);
  }
}

function formatMarkdownCell(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ');
}

function formatMs(value) {
  return `${Math.round(value)}ms`;
}

function formatCount(value) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function formatBytes(value) {
  return `${(value / 1024).toFixed(1)} KiB`;
}

async function main() {
  const fileArg = process.argv[2] || process.env.APP_PERFORMANCE_MEASUREMENTS_FILE;
  if (!fileArg) {
    throw new Error('Usage: node scripts/validate-app-performance-measurements.mjs <measurements.json>');
  }

  const filePath = path.resolve(process.cwd(), fileArg);
  const artifact = await readMeasurementArtifact(filePath);
  const result = validateMeasurementArtifact(artifact);
  if (result.errors.length > 0) {
    throw new Error(`Invalid app performance measurement artifact:\n- ${result.errors.join('\n- ')}`);
  }

  console.log(`Validated issue #${result.summary.issue} measurements: ${result.summary.profileCount} profiles, ${result.summary.runCount} raw runs.`);
  console.log(buildMarkdownSummary(result.summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

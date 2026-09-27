#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import process from 'node:process';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const { createOfficialUserBindingMigrator } = require('../functions/official-team-discovery-core.cjs');

// The untracked operator-reviewed plan is a JSON array of
// { teamId, officialId, userId, expectedPhone }. Dry-run is the default.

function getArgumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

const planPath = getArgumentValue('--plan');
const projectId = getArgumentValue('--project');
const apply = process.argv.includes('--apply');

if (!planPath || !projectId) {
  throw new Error('Usage: backfill-official-user-bindings.mjs --plan <json> --project <id> [--apply]');
}

const plan = JSON.parse(await readFile(planPath, 'utf8'));
if (!Array.isArray(plan) || plan.length === 0 || plan.length > 500) {
  throw new Error('The binding plan must contain between 1 and 500 entries.');
}

const app = getApps()[0] || initializeApp({
  credential: applicationDefault(),
  projectId
});

const firestore = getFirestore(app);
const migrateBinding = createOfficialUserBindingMigrator({
  firestore,
  auth: getAuth(app),
  serverTimestamp: () => FieldValue.serverTimestamp()
});

let alreadyBound = 0;
for (const entry of plan) {
  const result = await migrateBinding({ ...entry, dryRun: !apply });
  if (result.alreadyBound) alreadyBound += 1;
}

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  reviewed: plan.length,
  alreadyBound,
  newlyBound: apply ? plan.length - alreadyBound : 0
}));

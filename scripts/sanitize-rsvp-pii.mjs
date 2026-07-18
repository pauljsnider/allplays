#!/usr/bin/env node
import { readFile, rename, writeFile } from 'node:fs/promises';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore';
import { parsePositiveBound, planRsvpPiiSanitization } from './rsvp-pii-migration-core.mjs';

function parseArgs(argv) {
  const options = { apply: false, pageSize: 200, maxPages: 25, stateFile: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--project') options.projectId = argv[++index];
    else if (arg === '--confirm-project') options.confirmProject = argv[++index];
    else if (arg === '--page-size') options.pageSize = parsePositiveBound(argv[++index], 200, 400);
    else if (arg === '--max-pages') options.maxPages = parsePositiveBound(argv[++index], 25, 10_000);
    else if (arg === '--state-file') options.stateFile = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.projectId) throw new Error('--project is required.');
  if (options.apply && options.confirmProject !== options.projectId) {
    throw new Error('--apply requires --confirm-project with the exact project ID.');
  }
  return options;
}

async function loadState(path) {
  if (!path) return { collectionIndex: 0, cursorPath: '', scanned: 0, changed: 0 };
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return {
      collectionIndex: Number(parsed.collectionIndex) || 0,
      cursorPath: String(parsed.cursorPath || ''),
      scanned: Number(parsed.scanned) || 0,
      changed: Number(parsed.changed) || 0
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { collectionIndex: 0, cursorPath: '', scanned: 0, changed: 0 };
    throw error;
  }
}

async function saveState(path, state) {
  if (!path) return;
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, path);
}

const options = parseArgs(process.argv.slice(2));
const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: options.projectId });
const db = getFirestore(app);
const collectionGroups = ['rsvps', 'rsvpNotes'];
const state = await loadState(options.stateFile);
let pages = 0;

for (let collectionIndex = state.collectionIndex; collectionIndex < collectionGroups.length && pages < options.maxPages; collectionIndex += 1) {
  const groupName = collectionGroups[collectionIndex];
  let cursorPath = collectionIndex === state.collectionIndex ? state.cursorPath : '';
  while (pages < options.maxPages) {
    let query = db.collectionGroup(groupName).orderBy(FieldPath.documentId()).limit(options.pageSize);
    if (cursorPath) query = query.startAfter(cursorPath);
    const snapshot = await query.get();
    if (snapshot.empty) {
      state.collectionIndex = collectionIndex + 1;
      state.cursorPath = '';
      await saveState(options.stateFile, state);
      break;
    }

    const batch = db.batch();
    let pageChanges = 0;
    snapshot.docs.forEach((docSnap) => {
      state.scanned += 1;
      const plan = planRsvpPiiSanitization(docSnap.data() || {});
      if (!plan.needsUpdate) return;
      state.changed += 1;
      pageChanges += 1;
      if (options.apply) {
        const update = Object.fromEntries(plan.deleteFields.map((field) => [field, FieldValue.delete()]));
        batch.update(docSnap.ref, update, { lastUpdateTime: docSnap.updateTime });
      }
    });
    if (options.apply && pageChanges > 0) await batch.commit();
    pages += 1;
    cursorPath = snapshot.docs.at(-1).ref.path;
    state.collectionIndex = collectionIndex;
    state.cursorPath = cursorPath;
    await saveState(options.stateFile, state);
    process.stdout.write(`${options.apply ? 'apply' : 'dry-run'} ${groupName} page=${pages} scanned=${snapshot.size} changed=${pageChanges} cursor=${cursorPath}\n`);
    if (snapshot.size < options.pageSize) {
      state.collectionIndex = collectionIndex + 1;
      state.cursorPath = '';
      await saveState(options.stateFile, state);
      break;
    }
  }
}

process.stdout.write(`${options.apply ? 'APPLIED' : 'DRY RUN'} scanned=${state.scanned} changed=${state.changed} pages=${pages} complete=${state.collectionIndex >= collectionGroups.length}\n`);

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
const scheduleServiceSource = readFileSync(new URL('../../apps/app/src/lib/scheduleService.ts', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Missing function: ${name}`);
  const signatureEnd = source.indexOf('\n', start);
  const openBrace = source.lastIndexOf('{', signatureEnd);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed function: ${name}`);
}

function extractExportedFunction(source, name) {
  const marker = `export async function ${name}`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Missing exported function: ${name}`);
  const signatureEnd = source.indexOf('\n', start);
  const openBrace = source.lastIndexOf('{', signatureEnd);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed exported function: ${name}`);
}

describe('RSVP note privacy source contract', () => {
  it('keeps legacy RSVP status writes note-free and writes notes to the restricted path', () => {
    const submitRsvp = extractExportedFunction(dbSource, 'submitRsvp');
    const submitRsvpForPlayer = extractExportedFunction(dbSource, 'submitRsvpForPlayer');
    const writeRsvpNote = extractFunction(dbSource, 'writeRsvpNote');

    expect(submitRsvp).toContain('writeRsvpNote(teamId, gameId, effectiveUserId');
    expect(submitRsvpForPlayer).toContain('writeRsvpNote(teamId, gameId, docId');
    expect(writeRsvpNote).toContain('/rsvpNotes`');
    expect(writeRsvpNote).toContain('visibility');
    expect(writeRsvpNote).toContain('playerId: primaryPlayerId');
    expect(writeRsvpNote).toContain('childId: primaryPlayerId');
    expect(submitRsvpForPlayer).toContain('playerId: normalizedPlayerId');
    expect(submitRsvpForPlayer).toContain('childId: normalizedPlayerId');
    expect(submitRsvp).not.toMatch(/setDoc\(rsvpRef,[\s\S]*?\bnote:/);
    expect(submitRsvpForPlayer).not.toMatch(/setDoc\(rsvpRef,[\s\S]*?\bnote:/);
  });

  it('strips legacy private note fields before returning generic RSVP docs', () => {
    const getRsvps = extractExportedFunction(dbSource, 'getRsvps');

    expect(dbSource).toContain('const RSVP_PRIVATE_NOTE_FIELDS = [');
    expect(dbSource).toContain('function stripRsvpPrivateNoteFields');
    expect(getRsvps).toContain('stripRsvpPrivateNoteFields({ id: d.id, ...d.data() })');
    expect(getRsvps).toContain('loadAccessibleRsvpNotes(teamId, gameId)');
    expect(getRsvps).toContain('mergeRsvpNotesIntoRsvps(rsvps, notes)');
  });

  it('hydrates the app current-user note from rsvpNotes and keeps native status writes note-free', () => {
    const loadRsvps = extractFunction(scheduleServiceSource, 'loadRsvps');
    const mergeOwnRsvpNotes = extractFunction(scheduleServiceSource, 'mergeOwnRsvpNotes');
    const nativeSubmit = extractFunction(scheduleServiceSource, 'nativeSubmitRsvpForPlayer');
    const statusPatchStart = nativeSubmit.indexOf('/rsvps/');
    const statusPatchEnd = nativeSubmit.indexOf('});', statusPatchStart);
    const statusPatch = nativeSubmit.slice(statusPatchStart, statusPatchEnd);

    expect(loadRsvps).toContain('/rsvpNotes');
    expect(mergeOwnRsvpNotes).toContain('loadRsvpNoteById(teamId, gameId, rsvpId)');
    expect(mergeOwnRsvpNotes).toContain('noteReadsComplete: results.every');
    expect(nativeSubmit).toContain('/rsvpNotes/');
    expect(nativeSubmit).toContain('playerId: childId');
    expect(nativeSubmit).toContain('childId,');
    expect(statusPatch).toContain('respondedAt');
    expect(statusPatch).not.toContain('note:');
  });

  it('reconciles sticky session state in every complete schedule hydration path', () => {
    expect(scheduleServiceSource.match(/finalizeSessionRsvpHydration\(/g)).toHaveLength(5);
    expect(scheduleServiceSource).toContain('reconcileSessionRsvpState(authoritativeEvents, userId);');
    expect(scheduleServiceSource).toContain('rsvpsLoaded: rsvpsResult.status === \'fulfilled\'');
  });
});

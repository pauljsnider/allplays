import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractMatchBlock } from '../../scripts/validate-firebase-rules-ci.mjs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const gamesBlock = extractMatchBlock(rules, 'match /games/{gameId} {');

function extractNestedBlock(source, startMarker) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`Missing block: ${startMarker}`);
  const openBrace = start + startMarker.length - 1;
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed block: ${startMarker}`);
}

describe('RSVP note privacy Firestore rules', () => {
  it('rejects private note fields on parent-readable RSVP status docs', () => {
    const rsvpBlock = extractNestedBlock(gamesBlock, 'match /rsvps/{rsvpId} {');

    expect(rsvpBlock).toContain('function isRsvpStatusPayloadSafe(data)');
    expect(rsvpBlock).toContain("'note'");
    expect(rsvpBlock).toContain("'adminOnlyNote'");
    expect(rsvpBlock).toContain("'privateAvailabilityNote'");
    expect(rsvpBlock).toContain('isRsvpStatusPayloadSafe(request.resource.data)');
  });

  it('restricts note docs to admins, the note owner, or explicit team-visible notes', () => {
    const noteBlock = extractNestedBlock(gamesBlock, 'match /rsvpNotes/{rsvpId} {');

    expect(noteBlock).toContain('function canReadRsvpNote(teamId, data)');
    expect(noteBlock).toContain('isTeamOwnerOrAdmin(teamId)');
    expect(noteBlock).toContain('isOwnRsvpNoteDoc(data)');
    expect(noteBlock).toContain("data.get('visibility', 'admins') == 'team'");
    expect(noteBlock).toContain("get('noteVisibility', 'admins') == 'team'");
    expect(noteBlock).toContain('allow read: if canReadRsvpNote(teamId, resource.data);');
  });

  it('requires an explicit safe RSVP note document shape for writes', () => {
    const noteBlock = extractNestedBlock(gamesBlock, 'match /rsvpNotes/{rsvpId} {');

    expect(noteBlock).toContain('function isRsvpNotePayloadValid(teamId, data)');
    expect(noteBlock).toContain("data.keys().hasAll(['userId', 'note', 'visibility', 'updatedAt'])");
    expect(noteBlock).toContain("data.visibility in ['admins', 'team']");
    expect(noteBlock).toContain("(data.visibility == 'admins' || teamAllowsTeamVisibleRsvpNotes(teamId))");
    expect(noteBlock).toContain('allow create, update: if isSignedIn() && canWriteRsvpNote(teamId, rsvpId, request.resource.data);');
  });
});

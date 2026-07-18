import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { looksLikeEmail, parsePositiveBound, planRsvpPiiSanitization } from '../../scripts/rsvp-pii-migration-core.mjs';

const runnerSource = readFileSync(new URL('../../scripts/sanitize-rsvp-pii.mjs', import.meta.url), 'utf8');

describe('RSVP PII migration planning', () => {
  it('deletes direct email fields and email-derived display names idempotently', () => {
    expect(planRsvpPiiSanitization({
      userId: 'parent-1',
      parentEmail: 'SENTINEL_PARENT@example.test',
      displayName: 'sentinel_parent@example.test',
      response: 'going'
    })).toEqual({
      needsUpdate: true,
      deleteFields: ['parentEmail', 'displayName']
    });
    expect(planRsvpPiiSanitization({ userId: 'parent-1', displayName: 'Pat Parent', response: 'going' }))
      .toEqual({ needsUpdate: false, deleteFields: [] });
  });

  it('recognizes bounded emails and clamps operational page sizes', () => {
    expect(looksLikeEmail('parent@example.test')).toBe(true);
    expect(looksLikeEmail('Parent Name')).toBe(false);
    expect(parsePositiveBound('900', 200, 400)).toBe(400);
    expect(parsePositiveBound('bad', 200, 400)).toBe(200);
  });

  it('keeps execution dry-run by default, resumable, bounded, and update-preconditioned', () => {
    expect(runnerSource).toContain("const options = { apply: false, pageSize: 200, maxPages: 25, stateFile: '' }");
    expect(runnerSource).toContain("options.confirmProject !== options.projectId");
    expect(runnerSource).toContain("orderBy(FieldPath.documentId()).limit(options.pageSize)");
    expect(runnerSource).toContain('query.startAfter(cursorPath)');
    expect(runnerSource).toContain('{ lastUpdateTime: docSnap.updateTime }');
    expect(runnerSource).toContain("writeFile(tempPath");
    expect(runnerSource).toContain("{ mode: 0o600 }");
  });
});

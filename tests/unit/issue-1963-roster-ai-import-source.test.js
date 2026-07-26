import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rosterAiImportSource = readFileSync(new URL('../../apps/app/src/lib/rosterAiImport.ts', import.meta.url), 'utf8');
const rosterAiAdapterSource = readFileSync(new URL('../../apps/app/src/lib/adapters/legacyRosterAi.ts', import.meta.url), 'utf8');
const editRosterSource = readFileSync(new URL('../../edit-roster.html', import.meta.url), 'utf8');
const capabilitiesSource = readFileSync(new URL('../../apps/app/src/data/capabilities.ts', import.meta.url), 'utf8');
const rosterAiImportTestSource = readFileSync(new URL('../../apps/app/src/lib/rosterAiImport.test.ts', import.meta.url), 'utf8');
const editRosterRegistrationTestSource = readFileSync(new URL('./edit-roster-registration-import.test.js', import.meta.url), 'utf8');
const editRosterBulkAiReactivateTestSource = readFileSync(new URL('./edit-roster-bulk-ai-reactivate.test.js', import.meta.url), 'utf8');

describe('issue 1963 roster AI import source contract', () => {
    it('keeps the app-native roster AI parser and commit-plan helpers available', () => {
        expect(rosterAiImportSource).toContain('export async function generateRosterAiImportRows');
        expect(rosterAiImportSource).toContain('export function buildRosterAiImportPrompt');
        expect(rosterAiImportSource).toContain('export function normalizeRosterAiImportResponse');
        expect(rosterAiImportSource).toContain('export function buildRosterAiImportCommitPlan');
        expect(rosterAiImportSource).toContain('export function buildRosterAiImportSchema');
        expect(rosterAiImportSource).toContain('Paste roster text, attach a CSV, or upload a roster image before using AI import.');
    });

    it('keeps prompt and normalization rules for full reviewed roster operations', () => {
        expect(rosterAiImportSource).toContain('Current players in roster: ${currentPlayers.length}');
        expect(rosterAiImportSource).toContain('Use add for new players, update with playerId for matches, and deactivate/reactivate only when requested.');
        expect(rosterAiImportSource).toContain('Preserve explicit false checkbox values and explicit clears');
        expect(rosterAiImportSource).toContain('planRosterAiImport({');
        expect(rosterAiImportSource).toContain('planRosterCsvImport({');
        expect(rosterAiImportSource).toContain('if (row.errors.length) {');
        expect(rosterAiImportTestSource).toContain('normalizes clean add operations into preview rows');
    });

    it('keeps Firebase AI generation configured for JSON text and image roster inputs', () => {
        expect(rosterAiImportSource).toContain('const promptParts: any[] = [buildRosterAiImportPrompt({ ...input, text })];');
        expect(rosterAiImportSource).toContain('promptParts.push(await fileToGenerativePart(imageFile));');
        expect(rosterAiImportSource).toContain('const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });');
        expect(rosterAiImportSource).toContain("model: 'gemini-2.5-flash'");
        expect(rosterAiImportSource).toContain("responseMimeType: 'application/json'");
        expect(rosterAiAdapterSource).toContain('Typed adapter boundary for the vendored Firebase AI SDK used by rosterAiImport');
        expect(rosterAiImportTestSource).toContain('generates rows through Firebase AI without persisting them');
    });

    it('keeps legacy roster Bulk AI review and apply flows handling add, update, deactivate, and reactivate', () => {
        expect(editRosterSource).toContain('id="tab-bulk-ai"');
        expect(editRosterSource).toContain('id="bulk-text-input"');
        expect(editRosterSource).toContain('loadBulkAiModules');
        expect(editRosterSource).toContain("action === 'deactivate'");
        expect(editRosterSource).toContain("action === 'reactivate'");
        expect(editRosterSource).toContain('await applyRosterCsvImportOperations(currentTeamId, proposedOperations)');
        expect(editRosterSource).toContain('buildBulkAiPlayerSchema');
        expect(editRosterSource).toContain('familyContacts: Schema.array');
        expect(editRosterSource).toContain("source: 'roster-ai'");
        expect(editRosterSource).toContain('providedFields');
        expect(editRosterBulkAiReactivateTestSource).toContain('renders reactivate operations before they can be applied');
        expect(editRosterBulkAiReactivateTestSource).toContain('renders normalized deactivate operations as a reviewable deactivation card');
    });

    it('keeps roster AI import visible in capability docs and covered by legacy contract tests', () => {
        expect(capabilitiesSource).toContain('AI roster import');
        expect(editRosterRegistrationTestSource).toContain('instructs AI roster parsing to update likely existing players instead of duplicating them');
        expect(editRosterRegistrationTestSource).toContain('supports text-only AI roster imports with a structured add/update response contract');
        expect(rosterAiImportTestSource).toContain('returns actionable errors for empty input and malformed responses');
    });
});

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
        expect(rosterAiImportSource).toContain("return { rows: [], errors: ['Paste roster text or upload a roster image before using AI import.'] };");
    });

    it('keeps prompt and normalization rules preventing duplicate active-player imports', () => {
        expect(rosterAiImportSource).toContain('Current players in roster: ${currentPlayers.length}');
        expect(rosterAiImportSource).toContain('Use action "update" with playerId and changes');
        expect(rosterAiImportSource).toContain('Never add a second active player for a likely update to an existing player.');
        expect(rosterAiImportSource).toContain('normalizeRosterAiOperation(operation, index + 1, currentPlayers)');
        expect(rosterAiImportSource).toContain('if (row.errors.length) {');
        expect(rosterAiImportTestSource).toContain('normalizes add and update operations into preview rows');
        expect(rosterAiImportTestSource).toContain('flags likely duplicate adds and excludes errored rows from the commit plan');
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
        expect(editRosterSource).toContain("op.action === 'delete' || op.action === 'deactivate'");
        expect(editRosterSource).toContain("op.action === 'reactivate'");
        expect(editRosterSource).toContain('await deactivatePlayer(currentTeamId, op.playerId);');
        expect(editRosterSource).toContain('await reactivatePlayer(currentTeamId, op.playerId);');
        expect(editRosterBulkAiReactivateTestSource).toContain('renders reactivate operations before they can be applied');
        expect(editRosterBulkAiReactivateTestSource).toContain('renders explicit deactivate operations as the same reviewable deactivation card as delete operations');
    });

    it('keeps roster AI import visible in capability docs and covered by legacy contract tests', () => {
        expect(capabilitiesSource).toContain('AI roster import');
        expect(editRosterRegistrationTestSource).toContain('instructs AI roster parsing to update likely existing players instead of duplicating them');
        expect(editRosterRegistrationTestSource).toContain('supports text-only AI roster imports with a structured add/update response contract');
        expect(rosterAiImportTestSource).toContain('returns actionable errors for empty input and malformed responses');
    });
});

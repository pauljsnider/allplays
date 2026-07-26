import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditRoster() {
    return readFileSync(new URL('../../edit-roster.html', import.meta.url), 'utf8');
}

function getRenderProposedChangesSource() {
    const source = readEditRoster();
    return source.slice(
        source.indexOf('function renderProposedChanges()'),
        source.indexOf('// Update operation when user edits')
    );
}

function getApplyChangesSource() {
    const source = readEditRoster();
    const start = source.indexOf("document.getElementById('apply-changes-btn')");
    return source.slice(
        start,
        source.indexOf('</script>', start)
    );
}

describe('edit roster Bulk AI proposed changes preview', () => {
    it('renders reactivate operations before they can be applied', () => {
        const renderSource = getRenderProposedChangesSource();

        expect(renderSource).toContain("action === 'reactivate'");
        expect(renderSource).toContain('▶️ Reactivate');
        expect(renderSource).toContain('Reactivate to active roster');
        expect(renderSource).toContain('border-emerald-300 bg-emerald-50');
        expect(renderSource).toContain('removePlayerOperation(${index})');
    });

    it('renders normalized deactivate operations as a reviewable deactivation card', () => {
        const renderSource = getRenderProposedChangesSource();

        expect(renderSource).toContain("action === 'deactivate'");
        expect(renderSource).toContain('⏸️ Deactivate');
    });

    it('uses the shared planner to merge private contacts before an atomic Bulk AI save', () => {
        const source = readEditRoster();
        const applySource = getApplyChangesSource();

        expect(source).toContain('planRosterAiImport({');
        expect(source).toContain('existingPlayers: bulkAiExistingPlayers');
        expect(source).toContain('providedContacts');
        expect(applySource).toContain('await applyRosterCsvImportOperations(currentTeamId, proposedOperations)');
        expect(applySource).toContain('sendImportedRosterContactInvite');
        expect(applySource).not.toContain('await updatePlayer(currentTeamId, op.playerId, playerData);');
    });

    it('migrates legacy protected profile values during Bulk AI saves', () => {
        const source = readEditRoster();

        expect(source).toContain('getPlayersWithPrivateRosterContacts(currentTeamId, { includeInactive: true })');
        expect(source).toContain('planRosterAiImport({');
        expect(source).toContain('existingPlayers: bulkAiExistingPlayers');
        expect(source).toContain("source: 'roster-ai'");
        expect(source).not.toContain('function mergeBulkAiPrivateFamilyContactsForUpdate');
    });

    it('retains and renders plan-level errors and blocks oversized AI imports', () => {
        const source = readEditRoster();
        const renderSource = getRenderProposedChangesSource();
        const applySource = getApplyChangesSource();

        expect(source).toContain('let proposedPlanErrors = [];');
        expect(source).toContain('proposedPlanErrors = rosterAiPlan.errors;');
        expect(renderSource).toContain('This import cannot be applied yet.');
        expect(renderSource).toContain('proposedPlanErrors.length > 0');
        expect(applySource).toContain("alert(proposedPlanErrors.join('\\n'))");
        expect(applySource).toContain('if (proposedPlanErrors.length > 0)');
    });
});

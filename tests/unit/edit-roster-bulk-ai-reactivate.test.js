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

describe('edit roster Bulk AI proposed changes preview', () => {
    it('renders reactivate operations before they can be applied', () => {
        const renderSource = getRenderProposedChangesSource();

        expect(renderSource).toContain("op.action === 'reactivate'");
        expect(renderSource).toContain('▶️ Reactivate');
        expect(renderSource).toContain('Reactivate to active roster');
        expect(renderSource).toContain('border-emerald-300 bg-emerald-50');
        expect(renderSource).toContain('removePlayerOperation(${index})');
    });

    it('renders explicit deactivate operations as the same reviewable deactivation card as delete operations', () => {
        const renderSource = getRenderProposedChangesSource();

        expect(renderSource).toContain("op.action === 'delete' || op.action === 'deactivate'");
        expect(renderSource).toContain('⏸️ Deactivate');
    });
});

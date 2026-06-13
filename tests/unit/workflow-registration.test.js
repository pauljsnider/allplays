import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('workflow registration guide', () => {
    it('documents Sports Connect as metadata-only instead of a live connection', () => {
        const source = readRepoFile('workflow-registration.html');

        expect(source).toContain('the registration provider fields currently store metadata only');
        expect(source).toContain('They do not create a live Sports Connect connection, authenticate to the provider, or verify connection health in real time.');
        expect(source).not.toContain('The connection status indicator updates to show: <strong>Connected</strong>, <strong>Not Connected</strong>, or <strong>Error</strong>.');
        expect(source).not.toContain('connection status monitoring, last-sync display, and manual re-import');
    });

    it('tells admins manual re-import depends on stored snapshots or loaded provider data', () => {
        const source = readRepoFile('workflow-registration.html');

        expect(source).toContain('The button does not pull fresh Sports Connect data immediately.');
        expect(source).toContain('registration schedule snapshot, registration roster snapshot, registration source snapshot, or other loaded provider data is already available for this team');
        expect(source).toContain('preview table appears from the stored registration schedule snapshot or other loaded provider data already saved in ALL PLAYS');
        expect(source).toContain('preview table appears from the stored registration roster snapshot or other loaded provider data already saved in ALL PLAYS');
        expect(source).not.toContain('pull the latest data immediately without waiting for any scheduled sync');
    });
});

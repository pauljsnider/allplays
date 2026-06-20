import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditTeam() {
    return readFileSync(new URL('../../edit-team.html', import.meta.url), 'utf8');
}

function readDb() {
    return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
}

function readFunctions() {
    return readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
}

function readSportsConnectSyncCore() {
    return readFileSync(new URL('../../functions/sports-connect-registration-sync.cjs', import.meta.url), 'utf8');
}

describe('edit team Sports Connect registration sync wiring', () => {
    it('enables manual sync for saved Sports Connect mappings through a callable wrapper', () => {
        const source = readEditTeam();
        const dbSource = readDb();
        const functionsSource = readFunctions();
        const coreSource = readSportsConnectSyncCore();

        expect(source).toContain('syncRegistrationProvider } from');
        expect(source).toContain('id="registration-refresh-btn"');
        expect(source).toContain('function handleRegistrationProviderSync()');
        expect(source).toContain('await syncRegistrationProvider(currentTeamId)');
        expect(source).toContain('function hasUnsavedRegistrationSyncChanges(provider, externalTeamId)');
        expect(source).toContain('Save the updated Sports Connect mapping before running sync.');
        expect(source).toContain('const canSyncSportsConnect = Boolean(currentTeamId && isSportsConnectProvider(provider) && externalTeamId && !hasUnsavedSyncChanges);');
        expect(source).toContain('syncEnabled: isSportsConnectProvider(provider) && !!externalTeamId');
        expect(source).toContain('Open roster import to preview changes.');
        expect(source).not.toContain('Manual refresh unavailable');

        expect(dbSource).toContain("httpsCallable(functions, 'syncRegistrationProvider')");
        expect(functionsSource).toContain('exports.syncRegistrationProvider = functions.https.onCall');
        expect(functionsSource).toContain('buildSportsConnectTeamUpdate');
        expect(coreSource).toContain('registrationRosterSnapshot');
        expect(coreSource).not.toContain('source.syncUrl');
    });
});

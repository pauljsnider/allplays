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
    it('keeps Sports Connect metadata wiring while manual sync remains disabled', () => {
        const source = readEditTeam();
        const dbSource = readDb();
        const functionsSource = readFunctions();
        const coreSource = readSportsConnectSyncCore();

        expect(source).toContain('syncRegistrationProvider } from');
        expect(source).toContain('id="registration-refresh-btn"');
        expect(source).toContain('function handleRegistrationProviderSync()');
        expect(source).toContain('await syncRegistrationProvider(currentTeamId)');
        expect(source).toContain('function hasUnsavedRegistrationSyncChanges(provider, externalTeamId)');
        expect(source).toContain('function getRegistrationProviderCapability(provider, externalTeamId, source = {})');
        expect(source).toContain("['live_connected', 'sync_success'].includes(source?.connectionStatus) && source?.syncEnabled === true");
        expect(source).toContain('Sports Connect live sync is unavailable until a connector is added.');
        expect(source).toContain("state: 'metadata_configured'");
        expect(source).toContain("state: 'live_connected'");
        expect(source).toContain('syncEnabled: capability.syncEnabled');
        expect(source).toContain('Open roster import to preview changes.');
        expect(source).not.toContain('Manual refresh unavailable');

        expect(dbSource).toContain("httpsCallable(functions, 'syncRegistrationProvider')");
        expect(functionsSource).toContain('exports.syncRegistrationProvider = functions.https.onCall');
        expect(functionsSource).toContain('buildSportsConnectTeamUpdate');
        expect(coreSource).toContain('registrationRosterSnapshot');
        expect(coreSource).not.toContain('source.syncUrl');
    });
});
